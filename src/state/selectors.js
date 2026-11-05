import { getState } from './store.js'
import { monthRange } from '../utils/dates.js'

const num = (v) => Number(v) || 0

export function categoryMap(state = getState()) {
  return new Map(state.categories.map((c) => [c.id, c]))
}

export function accountMap(state = getState()) {
  return new Map(state.accounts.map((a) => [a.id, a]))
}

export function categoriesByType(type, state = getState()) {
  return state.categories
    .filter((c) => c.type === type)
    .sort((a, b) => a.created_at?.localeCompare(b.created_at ?? '') || a.name.localeCompare(b.name, 'cs'))
}

/**
 * Zůstatky všech účtů: Map(accountId → číslo).
 * Zůstatek = počáteční zůstatek + transakce a převody s datem od opening_balance_date.
 * Účet bez počátečního zůstatku se počítá ze všech pohybů.
 */
export function accountBalances(state = getState()) {
  const balances = new Map(state.accounts.map((a) => [a.id, num(a.opening_balance)]))
  const since = new Map(state.accounts.map((a) => [a.id, a.opening_balance_date ?? '']))
  const add = (id, date, amount) => {
    if (balances.has(id) && date >= since.get(id)) balances.set(id, balances.get(id) + amount)
  }
  for (const t of state.transactions) add(t.account_id, t.date, t.type === 'income' ? num(t.amount) : -num(t.amount))
  for (const t of state.transfers) {
    add(t.from_account_id, t.date, -num(t.amount))
    add(t.to_account_id, t.date, num(t.amount))
  }
  for (const [id, value] of balances) balances.set(id, Math.round(value * 100) / 100)
  return balances
}

/** Počet pohybů účtu starších než datum (při tomto počátečním zůstatku se nepočítají). */
export function movementsBefore(accountId, date, state = getState()) {
  if (!date) return 0
  const older = (t) => t.date < date
  return (
    state.transactions.filter((t) => t.account_id === accountId && older(t)).length +
    state.transfers.filter((t) => (t.from_account_id === accountId || t.to_account_id === accountId) && older(t)).length
  )
}

export function totalBalance(state = getState()) {
  let sum = 0
  for (const v of accountBalances(state).values()) sum += v
  return sum
}

export function transactionsInRange(from, to, { categoryId = '' } = {}, state = getState()) {
  return state.transactions.filter(
    (t) => t.date >= from && t.date <= to && (!categoryId || t.category_id === categoryId),
  )
}

export function totals(transactions) {
  let income = 0
  let expense = 0
  for (const t of transactions) {
    if (t.type === 'income') income += num(t.amount)
    else expense += num(t.amount)
  }
  return { income, expense, net: income - expense }
}

/** Utracená částka v kategorii za měsíc daného data. */
export function spentInMonth(categoryId, isoDate, state = getState()) {
  const base = isoDate ? new Date(`${isoDate}T12:00:00`) : new Date()
  const { from, to } = monthRange(0, base)
  return state.transactions
    .filter((t) => t.type === 'expense' && t.category_id === categoryId && t.date >= from && t.date <= to)
    .reduce((s, t) => s + num(t.amount), 0)
}

/** Stav rozpočtů za aktuální měsíc. */
export function budgetStatus(state = getState()) {
  const cats = categoryMap(state)
  return state.budgets
    .map((b) => {
      const spent = spentInMonth(b.category_id, null, state)
      const limit = num(b.monthly_limit)
      return { budget: b, category: cats.get(b.category_id), spent, limit, ratio: limit ? spent / limit : 0 }
    })
    .filter((b) => b.category)
    .sort((a, b) => b.ratio - a.ratio)
}

export function goalSaved(goalId, state = getState()) {
  return state.entries.filter((e) => e.goal_id === goalId).reduce((s, e) => s + num(e.amount), 0)
}

export const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? '')

/** Transakce a převody v jednom seznamu, od nejnovějších. */
export function feedItems({ from = '', to = '9999-12-31', limit = Infinity } = {}, state = getState()) {
  const items = [
    ...state.transactions.filter((t) => t.date >= from && t.date <= to).map((t) => ({ kind: 'transaction', ...t })),
    ...state.transfers.filter((t) => t.date >= from && t.date <= to).map((t) => ({ kind: 'transfer', ...t })),
  ]
  return items.sort(byNewest).slice(0, limit)
}
