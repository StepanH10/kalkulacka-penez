const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapuje text pro bezpečné vložení do HTML šablony. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c])
}

export function qs(selector, root = document) {
  return root.querySelector(selector)
}

export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)]
}

/** Delegovaný posluchač: on(root, 'click', '[data-action]', (e, el) => …) */
export function on(root, type, selector, handler) {
  const listener = (event) => {
    const el = event.target.closest(selector)
    if (el && root.contains(el)) handler(event, el)
  }
  root.addEventListener(type, listener)
  return () => root.removeEventListener(type, listener)
}

/** Přepne tlačítko do stavu načítání. Vrací funkci pro obnovení. */
export function setLoading(button, loading) {
  if (!button) return
  button.disabled = loading
  button.classList.toggle('is-loading', loading)
  button.setAttribute('aria-busy', String(loading))
}

export function setFieldError(form, name, message) {
  const input = form.elements[name]
  const error = form.querySelector(`[data-error-for="${name}"]`)
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false')
  if (error) error.textContent = message || ''
}

export function clearErrors(form) {
  qsa('[aria-invalid]', form).forEach((el) => el.setAttribute('aria-invalid', 'false'))
  qsa('[data-error-for]', form).forEach((el) => (el.textContent = ''))
  const formError = form.querySelector('.form-error')
  if (formError) formError.textContent = ''
}

/** Stáhne soubor vytvořený v prohlížeči. */
export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
