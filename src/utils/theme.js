const KEY = 'kp-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

/** 'system' | 'light' | 'dark' */
export function getThemePreference() {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function isDark() {
  const pref = getThemePreference()
  return pref === 'dark' || (pref === 'system' && media.matches)
}

function apply() {
  const pref = getThemePreference()
  if (pref === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = pref
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark() ? '#121212' : '#FAFAF7')
  window.dispatchEvent(new CustomEvent('themechange'))
}

export function setThemePreference(pref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    /* localStorage nemusí být dostupné */
  }
  apply()
}

export function initTheme() {
  apply()
  media.addEventListener('change', () => {
    if (getThemePreference() === 'system') apply()
  })
}

/** Hodnota CSS proměnné (pro Chart.js). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
