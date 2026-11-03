const pad = (n) => String(n).padStart(2, '0')

/** Lokální datum jako YYYY-MM-DD (bez posunu kvůli UTC). */
export function toISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function parseISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function today() {
  return toISODate(new Date())
}

export function monthKey(iso) {
  return iso.slice(0, 7)
}

/** Rozsah měsíce { from, to } pro datum posunuté o `offset` měsíců. */
export function monthRange(offset = 0, base = new Date()) {
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  const last = new Date(base.getFullYear(), base.getMonth() + offset + 1, 0)
  return { from: toISODate(first), to: toISODate(last) }
}

/** Seznam klíčů měsíců YYYY-MM od `from` do `to` včetně. */
export function monthsBetween(fromIso, toIso) {
  const result = []
  const end = parseISODate(toIso)
  const cur = parseISODate(fromIso)
  cur.setDate(1)
  while (cur <= end && result.length < 120) {
    result.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return result
}

const dayFormat = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })
const dayYearFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })
const shortFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
const monthFormat = new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric' })
const monthShortFormat = new Intl.DateTimeFormat('cs-CZ', { month: 'short' })
const dateTimeFormat = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })

/** „Dnes“, „Včera“, nebo „pondělí 3. listopadu“. */
export function formatDayLabel(iso) {
  const t = today()
  if (iso === t) return 'Dnes'
  const y = new Date()
  y.setDate(y.getDate() - 1)
  if (iso === toISODate(y)) return 'Včera'
  const d = parseISODate(iso)
  return d.getFullYear() === new Date().getFullYear() ? dayFormat.format(d) : dayYearFormat.format(d)
}

export function formatDate(iso) {
  return iso ? shortFormat.format(parseISODate(iso)) : ''
}

/** Datum a čas z časového razítka (např. platnost pozvánky). */
export function formatDateTime(timestamp) {
  return timestamp ? dateTimeFormat.format(new Date(timestamp)) : ''
}

export function formatLongDate(iso) {
  return iso ? dayYearFormat.format(parseISODate(iso)) : ''
}

export function formatMonth(isoOrKey) {
  return monthFormat.format(parseISODate(isoOrKey.length === 7 ? `${isoOrKey}-01` : isoOrKey))
}

export function formatMonthShort(key) {
  return monthShortFormat.format(parseISODate(`${key}-01`)).replace('.', '')
}

/** Počet celých měsíců (alespoň 1) od dneška do `iso`. */
export function monthsUntil(iso) {
  const now = new Date()
  const d = parseISODate(iso)
  const months = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
  return Math.max(1, months)
}
