// Měsíční postřehy na Přehledu: jen výpočty nad transakcemi aktuálního prostoru.
// Bez závislostí na DOM / store. Každý postřeh nese `filter` pro obrazovku Transakce.
import { formatDate, parseISODate, toISODate, today } from './dates.js'
import { formatMoney } from './format.js'

const MAX_INSIGHTS = 4
const UPCOMING_DAYS = 7
// Kategorie s největší změnou: musí platit obojí, jinak je to jen šum
const CATEGORY_MIN_RATIO = 0.15
const CATEGORY_MIN_AMOUNT = 200

const dayMonth = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long' })
const round2 = (n) => Math.round(n * 100) / 100
const pct = (ratio) => Math.round(Math.abs(ratio) * 100)

/**
 * Období pro férové srovnání: od 1. dne měsíce do dneška a stejné dny minulého
 * měsíce. Kratší minulý měsíc se ořízne na jeho poslední den (31. 3. → 1.–28. 2.).
 */
export function comparableRanges(now = today()) {
  const base = parseISODate(now)
  const lastPrevDay = new Date(base.getFullYear(), base.getMonth(), 0).getDate()
  const prevMonth = (day) => toISODate(new Date(base.getFullYear(), base.getMonth() - 1, day))
  return {
    current: { from: toISODate(new Date(base.getFullYear(), base.getMonth(), 1)), to: now },
    previous: { from: prevMonth(1), to: prevMonth(Math.min(base.getDate(), lastPrevDay)) },
  }
}

/** „1.–5. listopadu“, u jediného dne „1. listopadu“. */
function rangeLabel({ from, to }) {
  const end = dayMonth.format(parseISODate(to))
  return from === to ? end : `${parseISODate(from).getDate()}.–${end}`
}

/**
 * Dost historie na srovnání: nejstarší transakce není novější než 1. den
 * minulého měsíce, jinak by se srovnávalo s neúplným obdobím.
 */
export function hasEnoughHistory(transactions, now = today()) {
  const { previous } = comparableRanges(now)
  return transactions.some((t) => t.date <= previous.from)
}

function expensesIn(transactions, { from, to }) {
  return transactions.filter((t) => t.type === 'expense' && t.date >= from && t.date <= to)
}

const sum = (list) => round2(list.reduce((s, t) => s + Number(t.amount), 0))

function monthComparison(transactions, ranges) {
  const current = sum(expensesIn(transactions, ranges.current))
  const previous = sum(expensesIn(transactions, ranges.previous))
  if (!previous) return null
  const diff = round2(current - previous)
  const ratio = diff / previous
  const period = `Výdaje ${rangeLabel(ranges.current)}`
  const filter = { period: 'custom', from: ranges.current.from, to: ranges.current.to, type: 'expense' }
  if (pct(ratio) === 0) {
    return {
      id: 'month-comparison',
      score: 40,
      icon: 'chart-pie',
      text: `${period}: stejně jako ${rangeLabel(ranges.previous)}`,
      filter,
    }
  }
  const more = diff > 0
  return {
    id: 'month-comparison',
    // růst výdajů je důležitější než úspora; malá změna nikoho nezajímá
    score: more && ratio >= 0.1 ? 80 : 45,
    icon: more ? 'trending-up' : 'trending-down',
    tone: more ? 'expense' : 'income',
    text: `${period}: o ${pct(ratio)} % ${more ? 'víc' : 'míň'} než ${rangeLabel(ranges.previous)} (${formatMoney(diff, { sign: true })})`,
    filter,
  }
}

/** Kategorie s největší absolutní změnou, která splní oba prahy. */
function categoryChange(transactions, categories, ranges, group) {
  const totals = new Map()
  const add = (list, key) => {
    for (const t of list) {
      if (!t.category_id) continue
      const row = totals.get(t.category_id) ?? { current: 0, previous: 0 }
      row[key] += Number(t.amount)
      totals.set(t.category_id, row)
    }
  }
  add(expensesIn(transactions, ranges.current), 'current')
  add(expensesIn(transactions, ranges.previous), 'previous')

  let best = null
  for (const [categoryId, { current, previous }] of totals) {
    // bez výdajů minule není procentní změna definovaná
    if (!previous) continue
    const diff = round2(current - previous)
    const ratio = Math.abs(diff) / previous
    if (ratio < CATEGORY_MIN_RATIO || Math.abs(diff) < CATEGORY_MIN_AMOUNT) continue
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { categoryId, diff, ratio }
  }
  if (!best) return null
  const name = categories.find((c) => c.id === best.categoryId)?.name
  if (!name) return null
  const more = best.diff > 0
  return {
    id: 'category-change',
    score: more ? 75 : 42,
    icon: more ? 'trending-up' : 'trending-down',
    tone: more ? 'expense' : 'income',
    text: `Za ${name} ${group ? 'jste utratili' : 'jsi utratil'} o ${pct(best.ratio)} % ${more ? 'víc' : 'míň'} než minule (${formatMoney(best.diff, { sign: true })})`,
    filter: { period: 'custom', from: ranges.current.from, to: ranges.current.to, type: 'expense', categories: [best.categoryId] },
  }
}

