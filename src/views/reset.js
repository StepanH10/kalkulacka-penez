import { authCard, passwordField, submitButton, bindPasswordToggles } from './authLayout.js'
import { updatePassword } from '../services/auth.js'
import { getState } from '../state/store.js'
import { navigate } from '../router.js'
import { showToast } from '../components/toast.js'
import { setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { validatePassword, validatePasswordConfirm } from '../utils/validation.js'
import { translateError } from '../utils/errors.js'

export default function resetView(root) {
  // Odkaz z e-mailu přihlásí uživatele dočasnou session; bez ní je odkaz neplatný
  const hashError = new URLSearchParams(location.hash.slice(1)).get('error_description')
  if (!getState().session) {
    root.innerHTML = authCard({
      title: 'Odkaz není platný',
      subtitle: hashError ? 'Odkaz pro obnovení hesla vypršel nebo už byl použit.' : 'Otevřete odkaz z e-mailu znovu, nebo si nechte poslat nový.',
      content: `<a class="btn btn--primary btn--block" href="/forgot-password" data-link>Poslat nový odkaz</a>`,
      links: `<a href="/login" data-link>Zpět na přihlášení</a>`,
    })
    return
  }

  root.innerHTML = authCard({
    title: 'Nové heslo',
    subtitle: 'Zvolte si nové heslo k účtu',
    content: `
      <form class="form" novalidate>
        ${passwordField({ name: 'password', label: 'Nové heslo (alespoň 8 znaků)', autocomplete: 'new-password' })}
        ${passwordField({ name: 'confirm', label: 'Potvrzení hesla', autocomplete: 'new-password' })}
        <div class="form-error" role="alert"></div>
        ${submitButton('Uložit heslo')}
      </form>`,
  })

  const form = root.querySelector('form')
  const offToggle = bindPasswordToggles(root)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors(form)
    const password = form.elements.password.value
    const confirm = form.elements.confirm.value
    const pErr = validatePassword(password)
    const cErr = validatePasswordConfirm(password, confirm)
    setFieldError(form, 'password', pErr)
    setFieldError(form, 'confirm', cErr)
    if (pErr || cErr) return

    const button = form.querySelector('[type="submit"]')
    setLoading(button, true)
    try {
      await updatePassword(password)
      showToast('Heslo bylo změněno')
      navigate('/', { replace: true })
    } catch (err) {
      form.querySelector('.form-error').textContent = translateError(err)
      setLoading(button, false)
    }
  })

  return offToggle
}
