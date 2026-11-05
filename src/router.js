import { getState } from './state/store.js'
import { ensureShell, destroyShell, setActiveNav } from './components/shell.js'

import loginView from './views/login.js'
import registerView from './views/register.js'
import forgotView from './views/forgot.js'
import resetView from './views/reset.js'
import overviewView from './views/overview.js'
import transactionsView from './views/transactions.js'
import statsView from './views/stats.js'
import savingsView from './views/savings.js'
import settingsView from './views/settings.js'
import accountsView from './views/settings/accounts.js'
import categoriesView from './views/settings/categories.js'
import budgetsView from './views/settings/budgets.js'
import recurringView from './views/settings/recurring.js'
import groupView from './views/settings/group.js'
import rulesView from './views/settings/rules.js'
import joinView from './views/join.js'

// guest: jen pro nepřihlášené, auth: jen pro přihlášené, jinak veřejné
const ROUTES = {
  '/login': { view: loginView, guest: true, title: 'Přihlášení' },
  '/register': { view: registerView, guest: true, title: 'Registrace' },
  '/forgot-password': { view: forgotView, guest: true, title: 'Zapomenuté heslo' },
  '/reset-password': { view: resetView, title: 'Nové heslo' },
  '/': { view: overviewView, auth: true, nav: 'overview', title: 'Přehled' },
  '/transactions': { view: transactionsView, auth: true, nav: 'overview', title: 'Transakce' },
  '/stats': { view: statsView, auth: true, nav: 'stats', title: 'Statistiky' },
  '/savings': { view: savingsView, auth: true, nav: 'savings', title: 'Spoření' },
  '/settings': { view: settingsView, auth: true, nav: 'settings', title: 'Nastavení' },
  '/settings/accounts': { view: accountsView, auth: true, nav: 'settings', title: 'Účty' },
  '/settings/categories': { view: categoriesView, auth: true, nav: 'settings', title: 'Kategorie' },
  '/settings/budgets': { view: budgetsView, auth: true, nav: 'settings', title: 'Rozpočty' },
  '/settings/recurring': { view: recurringView, auth: true, nav: 'settings', title: 'Opakované platby' },
  '/settings/rules': { view: rulesView, auth: true, nav: 'settings', title: 'Pravidla importu' },
  '/settings/group': { view: groupView, auth: true, nav: 'settings', title: 'Skupina' },
}

// Dynamické trasy (s parametrem v cestě)
const JOIN_ROUTE = { view: joinView, auth: true, nav: 'overview', title: 'Pozvánka' }

function resolveRoute(path) {
  if (ROUTES[path]) return ROUTES[path]
  if (/^\/join\/[^/]+$/.test(path)) return JOIN_ROUTE
  return null
}

// Kam se vrátit po přihlášení (např. odkaz /join/… otevřený bez přihlášení).
// localStorage, aby přežil i potvrzení e-mailu v nové záložce; platí hodinu.
const RETURN_KEY = 'kp-return'

function rememberReturn(path) {
  try {
    localStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() }))
  } catch {
    /* nevadí */
  }
}

export function consumeReturnPath() {
  try {
    const saved = JSON.parse(localStorage.getItem(RETURN_KEY))
    localStorage.removeItem(RETURN_KEY)
    if (saved?.path?.startsWith('/') && Date.now() - saved.at < 3_600_000) return saved.path
  } catch {
    /* nevadí */
  }
  return null
}

let root
let cleanup = null
let ensureData = async () => {}

export function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname + location.search) {
    history[replace ? 'replaceState' : 'pushState'](null, '', path)
  }
  render()
}

async function render() {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const route = resolveRoute(path)
  const loggedIn = Boolean(getState().session)

  if (!route) return navigate(loggedIn ? '/' : '/login', { replace: true })
  if (route.auth && !loggedIn) {
    if (path.startsWith('/join/')) {
      rememberReturn(path)
      sessionStorage.setItem('kp-auth-notice', 'Pro připojení ke skupině se přihlaste nebo si vytvořte účet.')
    }
    return navigate('/login', { replace: true })
  }
  if (route.guest && loggedIn) return navigate(consumeReturnPath() ?? '/', { replace: true })

  cleanup?.()
  cleanup = null
  document.title = `${route.title} · Kalkulačka peněz`

  let container
  if (route.auth) {
    container = ensureShell(root)
    setActiveNav(route.nav)
    if (!getState().loaded) {
      container.innerHTML = '<div class="boot">Načítám…</div>'
      try {
        await ensureData()
      } catch {
        container.innerHTML = '<div class="empty"><p>Data se nepodařilo načíst. Zkontrolujte připojení a obnovte stránku.</p></div>'
        return
      }
      // Během načítání mohl uživatel přejít jinam
      if ((location.pathname.replace(/\/+$/, '') || '/') !== path) return
    }
  } else {
    destroyShell()
    container = root
  }

  window.scrollTo(0, 0)
  cleanup = route.view(container) ?? null
}

/** Spustí router. loadData se zavolá před první chráněnou obrazovkou. */
export function startRouter(rootEl, { loadData }) {
  root = rootEl
  ensureData = loadData
  window.addEventListener('popstate', render)
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return
    e.preventDefault()
    navigate(a.getAttribute('href'))
  })
  render()
}
