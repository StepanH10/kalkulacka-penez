import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'

let openCount = 0
let uid = 0

/**
 * Otevře bottom sheet (na desktopu dialog uprostřed).
 * onMount(bodyEl, close) – připojení posluchačů; vrácená funkce se zavolá při zavření.
 * dismissible: false – uživatel ho nemůže zavřít (křížek, Escape, klik vedle, stažení), jen kód přes close().
 */
export function openSheet({ title, body, onMount, onClose, dismissible = true }) {
  const id = `sheet-title-${++uid}`
  const previousFocus = document.activeElement

  const backdrop = document.createElement('div')
  backdrop.className = 'sheet-backdrop'

  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-labelledby', id)
  sheet.innerHTML = `
    <div class="sheet__handle"></div>
    <div class="sheet__head">
      <h2 id="${id}">${esc(title)}</h2>
      ${dismissible ? `<button type="button" class="icon-btn" data-close aria-label="Zavřít">${icon('x')}</button>` : ''}
    </div>
    <div class="sheet__body">${body}</div>`

  document.body.append(backdrop, sheet)
  openCount++
  document.body.style.overflow = 'hidden'

  let cleanup
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    cleanup?.()
    document.removeEventListener('keydown', onKey)
    backdrop.classList.remove('is-open')
    sheet.classList.remove('is-open')
    sheet.style.transform = ''
    setTimeout(() => {
      backdrop.remove()
      sheet.remove()
    }, 200)
    if (--openCount === 0) document.body.style.overflow = ''
    previousFocus?.focus?.({ preventScroll: true })
    onClose?.()
  }

  const onKey = (e) => {
    if (e.key === 'Escape' && dismissible) close()
  }
  document.addEventListener('keydown', onKey)
  if (dismissible) {
    backdrop.addEventListener('click', close)
    sheet.querySelector('[data-close]').addEventListener('click', close)
  }

  // Stažení dolů za horní lištu zavře sheet
  const head = sheet.querySelector('.sheet__handle')
  const headBar = sheet.querySelector('.sheet__head')
  let startY = null
  const onDown = (e) => {
    if (!dismissible || e.pointerType === 'mouse' || e.target.closest('button')) return
    startY = e.clientY
    sheet.style.transition = 'none'
  }
  const onMove = (e) => {
    if (startY === null) return
    const dy = Math.max(0, e.clientY - startY)
    sheet.style.transform = `translateY(${dy}px)`
  }
  const onUp = (e) => {
    if (startY === null) return
    const dy = e.clientY - startY
    startY = null
    sheet.style.transition = ''
    if (dy > 80) close()
    else sheet.style.transform = ''
  }
  for (const el of [head, headBar]) {
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', onDown)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)

  const bodyEl = sheet.querySelector('.sheet__body')
  const userCleanup = onMount?.(bodyEl, close)
  cleanup = () => {
    userCleanup?.()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  // Fokus synchronně, aby se na iOS otevřela klávesnice
  const autofocus = bodyEl.querySelector('[autofocus]') ?? sheet.querySelector('[data-close]')
  autofocus?.focus({ preventScroll: true })

  requestAnimationFrame(() => {
    backdrop.classList.add('is-open')
    sheet.classList.add('is-open')
  })

  return close
}

/** Potvrzovací dialog. Vrací Promise<boolean>. */
export function confirmDialog({ title, message, confirmLabel = 'Potvrdit', danger = false, requireText }) {
  return new Promise((resolve) => {
    let result = false
    openSheet({
      title,
      body: `
        <form class="form" novalidate>
          <p class="muted">${esc(message)}</p>
          ${
            requireText
              ? `<label class="field"><span class="field__label">Pro potvrzení napište <strong>${esc(requireText)}</strong></span>
                 <input class="input" name="confirm" autocomplete="off" ${requireText === requireText.toUpperCase() ? 'autocapitalize="characters"' : ''}></label>`
              : ''
          }
          <div class="sheet__actions">
            <button type="button" class="btn" data-cancel>Zrušit</button>
            <button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" ${requireText ? 'disabled' : ''}>${esc(confirmLabel)}</button>
          </div>
        </form>`,
      onMount(body, close) {
        const form = body.querySelector('form')
        const submit = form.querySelector('[type="submit"]')
        form.elements.confirm?.addEventListener('input', (e) => {
          // bez ohledu na velikost písmen (např. název skupiny)
          submit.disabled = e.target.value.trim().toLocaleLowerCase('cs') !== requireText.trim().toLocaleLowerCase('cs')
        })
        body.querySelector('[data-cancel]').addEventListener('click', close)
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          if (submit.disabled) return
          result = true
          close()
        })
      },
      onClose: () => resolve(result),
    })
  })
}
