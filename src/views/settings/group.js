import { getState, subscribe, currentUser } from '../../state/store.js'
import { currentGroup, ROLE_LABELS } from '../../state/space.js'
import { renameGroup, setMemberRole, removeMember, transferOwnership, leaveGroup, deleteGroup } from '../../services/groups.js'
import { inviteByTag, revokeInvite, fetchGroupInvites } from '../../services/invites.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { openInviteLinkSheet } from '../../components/inviteLinkSheet.js'
import { showToast } from '../../components/toast.js'
import { navigate } from '../../router.js'
import { subHeader } from './common.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { initials } from '../../utils/format.js'
import { formatDateTime } from '../../utils/dates.js'
import { translateError } from '../../utils/errors.js'

const tagOf = (m) => `${m.username ?? '?'}#${m.discriminator ?? '????'}`

const INVITE_STATUS = {
  pending: 'Čeká',
  accepted: 'Přijata',
  declined: 'Odmítnuta',
  expired: 'Vypršela',
  revoked: 'Zneplatněna',
}

/** Přehled pozvánek pro vlastníka: čekající nahoře (lze zneplatnit), pak posledních 10 ostatních. */
function invitesSection(invites) {
  if (!invites.length) return ''
  const pending = invites.filter((i) => i.status === 'pending')
  const rest = invites.filter((i) => i.status !== 'pending').slice(0, 10)
  return `
    <section class="section">
      <h2>Pozvánky</h2>
      <div class="card card--flush list">
        ${[...pending, ...rest]
          .map((i) => {
            const title = i.kind === 'link' ? `Odkaz${i.accepted_by ? ` · použil ${i.accepted_by}` : ''}` : i.invited
            const sub = [
              ROLE_LABELS[i.role],
              INVITE_STATUS[i.status] ?? i.status,
              i.status === 'pending' ? `platí do ${formatDateTime(i.expires_at)}` : '',
            ].filter(Boolean).join(' · ')
            return `
            <div class="list-row">
              <div class="list-row__icon">${icon(i.kind === 'link' ? 'link' : 'user-plus', { size: 18 })}</div>
              <div class="list-row__body">
                <div class="list-row__title tag">${esc(title)}</div>
                <div class="list-row__sub">${esc(sub)}</div>
              </div>
              ${i.status === 'pending' ? `<button type="button" class="btn btn--sm btn--ghost" data-revoke="${i.id}">Zneplatnit</button>` : ''}
            </div>`
          })
          .join('')}
      </div>
    </section>`
}

/** Správa jednoho člena (jen vlastník): role, předání vlastnictví, odebrání. */
function openMemberSheet(group, member) {
  openSheet({
    title: tagOf(member),
    body: `
      <div class="stack">
        <div class="field">
          <span class="field__label">Role</span>
          <div class="segmented" role="group" aria-label="Role">
            <button type="button" data-role="editor" aria-pressed="${member.role === 'editor'}">Editor</button>
            <button type="button" data-role="viewer" aria-pressed="${member.role === 'viewer'}">Pozorovatel</button>
          </div>
          <span class="field__hint">Editor přidává a upravuje záznamy, pozorovatel může jen číst.</span>
        </div>
        <div class="card card--flush">
          <button type="button" class="menu-row" data-transfer>${icon('crown')}<span>Předat vlastnictví</span></button>
          <button type="button" class="menu-row menu-row--danger" data-remove>${icon('user-minus')}<span>Odebrat ze skupiny</span></button>
        </div>
      </div>`,
    onMount(body, close) {
      body.addEventListener('click', async (e) => {
        const roleBtn = e.target.closest('[data-role]')
        if (roleBtn) {
          const role = roleBtn.dataset.role
          if (roleBtn.getAttribute('aria-pressed') === 'true') return
          body.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b === roleBtn)))
          try {
            await setMemberRole(group.id, member.user_id, role)
            showToast(`${tagOf(member)} je teď ${role === 'editor' ? 'editor' : 'pozorovatel'}`)
          } catch (err) {
            body.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.role === member.role)))
            showToast(translateError(err))
          }
          return
        }
        if (e.target.closest('[data-transfer]')) {
          const ok = await confirmDialog({
            title: 'Předat vlastnictví?',
            message: `Vlastníkem skupiny „${group.name}“ se stane ${tagOf(member)}. Vy zůstanete ve skupině jako editor.`,
            confirmLabel: 'Předat',
          })
          if (!ok) return
          try {
            await transferOwnership(group.id, member.user_id)
            showToast('Vlastnictví předáno')
            close()
          } catch (err) {
            showToast(translateError(err))
          }
          return
        }
        if (e.target.closest('[data-remove]')) {
          const ok = await confirmDialog({
            title: `Odebrat ${tagOf(member)}?`,
            message: 'Jeho dosavadní záznamy ve skupině zůstanou, autor se zobrazí jako „Bývalý člen“.',
            confirmLabel: 'Odebrat',
            danger: true,
          })
          if (!ok) return
          try {
            await removeMember(group.id, member.user_id)
            showToast('Člen odebrán')
            close()
          } catch (err) {
            showToast(translateError(err))
          }
        }
      })
    },
  })
}

