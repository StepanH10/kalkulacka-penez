import { esc } from '../utils/dom.js'

let container

function ensureContainer() {
  if (!container) {
    container = document.createElement('div')
    container.className = 'toasts'
    container.setAttribute('role', 'status')
    container.setAttribute('aria-live', 'polite')
    document.body.append(container)
  }
  return container
}

/** Krátké oznámení dole na obrazovce, volitelně s akcí (např. „Zpět“). */
export function showToast(message, { actionLabel, onAction, duration = 4000 } = {}) {
  const root = ensureContainer()
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ''}`
  root.append(el)
  requestAnimationFrame(() => el.classList.add('is-visible'))

  let timer
  const close = () => {
    clearTimeout(timer)
    el.classList.remove('is-visible')
    setTimeout(() => el.remove(), 200)
  }
  timer = setTimeout(close, actionLabel ? Math.max(duration, 5000) : duration)

  el.querySelector('button')?.addEventListener('click', () => {
    close()
    onAction?.()
  })
  return close
}
