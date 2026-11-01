import { authCard, field, passwordField, submitButton, bindPasswordToggles } from './authLayout.js'
import { signUp } from '../services/auth.js'
import { navigate } from '../router.js'
import { setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { validateEmail, validatePassword, validatePasswordConfirm, validateName } from '../utils/validation.js'
import { translateError } from '../utils/errors.js'

export default function registerView(root) {
  root.innerHTML = authCard({
    title: 'Vytvořit účet',
    subtitle: 'Začněte mít přehled o svých penězích',
    content: `
      <form class="form" novalidate>
        ${field({ name: 'name', label: 'Zobrazované jméno', autocomplete: 'name', placeholder: 'Např. Jana' })}
        ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email' })}
        ${passwordField({ name: 'password', label: 'Heslo (alespoň 8 znaků)', autocomplete: 'new-password' })}
        ${passwordField({ name: 'confirm', label: 'Potvrzení hesla', autocomplete: 'new-password' })}
        <div class="form-error" role="alert"></div>
        ${submitButton('Zaregistrovat se')}
      </form>`,
    links: `<span>Už máte účet? <a href="/login" data-link>Přihlaste se</a></span>`,
  })

  const form = root.querySelector('form')
  const offToggle = bindPasswordToggles(root)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors(form)
    const name = form.elements.name.value.trim()
    const email = form.elements.email.value.trim()
    const password = form.elements.password.value
    const confirm = form.elements.confirm.value

    const errors = {
      name: validateName(name, 'jméno'),
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: validatePasswordConfirm(password, confirm),
    }
    Object.entries(errors).forEach(([k, v]) => setFieldError(form, k, v))
    const firstInvalid = Object.keys(errors).find((k) => errors[k])
    if (firstInvalid) {
      form.elements[firstInvalid].focus()
      return
    }

    const button = form.querySelector('[type="submit"]')
    setLoading(button, true)
    try {
      const { needsConfirmation } = await signUp({ email, password, displayName: name })
      if (needsConfirmation) {
        sessionStorage.setItem(
          'kp-auth-notice',
          'Účet je vytvořený. Na váš e-mail jsme poslali odkaz pro potvrzení – po kliknutí se můžete přihlásit.',
        )
        navigate('/login', { replace: true })
      }
      // Bez potvrzování e-mailu je uživatel rovnou přihlášen (onAuthStateChange)
    } catch (err) {
      form.querySelector('.form-error').textContent = translateError(err)
      setLoading(button, false)
    }
  })

  return offToggle
}
