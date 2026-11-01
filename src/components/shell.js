import { icon } from '../utils/icons.js'
import { subscribe, getState } from '../state/store.js'
import { openTransactionSheet } from './transactionSheet.js'

const NAV = [
  ['overview', '/', 'Přehled', 'house'],
  ['stats', '/stats', 'Statistiky', 'chart-pie'],
  ['savings', '/savings', 'Spoření', 'piggy-bank'],
  ['settings', '/settings', 'Nastavení', 'settings'],
]

let shell = null

/** Vykreslí layout s navigací a vrátí kontejner pro obsah obrazovky. */
export function ensureShell(root) {
  if (shell) return shell.view
  root.innerHTML = `
    <div class="app-shell">
      <nav class="nav" aria-label="Hlavní navigace">
        <div class="nav__brand"><img src="/favicon.svg" alt="">Kalkulačka peněz</div>
        ${NAV.map(
          ([key, href, label, ic]) =>
            `<a class="nav__link" href="${href}" data-link data-nav="${key}">${icon(ic, { size: 22 })}<span>${label}</span></a>`,
        ).join('')}
      </nav>
      <main class="main">
        <div data-offline></div>
        <div data-view></div>
      </main>
    </div>
    <button type="button" class="fab" aria-label="Přidat transakci">${icon('plus', { size: 26, strokeWidth: 2 })}</button>`

  const offlineSlot = root.querySelector('[data-offline]')
  const renderOffline = () => {
    const offline = getState().offline || !navigator.onLine
    offlineSlot.innerHTML = offline
      ? `<div class="offline-banner">${icon('wifi-off', { size: 18 })}Offline – zobrazují se naposledy načtená data.</div>`
      : ''
  }
  renderOffline()
  const unsub = subscribe(renderOffline)
  window.addEventListener('online', renderOffline)
  window.addEventListener('offline', renderOffline)
  root.querySelector('.fab').addEventListener('click', () => openTransactionSheet())

  shell = {
    view: root.querySelector('[data-view]'),
    root,
    destroy() {
      unsub()
      window.removeEventListener('online', renderOffline)
      window.removeEventListener('offline', renderOffline)
    },
  }
  return shell.view
}

export function destroyShell() {
  if (!shell) return
  shell.destroy()
  shell = null
}

export function setActiveNav(key) {
  if (!shell) return
  shell.root.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === key
    a.classList.toggle('is-active', active)
    if (active) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
}
