// Jednoduchý globální stav s odběrem změn a offline cache v localStorage

const DATA_KEYS = ['accounts', 'categories', 'transactions', 'transfers', 'goals', 'entries', 'budgets', 'recurring']

const emptyData = () => Object.fromEntries(DATA_KEYS.map((k) => [k, []]))

let state = {
  session: null,
  profile: null,
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
  setState({ profile: null, ...emptyData(), loaded: false, offline: false })
}

export function currentUser() {
  return state.session?.user ?? null
}

const cacheKey = (userId) => `kp-cache-${userId}`

export function saveCache() {
  const user = currentUser()
  if (!user) return
  const snapshot = { profile: state.profile, savedAt: Date.now() }
  DATA_KEYS.forEach((k) => (snapshot[k] = state[k]))
  try {
    localStorage.setItem(cacheKey(user.id), JSON.stringify(snapshot))
  } catch {
    /* plné úložiště – cache je jen doplněk */
  }
}

export function loadCache(userId) {
  try {
    const raw = localStorage.getItem(cacheKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function clearCache(userId) {
  try {
    localStorage.removeItem(cacheKey(userId))
  } catch {
    /* ignorovat */
  }
}

export { DATA_KEYS }
