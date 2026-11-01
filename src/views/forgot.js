import { authCard, field, submitButton } from './authLayout.js'
import { requestPasswordReset } from '../services/auth.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { validateEmail } from '../utils/validation.js'
import { translateError } from '../utils/errors.js'

export default function forgotView(root) {
  root.innerHTML = authCard({
    title: 'Zapomenuté heslo',
    subtitle: 'Pošleme vám odkaz pro nastavení nového hesla',
    content: `
      <form class="form" novalidate>
        ${field({ name: 'email', label: 'E-mail', type: 'email', autocomplete: 'email', inputmode: 'email' })}
        <div class="form-error" role="alert"></div>
        ${submitButton('Odeslat odkaz')}
      </form>`,
    links: `<a href="/login" data-link>Zpět na přihlášení</a>`,
  })

  const form = root.querySelector('form')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    clearErrors(form)
    const email = form.elements.email.value.trim()
    const error = validateEmail(email)
    if (error) return setFieldError(form, 'email', error)

    const button = form.querySelector('[type="submit"]')
    setLoading(button, true)
    try {
      await requestPasswordReset(email)
      form.outerHTML = `<div class="form-success">Pokud účet s e-mailem <strong>${esc(email)}</strong> existuje, poslali jsme na něj odkaz pro obnovení hesla. Zkontrolujte i složku spam.</div>`
    } catch (err) {
      form.querySelector('.form-error').textContent = translateError(err)
      setLoading(button, false)
    }
  })
}
