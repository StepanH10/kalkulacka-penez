// Předplatná aktuálního prostoru: výpočet se drží, dokud se nezmění data nebo den
// (Přehled se překresluje při každé změně stavu), a připomínka návrhů detektoru.
import { getState, currentUser } from './store.js'
import { buildSubscriptionData, addDays } from '../utils/subscriptions.js'
import { today } from '../utils/dates.js'

const HINT_EVERY_DAYS = 14

let memo = null

export function subscriptionData(state = getState()) {
  const now = today()
  if (memo?.transactions !== state.transactions || memo?.subscriptions !== state.subscriptions || memo?.now !== now) {
    memo = {
      transactions: state.transactions,
      subscriptions: state.subscriptions,
      now,
      data: buildSubscriptionData({ subscriptions: state.subscriptions, transactions: state.transactions, now }),
    }
  }
  return memo.data
}

const hintKey = () => `kp-subscription-hint-${currentUser()?.id ?? ''}-${getState().space ?? 'personal'}`

function readHint() {
  try {
    return JSON.parse(localStorage.getItem(hintKey()))
  } catch {
    return null
  }
}

/** Postřeh „Našli jsme…“ znovu až po 14 dnech, nebo když přibude nový návrh. */
export function suggestionHintDue(count) {
  if (!count) return false
  const seen = readHint()
  return !seen || count > seen.count || addDays(seen.at, HINT_EVERY_DAYS) <= today()
}

/** Volá tracker, když návrhy ukáže: uživatel o nich už ví. */
export function markSuggestionHintSeen(count) {
  if (!suggestionHintDue(count)) return
  try {
    localStorage.setItem(hintKey(), JSON.stringify({ at: today(), count }))
  } catch {
    /* nevadí – připomínka se ukáže znovu */
  }
}
