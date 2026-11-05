// Předplatná: detektor a párování s transakcemi. Vše se počítá na klientu nad
// transakcemi aktuálního prostoru a nic se nikam nezapisuje (detektor nikdy
// nevytváří transakce). Bez závislostí na DOM / store.
import { normalizeText } from '../importers/utils.js'
import { formatMoney } from './format.js'
import { formatDate, parseISODate, toISODate, today } from './dates.js'

/** Povolené odstupy plateb ve dnech a přepočet na rok. */
export const INTERVALS = {
  weekly: { label: 'týdně', minDays: 6, maxDays: 8, perYear: 52, months: 0 },
  monthly: { label: 'měsíčně', minDays: 26, maxDays: 35, perYear: 12, months: 1 },
  quarterly: { label: 'čtvrtletně', minDays: 85, maxDays: 95, perYear: 4, months: 3 },
  yearly: { label: 'ročně', minDays: 350, maxDays: 380, perYear: 1, months: 12 },
}

const MIN_PAYMENTS = 3
const MIN_PAYMENTS_YEARLY = 2
const MIN_PAYMENTS_WITH_GAP = 4
const AMOUNT_SPREAD = 0.15
const MISSING_GRACE_DAYS = 5
const MATCH_TEXT_MAX = 60

// Obecné popisy z výpisů bank neříkají, komu se platilo
const GENERIC_NOTES = new Set(['bez popisu', 'odchozi platba', 'prichozi platba', 'platba kartou', 'odchozi uhrada', 'uhrada', 'trvaly prikaz', 'inkaso', 'nakup'])

/** Nápověda pro pojmenování a pořadí návrhů; detekce funguje i bez ní (např. nájem). */
const KNOWN_SERVICES = [
  [/netflix/, 'Netflix'],
  [/spotify/, 'Spotify'],
  [/youtube/, 'YouTube'],
  [/disney/, 'Disney+'],
  [/hbo|\bmax\.com\b/, 'HBO Max'],
  [/audible/, 'Audible'],
  [/storytel/, 'Storytel'],
  [/openai|chatgpt/, 'ChatGPT'],
  [/anthropic|claude/, 'Claude'],
  [/xbox/, 'Xbox'],
  [/playstation|\bpsn\b|sony interactive/, 'PlayStation'],
  [/adobe/, 'Adobe'],
  [/microsoft|\bmsft\b/, 'Microsoft'],
  [/apple/, 'Apple'],
  [/google/, 'Google'],
  [/t-mobile|tmobile/, 'T-Mobile'],
  [/vodafone/, 'Vodafone'],
  [/\bo2\b/, 'O2'],
  [/posilovna|fitness|\bgym\b/, 'Posilovna'],
]

const daysBetween = (from, to) => Math.round((parseISODate(to) - parseISODate(from)) / 86400000)

export function addDays(iso, days) {
  const d = parseISODate(iso)
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}

/** Datum po `times` intervalech. Konec měsíce se ořízne (31. 1. + měsíc = 28. 2.). */
export function addInterval(iso, interval, times = 1) {
  const { months } = INTERVALS[interval]
  if (!months) return addDays(iso, 7 * times)
  const d = parseISODate(iso)
  const target = new Date(d.getFullYear(), d.getMonth() + months * times, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), lastDay))
  return toISODate(target)
}

/**
 * Obchodník z poznámky: bez diakritiky, malá písmena, jen první část složeného
 * popisu z importu („protistrana – zpráva“), bez čísel a ID na konci.
 * „NETFLIX.COM 12345“ → „netflix.com“. Obecný nebo prázdný popis → ''.
 */