function largestExpense(transactions, categories, ranges) {
  const list = expensesIn(transactions, ranges.current)
  if (!list.length) return null
  const top = list.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a))
  const label = top.note?.trim() || categories.find((c) => c.id === top.category_id)?.name || 'Bez kategorie'
  const amount = Number(top.amount)
  return {
    id: 'largest-expense',
    score: 30,
    icon: 'receipt',
    text: `Největší výdaj: ${label} (${formatMoney(amount)})`,
    // přesně tahle částka v tomhle dni = odkaz na konkrétní transakci
    filter: { period: 'custom', from: top.date, to: top.date, type: 'expense', amountMin: amount, amountMax: amount },
  }
}

function savingsRate(transactions, ranges, group) {
  const inRange = transactions.filter((t) => t.date >= ranges.current.from && t.date <= ranges.current.to)
  const income = sum(inRange.filter((t) => t.type === 'income'))
  if (!income) return null
  const expense = sum(inRange.filter((t) => t.type === 'expense'))
  const left = round2(income - expense)
  const filter = { period: 'custom', from: ranges.current.from, to: ranges.current.to }
  if (left < 0) {
    return {
      id: 'savings-rate',
      score: 85,
      icon: 'triangle-alert',
      tone: 'expense',
      text: `Výdaje zatím převyšují příjmy o ${formatMoney(-left)}`,
      filter,
    }
  }
  return {
    id: 'savings-rate',
    score: 35,
    icon: 'piggy-bank',
    tone: 'income',
    text: `Z příjmů ${group ? 'vám' : 'ti'} zatím zbylo ${pct(left / income)} %`,
    filter,
  }
}

function daysLabel(days) {
  if (days === 0) return 'dnes'
  if (days === 1) return 'zítra'
  return days < 5 ? `za ${days} dny` : `za ${days} dní`
}

/** Nejbližší platba předplatného do 7 dní; upcoming = [{ name, amount, date, matchText }]. */
function upcomingSubscription(upcoming, now) {
  const base = parseISODate(now)
  const soon = upcoming
    .map((u) => ({ ...u, days: Math.round((parseISODate(u.date) - base) / 86400000) }))
    .filter((u) => u.days >= 0 && u.days <= UPCOMING_DAYS)
    .sort((a, b) => a.days - b.days)
  if (!soon.length) return null
  const [first] = soon
  const others = soon.length > 1 ? ` (a další ${soon.length - 1})` : ''
  return {
    id: 'upcoming-subscription',
    score: first.days <= 2 ? 90 : 70,
    icon: 'repeat',
    text: `${first.name}: platba ${formatMoney(first.amount)} ${daysLabel(first.days)}, ${formatDate(first.date)}${others}`,
    filter: { q: first.matchText },
  }
}

/**
 * Postřehy seřazené podle důležitosti, nejvýše 4.
 * enoughHistory: false → srovnání s minulým měsícem se nepočítají (karta to řekne),
 * postřehy jen z aktuálního měsíce platí dál.
 */
export function buildInsights({ transactions, categories, now = today(), group = false, upcoming = [] }) {
  const ranges = comparableRanges(now)
  const enoughHistory = hasEnoughHistory(transactions, now)
  const candidates = [
    enoughHistory && monthComparison(transactions, ranges),
    enoughHistory && categoryChange(transactions, categories, ranges, group),
    largestExpense(transactions, categories, ranges),
    savingsRate(transactions, ranges, group),
    upcomingSubscription(upcoming, now),
  ]
  const insights = candidates
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INSIGHTS)
  return { enoughHistory, insights }
}
