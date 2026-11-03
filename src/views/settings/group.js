import { getState, subscribe, currentUser } from '../../state/store.js'
import { currentGroup, ROLE_LABELS } from '../../state/space.js'
import { renameGroup, setMemberRole, removeMember, transferOwnership, leaveGroup, deleteGroup } from '../../services/groups.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { showToast } from '../../components/toast.js'
import { navigate } from '../../router.js'
import { subHeader } from './common.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { initials } from '../../utils/format.js'
import { translateError } from '../../utils/errors.js'

const tagOf = (m) => `${m.username ?? '?'}#${m.discriminator ?? '????'}`

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