export function normalizeMerchant(note) {
  const first = normalizeText(note)
    .replace(/^storno – /, '')
    .split(' – ')[0]
  const words = first.split(' ').filter(Boolean)
  // poslední slovo se nikdy neodstraní, jinak by z „O2 123“ nezbylo nic
  while (words.length > 1 && /\d/.test(words.at(-1))) words.pop()
  const merchant = words.join(' ').replace(/[\s*#:,;.-]+$/, '').slice(0, MATCH_TEXT_MAX).trim()
  if (merchant.length < 2 || GENERIC_NOTES.has(merchant) || /^\d+$/.test(merchant)) return ''
  return merchant
}

/**
 * Interval, kterému odpovídají všechny odstupy seřazených dat, jinak null.
 * Od 4 plateb se toleruje jedna mezera o dvojnásobném intervalu (vynechaná platba).
 */
export function detectInterval(sortedDates) {
  if (sortedDates.length < 2) return null
  const gaps = sortedDates.slice(1).map((date, i) => daysBetween(sortedDates[i], date))
  const allowedDoubles = sortedDates.length >= MIN_PAYMENTS_WITH_GAP ? 1 : 0
  for (const [key, { minDays, maxDays }] of Object.entries(INTERVALS)) {
    const regular = gaps.filter((g) => g >= minDays && g <= maxDays).length
    const doubled = gaps.filter((g) => g >= minDays * 2 && g <= maxDays * 2).length
    if (regular + doubled === gaps.length && doubled <= allowedDoubles) return key
  }
  return null
}

/** Největší rozdíl částek vůči nejnižší (0,15 = 15 %). */
export const amountSpread = (amounts) => (Math.max(...amounts) - Math.min(...amounts)) / Math.min(...amounts)

/** Skupiny plateb s podobnou částkou: jednorázový nákup u téhož obchodníka předplatné nezkazí. */
function amountClusters(payments) {
  const sorted = [...payments].sort((a, b) => a.amount - b.amount)
  const clusters = []
  for (const payment of sorted) {
    const cluster = clusters.at(-1)
    // zaokrouhlení: 100 × 1,15 v plovoucí čárce je o chlup méně než 115
    if (cluster && payment.amount <= Math.round(cluster[0].amount * (1 + AMOUNT_SPREAD) * 100) / 100) cluster.push(payment)
    else clusters.push([payment])
  }
  return clusters
}

function mostCommonCategory(payments) {
  const counts = new Map()
  for (const { categoryId } of payments) {
    if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Popis k zobrazení: jako normalizeMerchant, ale s původní diakritikou a velikostí písmen. */
function displayName(note) {
  const words = String(note ?? '')
    .trim()
    .replace(/^storno – /i, '')
    .split(' – ')[0]
    .split(/\s+/)
  while (words.length > 1 && /\d/.test(words.at(-1))) words.pop()
  return words.join(' ').replace(/[\s*#:,;.-]+$/, '').slice(0, 80)
}

function suggestionName(merchant, note) {
  const known = KNOWN_SERVICES.find(([pattern]) => pattern.test(merchant))
  if (known) return { name: known[1], known: true }
  const name = displayName(note)
  return { name: name[0].toUpperCase() + name.slice(1), known: false }
}

function evaluateCluster(cluster, merchant, now) {
  const payments = [...cluster].sort((a, b) => a.date.localeCompare(b.date))
  const interval = detectInterval(payments.map((p) => p.date))
  if (!interval) return null
  if (payments.length < (interval === 'yearly' ? MIN_PAYMENTS_YEARLY : MIN_PAYMENTS)) return null
  const first = payments[0]
  const last = payments.at(-1)
  // dávno ukončené placení už není co sledovat
  if (daysBetween(last.date, now) > INTERVALS[interval].maxDays * 2) return null
  return {
    matchText: merchant,
    ...suggestionName(merchant, last.note),
    amount: last.amount,
    interval,
    firstDate: first.date,
    lastDate: last.date,
    count: payments.length,
    categoryId: mostCommonCategory(payments),
  }
}

/**
 * Návrhy předplatných z výdajů. Obchodník, který už má záznam v `subscriptions`
 * (aktivní, zrušený i zamítnutý), se nenabízí.
 */
export function detectSubscriptions(transactions, subscriptions = [], now = today()) {
  const groups = new Map()
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const merchant = normalizeMerchant(t.note)
    if (!merchant) continue
    if (!groups.has(merchant)) groups.set(merchant, [])
    groups.get(merchant).push({ date: t.date, amount: Number(t.amount), categoryId: t.category_id, note: t.note })
  }
  const taken = subscriptions.map((s) => s.match_text)
  const suggestions = []
  for (const [merchant, payments] of groups) {
    if (taken.some((text) => merchant.includes(text) || text.includes(merchant))) continue
    const best = amountClusters(payments)
      .map((cluster) => evaluateCluster(cluster, merchant, now))
      .filter(Boolean)
      .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate))[0]
    if (best) suggestions.push(best)
  }
  return suggestions.sort((a, b) => Number(b.known) - Number(a.known) || b.amount - a.amount)
}

/** Výdaje s normalizovanou poznámkou, aby se pro každé předplatné nenormalizovaly znovu. */
export const prepareExpenses = (transactions) =>
  transactions
    .filter((t) => t.type === 'expense')
    .map((t) => ({ transaction: t, text: normalizeText(t.note), amount: Number(t.amount) }))
    .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date))

export function withinTolerance(amount, expected, tolerancePercent) {
  return Math.abs(amount - expected) <= (expected * Number(tolerancePercent)) / 100 + 0.005
}

/**
 * Spárované platby předplatného, od nejstarší. Výdaj musí v poznámce obsahovat
 * match_text. Párování začíná první platbou v toleranci k očekávané částce a šíří
 * se oběma směry: soused se přidá v toleranci k očekávané částce nebo k sousední
 * platbě, nebo když termínem sedí na interval. Díky tomu zdražení nevypadá jako
 * chybějící platba a po změně ceny nezmizí z historie platby za starou cenu.
 */
export function matchPayments(subscription, expenses) {
  const { minDays, maxDays } = INTERVALS[subscription.interval]
  const expected = Number(subscription.amount)
  const tolerance = subscription.amount_tolerance ?? 10
  const candidates = expenses.filter(
    ({ transaction, text }) => transaction.date >= subscription.started_on && text.includes(subscription.match_text),
  )
  const anchor = candidates.findIndex(({ amount }) => withinTolerance(amount, expected, tolerance))
  if (anchor < 0) return []
  const fits = (amount, neighbour, gap) =>
    withinTolerance(amount, Number(neighbour.amount), tolerance) || (gap >= minDays && gap <= maxDays)

  const payments = [candidates[anchor].transaction]
  for (const { transaction, amount } of candidates.slice(anchor + 1)) {
    const last = payments.at(-1)
    if (withinTolerance(amount, expected, tolerance) || fits(amount, last, daysBetween(last.date, transaction.date))) {
      payments.push(transaction)
    }
  }
  for (const { transaction, amount } of candidates.slice(0, anchor).reverse()) {
    const first = payments[0]
    if (fits(amount, first, daysBetween(transaction.date, first.date))) payments.unshift(transaction)
  }
  return payments
}

/**
 * Příští platba: poslední spárovaná + interval, bez plateb od začátku předplatného.
 * Propásnutý termín se posune na nejbližší budoucí a vrátí se v `overdueSince`.
 */
export function nextPayment(subscription, payments, now = today()) {
  const last = payments.at(-1)?.date
  const base = last ?? subscription.started_on
  if (!last && base >= now) return { date: base, overdueSince: null }
  const due = addInterval(base, subscription.interval)
  if (due >= now) return { date: due, overdueSince: null }
  let times = 2
  while (addInterval(base, subscription.interval, times) < now) times++
  return { date: addInterval(base, subscription.interval, times), overdueSince: last ? due : null }
}

/** Datum nejnovější importované transakce: dokud výpis nedosáhne termínu, nejde platbu postrádat. */
export function lastImportDate(transactions) {
  let latest = ''
  for (const t of transactions) {
    if (t.import_hash && t.date > latest) latest = t.date
  }
  return latest
}

/** Upozornění předplatného; `type` je 'price' | 'missing' | 'after-cancel'. */
export function subscriptionAlerts(subscription, payments, next, importedUntil, now = today()) {
  const alerts = []
  const last = payments.at(-1)
  if (subscription.status === 'cancelled') {
    const after = subscription.ended_on ? payments.filter((p) => p.date > subscription.ended_on).at(-1) : null
    if (after) {
      alerts.push({
        type: 'after-cancel',
        danger: true,
        text: `Platíte i po zrušení: ${subscription.name}, ${formatMoney(after.amount)} dne ${formatDate(after.date)}`,
      })
    }
    return alerts
  }
  if (payments.length >= 2) {
    const previous = Number(payments.at(-2).amount)
    const current = Number(last.amount)
    // po „Aktualizovat cenu“ je očekávaná částka stejná jako poslední platba: uživatel o zdražení ví
    if (current > previous && current !== Number(subscription.amount) && !withinTolerance(current, previous, subscription.amount_tolerance ?? 10)) {
      alerts.push({
        type: 'price',
        latestAmount: current,
        text: `Cena ${subscription.name} vzrostla z ${formatMoney(previous)} na ${formatMoney(current)}`,
      })
    }
  }
  if (next?.overdueSince) {
    const graceEnd = addDays(next.overdueSince, MISSING_GRACE_DAYS)
    if (now > graceEnd && importedUntil >= graceEnd) {
      alerts.push({ type: 'missing', danger: true, text: `Platba chybí: ${subscription.name}, očekávaná ${formatDate(next.overdueSince)}` })
    }
  }
  return alerts
}

export function analyzeSubscription(subscription, expenses, importedUntil, now = today()) {
  const payments = matchPayments(subscription, expenses)
  const next = subscription.status === 'active' ? nextPayment(subscription, payments, now) : null
  return {
    subscription,
    payments,
    total: Math.round(payments.reduce((s, p) => s + Number(p.amount), 0) * 100) / 100,
    next,
    alerts: subscriptionAlerts(subscription, payments, next, importedUntil, now),
  }
}

/** Souhrn aktivních předplatných; týdenní, čtvrtletní a roční přepočtené na měsíc. */
export function subscriptionCosts(subscriptions) {
  const yearly = subscriptions.reduce((s, sub) => s + Number(sub.amount) * INTERVALS[sub.interval].perYear, 0)
  return { monthly: Math.round(yearly / 12), yearly: Math.round(yearly) }
}

/** Vše pro tracker a Přehled z dat aktuálního prostoru. */
export function buildSubscriptionData({ subscriptions, transactions, now = today() }) {
  const expenses = prepareExpenses(transactions)
  const importedUntil = lastImportDate(transactions)
  const analyze = (status) =>
    subscriptions.filter((s) => s.status === status).map((s) => analyzeSubscription(s, expenses, importedUntil, now))
  const active = analyze('active').sort((a, b) => a.next.date.localeCompare(b.next.date))
  const cancelled = analyze('cancelled').sort((a, b) => (b.subscription.ended_on ?? '').localeCompare(a.subscription.ended_on ?? ''))
  return {
    active,
    cancelled,
    suggestions: detectSubscriptions(transactions, subscriptions, now),
    costs: subscriptionCosts(active.map((a) => a.subscription)),
    alerts: [...active, ...cancelled].flatMap((a) => a.alerts.map((alert) => ({ ...alert, id: a.subscription.id }))),
    upcoming: active.map((a) => ({
      name: a.subscription.name,
      amount: Number(a.subscription.amount),
      date: a.next.date,
      matchText: a.subscription.match_text,
    })),
  }
}

/** „Od 03/2024“, u ukončeného „03/2024 – 08/2026“. */
export function subscriptionPeriodLabel({ started_on: start, ended_on: end }) {
  const month = (iso) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`
  return end ? `${month(start)} – ${month(end)}` : `Od ${month(start)}`
}

/** „1 platba“, „3 platby“, „12 plateb“. */
export function paymentsLabel(count) {
  if (count === 1) return '1 platba'
  return count >= 2 && count <= 4 ? `${count} platby` : `${count} plateb`
}
