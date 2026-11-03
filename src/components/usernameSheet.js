import { getState, subscribe } from '../state/store.js'
import { setUsername } from '../services/api.js'
import { signOut } from '../services/auth.js'
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { formatTag } from '../utils/format.js'
import { formatLongDate, toISODate } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'
import { validateUsername } from '../utils/validation.js'

const CHANGE_DAYS = 30

/** Pole „Přezdívka“ s živým náhledem tagu („jana#????“). */
export function usernameField({ value = '', discriminator = '????', autofocus = false } = {}) {
  return `
    <label class="field">
      <span class="field__label">Přezdívka</span>
      <input class="input" name="username" maxlength="20" autocomplete="nickname" autocapitalize="off" spellcheck="false"
        value="${esc(value)}" aria-describedby="err-username" ${autofocus ? 'autofocus' : ''}>
      <span class="field__hint">Váš tag: <strong class="tag" data-tag-preview data-discriminator="${esc(discriminator)}">${esc(value || 'jmeno')}#${esc(discriminator)}</strong></span>
      <span class="field__error" id="err-username" data-error-for="username"></span>
    </label>`
}

export function bindUsernamePreview(form) {
  const input = form.elements.username
  const preview = form.querySelector('[data-tag-preview]')
  input.addEventListener('input', () => {
    preview.textContent = `${input.value.trim() || 'jmeno'}#${preview.dataset.discriminator}`
    setFieldError(form, 'username', '')
  })
}

/** Datum, od kterého jde přezdívku znovu změnit (null = hned). */
export function nextUsernameChange(profile) {
  if (!profile?.username_changed_at) return null
  const next = new Date(profile.username_changed_at)
  next.setDate(next.getDate() + CHANGE_DAYS)
  return next > new Date() ? next : null
}

/**
 * Formulář přezdívky. required: první nastavení, okno nejde zavřít (jen odhlásit).
 * Vrací funkci pro zavření.
 */
export function openUsernameSheet({ required = false } = {}) {
  const profile = getState().profile
  const lockedUntil = required ? null : nextUsernameChange(profile)
  const hasTag = Boolean(profile?.username)

  const intro = required
    ? 'Přezdívka se v aplikaci zobrazuje místo e-mailu. K ní dostanete náhodné čtyřmístné číslo, podle kterého vás ostatní najdou.'
    : lockedUntil
      ? `Přezdívku lze měnit jednou za ${CHANGE_DAYS} dní. Další změna bude možná od ${formatLongDate(toISODate(lockedUntil))}.`
      : `Přezdívku lze měnit jednou za ${CHANGE_DAYS} dní. Číslo #${profile?.discriminator ?? '????'} zůstane, pokud je nová kombinace volná, jinak dostanete nové.`

  return openSheet({
    title: required ? 'Zvolte si přezdívku' : 'Změnit přezdívku',
    dismissible: !required,
    body: `
      <form class="form" novalidate>
        <p class="muted">${esc(intro)}</p>
        ${usernameField({ value: profile?.username ?? '', discriminator: hasTag ? profile.discriminator : '????', autofocus: !lockedUntil })}
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${required ? '<button type="button" class="btn" data-logout>Odhlásit se</button>' : ''}
          <button type="submit" class="btn btn--primary" ${lockedUntil ? 'disabled' : ''}><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      if (lockedUntil) form.elements.username.disabled = true
      bindUsernamePreview(form)

      body.querySelector('[data-logout]')?.addEventListener('click', async () => {
        try {
          await signOut()
        } catch {
          /* lokální odhlášení proběhlo i bez sítě */
        }
      })

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (lockedUntil) return
        clearErrors(form)
        const username = form.elements.username.value.trim()
        const error = validateUsername(username)
        if (error) {
          setFieldError(form, 'username', error)
          form.elements.username.focus()
          return
        }
        if (username === profile?.username) return close()
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          const saved = await setUsername(username)
          showToast(`Přezdívka uložena. Váš tag: ${formatTag(saved)}`, { duration: 6000 })
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

/** Přihlášenému uživateli bez přezdívky otevře okno, které nejde zavřít, dokud si ji nenastaví. */
export function watchMissingUsername() {
  let close = null
  const check = (state) => {
    const missing =
      state.session && state.loaded && !state.offline && state.profile && !state.profile.username &&
      location.pathname !== '/reset-password'
    if (missing && !close) {
      close = openUsernameSheet({ required: true })
    } else if (!missing && close) {
      close()
      close = null
    }
  }
  check(getState())
  return subscribe(check)
}
