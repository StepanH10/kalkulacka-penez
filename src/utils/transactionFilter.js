// Filtrování transakcí na klientu (obrazovka Transakce, odkazy z postřehů).
// Store drží v paměti všechny transakce prostoru, takže dotazy do databáze
// by nic nezrychlily a offline by nefungovaly. Bez závislostí na DOM / store.
import { normalizeText } from '../importers/utils.js'
import { monthRange, parseISODate, toISODate, today } from './dates.js'

/** Hodnota v `filter.categories` pro transakce bez kategorie. */
export const NO_CATEGORY = 'none'

/** period null = celá historie (u prázdného filtru obrazovka listuje po měsících). */
export const PERIOD_LABELS = {
  this: 'Tento měsíc',
  last: 'Minulý měsíc',
  '30d': 'Posledních 30 dní',
  year: 'Letos',
  custom: 'Vlastní rozsah',
}

export const emptyFilter = () => ({
  q: '',
  period: null,
  from: '',
  to: '',
  type: '', // '' | 'expense' | 'income'
  categories: [],
  accountId: '',
  amountMin: null,
  amountMax: null,
  origin: '', // '' | 'manual' | 'import'
  authorId: '',
})

/** Rozsah období { from, to } (včetně), nebo null = bez omezení. */
export function resolvePeriod(filter, now = today()) {
  const base = parseISODate(now)
  switch (filter.period) {
    case 'this':
      return monthRange(0, base)
    case 'last':
      return monthRange(-1, base)
    case '30d':
      return { from: toISODate(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 29)), to: now }
    case 'year':
      return { from: `${base.getFullYear()}-01-01`, to: `${base.getFullYear()}-12-31` }
    case 'custom': {
      const from = filter.from || '0000-01-01'
      const to = filter.to || '9999-12-31'
      return from <= to ? { from, to } : { from: to, to: from }
    }
    default:
      return null
  }
}

/** Je zapnuté hledání nebo aspoň jeden filtr? */
export function hasActiveFilter(filter) {
  return Boolean(
    filter.q.trim() ||
      filter.period ||
      filter.type ||
      filter.categories.length ||
      filter.accountId ||
      filter.amountMin !== null ||
      filter.amountMax !== null ||
      filter.origin ||
      filter.authorId,
  )
}

/**
 * Transakce odpovídající filtru. Hledá se v `note`: import do ní skládá popis
 * i protistranu, samostatné sloupce transakce nemá. Více slov = musí sedět všechna
 * (v libovolném pořadí), bez ohledu na velikost písmen a diakritiku.
 */
export function filterTransactions(transactions, filter, now = today()) {
  const words = normalizeText(filter.q).split(' ').filter(Boolean)
  const range = resolvePeriod(filter, now)
  const categories = new Set(filter.categories)
  return transactions.filter((t) => {
    if (range && (t.date < range.from || t.date > range.to)) return false
    if (filter.type && t.type !== filter.type) return false
    if (categories.size && !categories.has(t.category_id ?? NO_CATEGORY)) return false
    if (filter.accountId && t.account_id !== filter.accountId) return false
    const amount = Number(t.amount)
    if (filter.amountMin !== null && amount < filter.amountMin) return false
    if (filter.amountMax !== null && amount > filter.amountMax) return false
    if (filter.origin === 'manual' && t.import_hash) return false
    if (filter.origin === 'import' && !t.import_hash) return false
    if (filter.authorId && t.created_by !== filter.authorId) return false
    if (words.length) {
      const note = normalizeText(t.note)
      if (!words.every((w) => note.includes(w))) return false
    }
    return true
  })
}

/** „Nalezena 1 transakce“, „Nalezeny 3 transakce“, „Nalezeno 23 transakcí“. */
export function foundLabel(count) {
  if (count === 1) return 'Nalezena 1 transakce'
  if (count >= 2 && count <= 4) return `Nalezeny ${count} transakce`
  return `Nalezeno ${count} transakcí`
}
