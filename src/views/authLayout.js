import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'

/** Centrovaná karta pro přihlášení / registraci. */
export function authCard({ title, subtitle, content, links = '' }) {
  return `
    <div class="auth">
      <div class="auth__card">
        <div class="auth__brand">
          <img src="/favicon.svg" alt="">
          <div>
            <h1>${esc(title)}</h1>
          </div>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        ${content}
        ${links ? `<div class="auth__links">${links}</div>` : ''}
      </div>
    </div>`
}

export function field({ name, label, type = 'text', autocomplete = '', placeholder = '', value = '', inputmode = '' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <input class="input" name="${name}" type="${type}" autocomplete="${autocomplete}" placeholder="${esc(placeholder)}"
        value="${esc(value)}" ${inputmode ? `inputmode="${inputmode}"` : ''} aria-describedby="err-${name}">
      <span class="field__error" id="err-${name}" data-error-for="${name}"></span>
    </label>`
}

export function passwordField({ name, label, autocomplete = 'current-password' }) {
  return `
    <label class="field">
      <span class="field__label">${esc(label)}</span>
      <span class="input-group">
        <input class="input" name="${name}" type="password" autocomplete="${autocomplete}" aria-describedby="err-${name}">
        <button type="button" class="icon-btn" data-toggle-password aria-label="Zobrazit heslo">${icon('eye')}</button>
      </span>
      <span class="field__error" id="err-${name}" data-error-for="${name}"></span>
    </label>`
}

export function submitButton(label) {
  return `<button type="submit" class="btn btn--primary btn--block"><span class="spinner"></span>${esc(label)}</button>`
}

/** Přepínání viditelnosti hesla. */
export function bindPasswordToggles(root) {
  const handler = (e) => {
    const btn = e.target.closest('[data-toggle-password]')
    if (!btn) return
    const input = btn.parentElement.querySelector('input')
    const show = input.type === 'password'
    input.type = show ? 'text' : 'password'
    btn.innerHTML = icon(show ? 'eye-off' : 'eye')
    btn.setAttribute('aria-label', show ? 'Skrýt heslo' : 'Zobrazit heslo')
  }
  root.addEventListener('click', handler)
  return () => root.removeEventListener('click', handler)
}
