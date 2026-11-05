// Filtry obrazovky Transakce: platí po dobu relace (sessionStorage), zvlášť pro
// uživatele a prostor. Po přepnutí prostoru se začíná znovu, protože kategorie,
// účty i členové jsou v každém prostoru jiní.
import { getState, currentUser } from './store.js'
import { emptyFilter } from '../utils/transactionFilter.js'

const STORAGE_KEY = 'kp-transaction-filter'

const ownerKey = () => `${currentUser()?.id ?? ''}:${getState().space ?? ''}`

let held = null

function read() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

/** Aktuální filtr. `monthOffset` je měsíc, na kterém se bez filtru listuje. */
export function getTransactionFilter() {
  const owner = ownerKey()
  if (held?.owner !== owner) {
    const saved = read()
    held =
      saved?.owner === owner
        ? { owner, monthOffset: saved.monthOffset ?? 0, filter: { ...emptyFilter(), ...saved.filter } }
        : { owner, monthOffset: 0, filter: emptyFilter() }
  }
  return held
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(held))
  } catch {
    /* nevadí – filtr pak vydrží jen do obnovení stránky */
  }
}

export function setTransactionFilter(filter) {
  held = { ...getTransactionFilter(), filter }
  persist()
}

export function setMonthOffset(monthOffset) {
  held = { ...getTransactionFilter(), monthOffset }
  persist()
}
