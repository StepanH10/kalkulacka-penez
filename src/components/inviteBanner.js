import { getState } from '../state/store.js'
import { acceptInvite, declineInvite } from '../services/invites.js'
import { switchSpace } from '../services/groups.js'
import { showToast } from './toast.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { translateError } from '../utils/errors.js'

// „zve vás jako …“ (4. pád)
const ROLE_AS = { editor: 'editora', viewer: 'pozorovatele' }

/** Čekající pozvánky do skupin s tlačítky Přijmout / Odmítnout. */
export function renderInviteBanner(state = getState()) {
  if (!state.invites.length) return ''
  return `
    <section class="stack invite-banners" aria-label="Pozvánky do skupin">
      ${state.invites
        .map(
          (inv) => `
        <div class="card invite-banner" data-invite="${inv.id}">
          <div class="invite-banner__icon">${icon('user-plus', { size: 20 })}</div>
          <div class="invite-banner__body">
            <strong>Pozvánka do skupiny „${esc(inv.group_name)}“</strong>
            <span class="muted"><span class="tag">${esc(inv.invited_by)}</span> vás zve jako ${ROLE_AS[inv.role] ?? ''}.</span>
          </div>
          <div class="invite-banner__actions">
            <button type="button" class="btn btn--sm" data-decline>Odmítnout</button>
            <button type="button" class="btn btn--sm btn--primary" data-accept><span class="spinner"></span>Přijmout</button>
          </div>
        </div>`,
        )
        .join('')}
    </section>`
}

/** Obsluha tlačítek banneru (delegovaně na `root`). Vrací funkci pro odpojení. */
export function bindInviteBanner(root) {
  const onClick = async (e) => {
    const card = e.target.closest('[data-invite]')
    if (!card || !root.contains(card)) return
    const invite = getState().invites.find((i) => i.id === card.dataset.invite)
    if (!invite) return

    if (e.target.closest('[data-accept]')) {
      const button = e.target.closest('[data-accept]')
      setLoading(button, true)
      try {
        const groupId = await acceptInvite(invite.id)
        showToast(`Jste členem skupiny „${invite.group_name}“`, {
          actionLabel: 'Přepnout',
          onAction: () => switchSpace(groupId).catch((err) => showToast(translateError(err))),
          duration: 6000,
        })
      } catch (err) {
        setLoading(button, false)
        showToast(translateError(err))
      }
      return
    }
    if (e.target.closest('[data-decline]')) {
      try {
        await declineInvite(invite.id)
        showToast('Pozvánka odmítnuta')
      } catch (err) {
        showToast(translateError(err))
      }
    }
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}
