import { createInviteLink, inviteUrl } from '../services/invites.js'
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatDateTime } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    showToast('Odkaz zkopírován')
  } catch {
    showToast('Kopírování se nepodařilo. Odkaz označte a zkopírujte ručně.')
  }
}

/**
 * Jednorázový odkaz do skupiny: volba role → QR kód, Sdílet, Kopírovat.
 * Token je vidět jen teď (v databázi je uložený jen jeho hash).
 */
export function openInviteLinkSheet(group, { onCreated } = {}) {
  let role = 'editor'
  openSheet({
    title: 'Pozvat odkazem',
    body: '<div data-link-sheet></div>',
    onMount(body) {
      const slot = body.querySelector('[data-link-sheet]')

      const drawChoice = () => {
        slot.innerHTML = `
          <div class="form">
            <div class="field">
              <span class="field__label">Role nového člena</span>
              <div class="segmented" role="group" aria-label="Role">
                <button type="button" data-role="editor" aria-pressed="${role === 'editor'}">Editor</button>
                <button type="button" data-role="viewer" aria-pressed="${role === 'viewer'}">Pozorovatel</button>
              </div>
            </div>
            <p class="muted" style="font-size:.875rem">Odkaz platí 24 hodin a připojí jen jednoho člověka. Kdo ho získá, může se připojit – sdílejte ho jen s tím, koho chcete pozvat.</p>
            <button type="button" class="btn btn--primary btn--block" data-create>${icon('qr-code', { size: 18 })}<span class="spinner"></span>Vytvořit odkaz</button>
          </div>`
      }

      const drawLink = async ({ token, expires_at }) => {
        const url = inviteUrl(token)
        // QR vždy tmavý na bílém, aby ho přečetl každý fotoaparát i v tmavém režimu
        const { default: QRCode } = await import('qrcode') // načte se až při prvním odkazu
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1a1a1a', light: '#ffffff' } })
        slot.innerHTML = `
          <div class="stack invite-link">
            <div class="qr" role="img" aria-label="QR kód s odkazem do skupiny ${esc(group.name)}">${svg}</div>
            <p class="muted" style="font-size:.875rem;text-align:center">Platí do ${esc(formatDateTime(expires_at))} · jen pro jedno připojení</p>
            <label class="field">
              <span class="field__label">Odkaz</span>
              <input class="input" readonly value="${esc(url)}" data-url>
            </label>
            <div class="grid-2">
              ${navigator.share ? `<button type="button" class="btn" data-share>${icon('share', { size: 18 })}Sdílet</button>` : ''}
              <button type="button" class="btn ${navigator.share ? '' : 'btn--block'}" data-copy style="${navigator.share ? '' : 'grid-column:1 / -1'}">${icon('copy', { size: 18 })}Kopírovat odkaz</button>
            </div>
          </div>`
        slot.querySelector('[data-url]').addEventListener('focus', (e) => e.target.select())
        slot.querySelector('[data-copy]').addEventListener('click', () => copyText(url))
        slot.querySelector('[data-share]')?.addEventListener('click', async () => {
          try {
            await navigator.share({ title: 'Pozvánka do skupiny', text: `Připojte se ke skupině „${group.name}“ v Kalkulačce peněz.`, url })
          } catch (err) {
            if (err?.name !== 'AbortError') copyText(url)
          }
        })
      }

      drawChoice()
      slot.addEventListener('click', async (e) => {
        const roleBtn = e.target.closest('[data-role]')
        if (roleBtn) {
          role = roleBtn.dataset.role
          slot.querySelectorAll('[data-role]').forEach((b) => b.setAttribute('aria-pressed', String(b === roleBtn)))
          return
        }
        const create = e.target.closest('[data-create]')
        if (!create) return
        setLoading(create, true)
        try {
          const link = await createInviteLink(group.id, role)
          await drawLink(link)
          onCreated?.()
        } catch (err) {
          setLoading(create, false)
          showToast(translateError(err))
        }
      })
    },
  })
}
