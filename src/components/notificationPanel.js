import { getState, subscribe } from '../state/store.js'
import { ROLE_LABELS } from '../state/space.js'
import { unreadCount, markRead, markAllRead } from '../services/notifications.js'
import { acceptInvite, declineInvite } from '../services/invites.js'
import { switchSpace } from '../services/groups.js'
import { navigate } from '../router.js'
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { formatRelative } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

const ROLE_AS = { editor: 'editora', viewer: 'pozorovatele' }

/** Ikona, nadpis a text upozornění podle typu (data jsou ze stavu v okamžiku události). */
export function describeNotification(n) {
  const d = n.data ?? {}
  const group = `„${d.group_name ?? 'skupina'}“`
  switch (n.type) {
    case 'invite_received':
      return { icon: 'user-plus', title: `Pozvánka do skupiny ${group}`, body: `${d.invited_by} vás zve jako ${ROLE_AS[d.role] ?? ''}.` }
    case 'invite_accepted':
      return {
        icon: 'users',
        title: `Nový člen ve skupině ${group}`,
        body: `${d.accepted_by ?? 'Nový člen'} · pozvánka ${d.kind === 'link' ? 'odkazem' : 'podle tagu'} přijata`,
      }
    case 'group_expense':
      return {
        icon: 'receipt',
        title: `Nový výdaj ve skupině ${group}`,
        body: [`${d.author}: ${formatMoney(d.amount)}`, d.category, d.note].filter(Boolean).join(' · '),
      }
    case 'role_changed':
      return {
        icon: d.new_role === 'owner' ? 'crown' : 'users',
        title: `Změna role ve skupině ${group}`,
        body: d.new_role === 'owner' ? 'Jste nyní vlastníkem skupiny.' : `Vaše nová role: ${ROLE_LABELS[d.new_role] ?? d.new_role}.`,
      }
    case 'member_removed':
      return { icon: 'user-minus', title: `Odebrání ze skupiny ${group}`, body: 'Vlastník vás odebral ze skupiny.' }
    default:
      return { icon: 'bell', title: 'Upozornění', body: '' }
  }
}

/** Zvonek s počtem nepřečtených. */
export function renderBell(state = getState()) {
  const count = unreadCount(state)
  const label = count ? `Upozornění, nepřečtených: ${count}` : 'Upozornění'
  return `
    <button type="button" class="icon-btn bell" data-bell aria-label="${label}" aria-haspopup="dialog">
      ${icon('bell')}
      ${count ? `<span class="bell__badge" aria-hidden="true">${count > 9 ? '9+' : count}</span>` : ''}
    </button>`
}

function item(n, invites) {
  const { icon: ic, title, body } = describeNotification(n)
  // pozvánku lze přijmout jen dokud čeká (není přijatá, odmítnutá, zneplatněná ani prošlá)
  const pendingInvite = n.type === 'invite_received' && invites.some((i) => i.id === n.data?.invite_id)
  const clickable = !pendingInvite && n.type !== 'member_removed' && n.data?.group_id
  return `
    <li class="notice ${n.read_at ? '' : 'is-unread'}" data-notification="${n.id}">
      <${clickable ? 'button type="button"' : 'div'} class="notice__main" ${clickable ? 'data-open' : ''}>
        <span class="notice__icon">${icon(ic, { size: 18 })}</span>
        <span class="notice__body">
          <strong>${esc(title)}</strong>
          ${body ? `<span>${esc(body)}</span>` : ''}
          <time class="muted" datetime="${esc(n.created_at)}">${esc(formatRelative(n.created_at))}</time>
        </span>
        ${n.read_at ? '' : '<span class="notice__dot" aria-label="Nepřečtené"></span>'}
      </${clickable ? 'button' : 'div'}>
      ${
        pendingInvite
          ? `<div class="notice__actions">
              <button type="button" class="btn btn--sm" data-decline>Odmítnout</button>
              <button type="button" class="btn btn--sm btn--primary" data-accept><span class="spinner"></span>Přijmout</button>
            </div>`
          : ''
      }
    </li>`
}

/** Panel se seznamem upozornění a „Označit vše jako přečtené“. */
export function openNotificationPanel() {
  openSheet({
    title: 'Upozornění',
    body: '<div data-notices></div>',
    onMount(body, close) {
      const slot = body.querySelector('[data-notices]')
      const draw = () => {
        const { notifications, invites } = getState()
        const unread = unreadCount()
        slot.innerHTML = notifications.length
          ? `
            ${unread ? `<button type="button" class="btn btn--ghost btn--sm notices__all" data-read-all>${icon('check-check', { size: 16 })}Označit vše jako přečtené</button>` : ''}
            <ul class="card card--flush notices">${notifications.map((n) => item(n, invites)).join('')}</ul>`
          : `<div class="empty">${icon('bell', { size: 24 })}<p>Zatím žádná upozornění.</p></div>`
      }
      draw()
      const unsub = subscribe(draw)

      slot.addEventListener('click', async (e) => {
        if (e.target.closest('[data-read-all]')) {
          try {
            await markAllRead()
          } catch (err) {
            showToast(translateError(err))
          }
          return
        }
        const li = e.target.closest('[data-notification]')
        if (!li) return
        const n = getState().notifications.find((x) => x.id === li.dataset.notification)
        if (!n) return
        markRead(n.id).catch(() => {})

        if (e.target.closest('[data-accept]')) {
          const button = e.target.closest('[data-accept]')
          setLoading(button, true)
          try {
            const groupId = await acceptInvite(n.data.invite_id)
            showToast(`Jste členem skupiny „${n.data.group_name}“`, {
              actionLabel: 'Přepnout',
              onAction: () => switchSpace(groupId).catch((err) => showToast(translateError(err))),
            })
          } catch (err) {
            setLoading(button, false)
            showToast(translateError(err))
          }
          return
        }
        if (e.target.closest('[data-decline]')) {
          try {
            await declineInvite(n.data.invite_id)
            showToast('Pozvánka odmítnuta')
          } catch (err) {
            showToast(translateError(err))
          }
          return
        }
        if (e.target.closest('[data-open]')) {
          // otevře skupinu, které se upozornění týká (pokud v ní uživatel stále je)
          const groupId = n.data.group_id
          if (!getState().groups.some((g) => g.id === groupId)) return showToast('Do této skupiny už nepatříte.')
          close()
          try {
            if (getState().space !== groupId) await switchSpace(groupId)
            navigate(n.type === 'group_expense' ? '/transactions' : n.type === 'invite_accepted' ? '/settings/group' : '/')
          } catch (err) {
            showToast(translateError(err))
          }
        }
      })
      return unsub
    },
  })
}
