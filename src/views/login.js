import { authCard, field, passwordField, submitButton, bindPasswordToggles } from './authLayout.js'
import { signIn } from '../services/auth.js'
import { setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { validateEmail } from '../utils/validation.js'
import { translateError } from '../utils/errors.js'

export default function loginView(root) {
  const notice = sessionStorage.getItem('kp-auth-notice')
  sessionStorage.removeItem('kp-auth-notice')

  root.innerHTML = authCard({
    title: 'Kalkulačka peněz',
    subtitle: 'Přihlaste se ke svému účtu',
    content: `
      <form class="form" novalidate>
        ${notice ? `<div class="form-success">${notice}</div>` : ''}
        ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email' })}
        ${passwordField({ name: 'password', label: 'Heslo' })}
        <div class="auth__row"><a href="/forgot-password" data-link>Zapomenuté heslo?</a></div>
        <div class="form-error" role="alert"></div>
        ${submitButton('Přihlásit se')}
      </form>`,
    links: `<span>Nemáte účet? <a href="/register" data-link>Zaregistrujte se</a></span>`,
  })

  const form = root.querySelector('form')
  const offToggle = bindPasswordToggles(root)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors(form)
    const email = form.elements.email.value.trim()
    const password = form.elements.password.value
    const emailError = validateEmail(email)
    setFieldError(form, 'email', emailError)
    setFieldError(form, 'password', password ? '' : 'Zadejte heslo.')
    if (emailError || !password) return

    const button = form.querySelector('[type="submit"]')
    setLoading(button, true)
    try {
      await signIn({ email, password })
      // Přesměrování zajistí onAuthStateChange v main.js
    } catch (err) {
      form.querySelector('.form-error').textContent = translateError(err)
      setLoading(button, false)
    }
  })

  return offToggle
}