export default function groupView(el) {
  const me = currentUser()?.id
  let redirected = false
  let invites = []
  let inviteRole = 'editor'
  let invitesFor = null

  // pozvánky vidí jen vlastník; načtou se při otevření a po každé akci
  const refreshInvites = async () => {
    const group = currentGroup()
    if (group?.role !== 'owner') {
      invites = []
      return
    }
    try {
      invites = await fetchGroupInvites(group.id)
      invitesFor = group.id
      draw()
    } catch {
      /* offline – seznam pozvánek není nutný */
    }
  }

  const draw = () => {
    const state = getState()
    const group = currentGroup(state)
    if (!group) {
      // osobní prostor nebo skupina zanikla – navigace až po vrácení cleanup routeru
      if (!redirected) setTimeout(() => navigate('/settings', { replace: true }), 0)
      redirected = true
      return
    }
    const isOwner = group.role === 'owner'
    if (isOwner && invitesFor !== group.id) {
      invitesFor = group.id
      refreshInvites()
    }
    const tagValue = el.querySelector('[data-invite-form] input[name=tag]')?.value ?? ''
    el.innerHTML = `
      ${subHeader('Skupina')}

      ${
        isOwner
          ? `<form class="card form" data-rename novalidate>
              <label class="field">
                <span class="field__label">Název skupiny</span>
                <input class="input" name="name" maxlength="40" value="${esc(group.name)}" autocomplete="off">
                <span class="field__error" data-error-for="name"></span>
              </label>
              <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit název</button>
            </form>`
          : `<div class="card"><h2>${esc(group.name)}</h2><p class="muted">Vaše role: ${ROLE_LABELS[group.role]}</p></div>`
      }

      ${
        isOwner
          ? `<section class="section">
              <h2>Pozvat člena</h2>
              <form class="card form" data-invite-form novalidate>
                <label class="field">
                  <span class="field__label">Tag uživatele</span>
                  <input class="input" name="tag" placeholder="jmeno#1234" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(tagValue)}">
                  <span class="field__hint">Celý tag včetně čísla – najdete ho v Nastavení u profilu.</span>
                  <span class="field__error" data-error-for="tag"></span>
                </label>
                <div class="segmented" role="group" aria-label="Role">
                  <button type="button" data-invite-role="editor" aria-pressed="${inviteRole === 'editor'}">Editor</button>
                  <button type="button" data-invite-role="viewer" aria-pressed="${inviteRole === 'viewer'}">Pozorovatel</button>
                </div>
                <button type="submit" class="btn btn--primary"><span class="spinner"></span>Poslat pozvánku</button>
              </form>
              <button type="button" class="btn btn--block" data-invite-link style="margin-top:12px">${icon('qr-code', { size: 18 })}Pozvat odkazem nebo QR kódem</button>
            </section>`
          : ''
      }

      <section class="section">
        <h2>Členové (${state.members.length})</h2>
        <div class="card card--flush list">
          ${state.members
            .map((m) => {
              const manageable = isOwner && m.user_id !== me
              const tag = manageable ? 'button' : 'div'
              return `
              <${tag} ${manageable ? `type="button" data-member="${m.user_id}"` : ''} class="list-row">
                <div class="avatar avatar--sm">${esc(initials(m.username ?? '?'))}</div>
                <div class="list-row__body">
                  <div class="list-row__title tag">${esc(tagOf(m))}${m.user_id === me ? ' <span class="muted">(vy)</span>' : ''}</div>
                  <div class="list-row__sub">${m.role === 'owner' ? `${icon('crown', { size: 13 })} ` : ''}${ROLE_LABELS[m.role]}</div>
                </div>
                ${manageable ? icon('chevron-right', { size: 18 }) : ''}
              </${tag}>`
            })
            .join('')}
        </div>
      </section>

      ${isOwner ? invitesSection(invites) : ''}

      <section class="section">
        ${
          isOwner
            ? `<p class="muted" style="font-size:.875rem;margin-bottom:12px">Skupinu můžete opustit až po předání vlastnictví jinému členovi.</p>
               <button type="button" class="btn btn--danger btn--block" data-delete-group>${icon('trash', { size: 18 })}Smazat skupinu</button>`
            : `<button type="button" class="btn btn--danger btn--block" data-leave>${icon('log-out', { size: 18 })}Opustit skupinu</button>`
        }
      </section>`
  }

  const onClick = async (e) => {
    const group = currentGroup()
    if (!group) return
    const roleBtn = e.target.closest('[data-invite-role]')
    if (roleBtn) {
      inviteRole = roleBtn.dataset.inviteRole
      el.querySelectorAll('[data-invite-role]').forEach((b) => b.setAttribute('aria-pressed', String(b === roleBtn)))
      return
    }
    if (e.target.closest('[data-invite-link]')) return openInviteLinkSheet(group, { onCreated: refreshInvites })
    const revoke = e.target.closest('[data-revoke]')
    if (revoke) {
      const ok = await confirmDialog({
        title: 'Zneplatnit pozvánku?',
        message: 'Pozvánku ani odkaz už nepůjde použít.',
        confirmLabel: 'Zneplatnit',
        danger: true,
      })
      if (!ok) return
      try {
        await revokeInvite(revoke.dataset.revoke)
        showToast('Pozvánka zneplatněna')
        await refreshInvites()
      } catch (err) {
        showToast(translateError(err))
      }
      return
    }
    const memberRow = e.target.closest('[data-member]')
    if (memberRow) {
      const member = getState().members.find((m) => m.user_id === memberRow.dataset.member)
      if (member) openMemberSheet(group, member)
      return
    }
    if (e.target.closest('[data-leave]')) {
      const ok = await confirmDialog({
        title: `Opustit skupinu „${group.name}“?`,
        message: 'Vaše záznamy ve skupině zůstanou. Zpátky se dostanete jen na novou pozvánku.',
        confirmLabel: 'Opustit',
        danger: true,
      })
      if (!ok) return
      try {
        await leaveGroup(group.id)
        showToast('Skupinu jste opustili')
        navigate('/settings', { replace: true })
      } catch (err) {
        showToast(translateError(err))
      }
      return
    }
    if (e.target.closest('[data-delete-group]')) {
      const ok = await confirmDialog({
        title: 'Smazat skupinu?',
        message: 'Smažou se účty, transakce, kategorie, rozpočty a cíle skupiny pro všechny členy. Tuto akci nelze vrátit.',
        confirmLabel: 'Smazat skupinu',
        danger: true,
        requireText: group.name,
      })
      if (!ok) return
      try {
        await deleteGroup(group.id)
        showToast('Skupina smazána')
        navigate('/settings', { replace: true })
      } catch (err) {
        showToast(translateError(err))
      }
    }
  }

  const onSubmit = async (e) => {
    const inviteForm = e.target.closest('[data-invite-form]')
    if (inviteForm) {
      e.preventDefault()
      clearErrors(inviteForm)
      const tag = inviteForm.elements.tag.value.trim()
      if (!/^[^#\s]+#\d{4}$/.test(tag)) {
        return setFieldError(inviteForm, 'tag', 'Zadejte celý tag ve tvaru jmeno#1234.')
      }
      const button = inviteForm.querySelector('[type="submit"]')
      setLoading(button, true)
      try {
        await inviteByTag(currentGroup().id, tag, inviteRole)
        inviteForm.elements.tag.value = ''
        showToast(`Pozvánka pro ${tag} odeslána`)
        await refreshInvites()
      } catch (err) {
        setFieldError(inviteForm, 'tag', translateError(err))
      } finally {
        setLoading(button, false)
      }
      return
    }
    const form = e.target.closest('[data-rename]')
    if (!form) return
    e.preventDefault()
    clearErrors(form)
    const name = form.elements.name.value.trim()
    if (!name) return setFieldError(form, 'name', 'Zadejte název skupiny.')
    const button = form.querySelector('[type="submit"]')
    setLoading(button, true)
    try {
      await renameGroup(currentGroup().id, name)
      showToast('Název uložen')
    } catch (err) {
      setFieldError(form, 'name', translateError(err))
    } finally {
      setLoading(button, false)
    }
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  el.addEventListener('submit', onSubmit)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
    el.removeEventListener('submit', onSubmit)
  }
}
