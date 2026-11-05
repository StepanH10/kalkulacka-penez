// Jednoduchý globální stav s odběrem změn a offline cache v localStorage

const DATA_KEYS = ['accounts', 'categories', 'transactions', 'transfers', 'goals', 'entries', 'budgets', 'recurring', 'rules', 'subscriptions']

const emptyData = () => Object.fromEntries(DATA_KEYS.map((k) => [k, []]))

let state = {
  session: null,
  profile: null,
  // undefined = ještě nevybráno (načte se z localStorage), null = osobní, jinak id skupiny
  space: undefined,
  groups: [], // moje skupiny včetně mé role
  members: [], // členové aktuální skupiny (přezdívky)
  invites: [], // moje čekající pozvánky do skupin
  notifications: [], // posledních 50 upozornění (zvonek)
  ...emptyData(),
  loaded: false,
  offline: false,
}

const listeners = new Set()

export function getState() {
  return state
}

export function setState(patch) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn(state))
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function resetData() {
  setState({ profile: null, space: undefined, groups: [], members: [], invites: [], notifications: [], ...emptyData(), loaded: false, offline: false })
}

export { emptyData }

export function currentUser() {
  return state.session?.user ?? null
}

// Osobní prostor má původní klíč, skupiny vlastní (offline data zvlášť pro každý prostor)
const cacheKey = (userId, space = null) => (space ? `kp-cache-${userId}-${space}` : `kp-cache-${userId}`)

export function saveCache() {
  const user = currentUser()
  if (!user || state.space === undefined) return
  const snapshot = { profile: state.profile, groups: state.groups, members: state.members, savedAt: Date.now() }
  DATA_KEYS.forEach((k) => (snapshot[k] = state[k]))
  try {
    localStorage.setItem(cacheKey(user.id, state.space), JSON.stringify(snapshot))
  } catch {
    /* plné úložiště – cache je jen doplněk */
  }
}

export function loadCache(userId, space = null) {
  try {
    const raw = localStorage.getItem(cacheKey(userId, space))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Smaže cache prostoru, bez `space` všechny prostory uživatele. */
export function clearCache(userId, space) {
  try {
    if (space !== undefined) return localStorage.removeItem(cacheKey(userId, space))
    Object.keys(localStorage)
      .filter((k) => k === cacheKey(userId) || k.startsWith(`${cacheKey(userId)}-`))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* ignorovat */
  }
}

export { DATA_KEYS }
