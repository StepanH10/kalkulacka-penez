import { previewInviteToken, acceptInviteToken } from '../services/invites.js'
import { switchSpace } from '../services/groups.js'
import { showToast } from '../components/toast.js'
import { navigate } from '../router.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { translateError } from '../utils/errors.js'

const ROLE_AS = { editor: 'editor – může přidávat a upravovat záznamy', viewer: 'pozorovatel – může jen číst' }

/** /join/<token>: náhled skupiny a „Připojit se“. Každé zobrazení je jeden pokus (limit 20/h). */
export default function joinView(el) {
  const token = decodeURIComponent(location.pathname.split('/')[2] ?? '')
  let alive = true

  const card = (content) => {
    el.innerHTML = `
      <header class="page-header"><h1>Pozvánka</h1></header>
      <div class="card join-card">${content}</div>`
  }

  const showError = (message) =>
    card(`
      <div class="join-card__icon">${icon('link', { size: 24 })}</div>
      <p>${esc(message)}</p>
      <a class="btn btn--block" href="/" data-link>Zpět na přehled</a>`)

  card('<p class="muted">Ověřuji pozvánku…</p>')

  previewInviteToken(token)
    .then((preview) => {
      if (!alive) return
      if (preview.already_member) {
        card(`
          <div class="join-card__icon">${icon('users', { size: 24 })}</div>
          <h2>${esc(preview.group_name)}</h2>
          <p class="muted">Už jste členem této skupiny.</p>
          <a class="btn btn--primary btn--block" href="/" data-link>Na přehled</a>`)
        return
      }
      card(`
        <div class="join-card__icon">${icon('users', { size: 24 })}</div>
        <p class="muted">Byli jste pozváni do skupiny</p>
        <h2>${esc(preview.group_name)}</h2>
        <p class="muted">Role: ${esc(ROLE_AS[preview.role] ?? preview.role)}</p>
        <p class="muted" style="font-size:.875rem">Uvidíte společné účty, transakce a cíle skupiny. Vaše osobní data zůstanou soukromá.</p>
        <button type="button" class="btn btn--primary btn--block" data-join><span class="spinner"></span>Připojit se</button>
        <a class="btn btn--ghost btn--block" href="/" data-link>Teď ne</a>`)
    })
    .catch((err) => alive && showError(translateError(err)))

  const onClick = async (e) => {
    const button = e.target.closest('[data-join]')
    if (!button) return
    setLoading(button, true)
    try {
      const groupId = await acceptInviteToken(token)
      await switchSpace(groupId)
      showToast('Jste členem skupiny')
      navigate('/', { replace: true })
    } catch (err) {
      showError(translateError(err))
    }
  }

  el.addEventListener('click', onClick)
  return () => {
    alive = false
    el.removeEventListener('click', onClick)
  }
}
