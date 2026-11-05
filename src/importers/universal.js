// Univerzální import CSV s mapováním sloupců – pro banky bez vlastního parseru
// (Česká spořitelna, ČSOB, Air Bank, Raiffeisenbank, Moneta, mBank, Fio CSV…).
// Rozpozná kódování (UTF-8 / windows-1250 – v registru), oddělovač, řádek hlavičky,
// formát data a čísla a navrhne přiřazení sloupců podle názvů. Uživatel ho v importu
// upraví; mapování se uloží jako šablona podle otisku hlavičky.
import { importError, parseCSV, isBlankRow, parseNumber, parseDate, detectDateFormat, detectDecimal, normalizeText, hashString } from './utils.js'

const DELIMITERS = [';', ',', '\t']
const SCAN = 40 // tolik řádků stačí na nalezení hlavičky (úvodní metadata bank bývají kratší)

/** Pole mapování: klíč → popis v UI. */
export const FIELDS = [
  { key: 'date', label: 'Datum', required: true },
  { key: 'amount', label: 'Částka' },
  { key: 'income', label: 'Příjem' },
  { key: 'expense', label: 'Výdaj' },
  { key: 'counterparty', label: 'Popis / protistrana' },
  { key: 'message', label: 'Zpráva' },
  { key: 'vs', label: 'VS' },
  { key: 'id', label: 'ID transakce' },
]

const width = (row) => {
  let n = row.length
  while (n > 0 && row[n - 1] === '') n--
  return n
}
const looksLikeDateRow = (row) => row.some((c) => parseDate(c))

/**
 * Řádek hlavičky: aspoň 2 vyplněné textové buňky (žádné datum ani číslo) a hned za ním
 * řádky se stejným počtem sloupců, které obsahují datum. Vrací index, nebo -1.
 */
export function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, SCAN); i++) {
    const row = rows[i]
    const w = width(row)
    const filled = row.filter((c) => c)
    if (w < 2 || filled.length < 2) continue
    if (filled.some((c) => parseDate(c) || !Number.isNaN(parseNumber(c)))) continue
    const next = rows.slice(i + 1).filter((r) => !isBlankRow(r)).slice(0, 3)
    // prázdné buňky na konci řádku ("…;;") se počítají – stačí stejný počet oddělovačů ±1
    if (next.length && next.every((r) => r.length >= w - 1 && width(r) <= w + 1 && looksLikeDateRow(r))) return i
  }
  return -1
}

/** Oddělovač s nejlépe čitelnou tabulkou (hlavička + nejvíc sloupců). */
export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, SCAN + 5).join('\n')
  let best = { delimiter: ';', score: -1 }
  for (const delimiter of DELIMITERS) {
    const rows = parseCSV(head, delimiter)
    const h = findHeaderRow(rows)
    const score = h < 0 ? 0 : width(rows[h]) * 10 + 1
    if (score > best.score) best = { delimiter, score }
  }
  return best.delimiter
}

// klíčová slova v názvech sloupců (bez diakritiky, malými písmeny); pořadí = priorita
const HINTS = {
  date: [/datum provedeni|datum transakce|datum pohybu|datum zauctovani|zauctovan|datum/, /\bdate\b|booking|completed/],
  amount: [/castka|objem|\bamount\b|\bsuma\b/],
  income: [/prijem|prijmy|kredit|credit|pripsano/],
  expense: [/vydaj|vydaje|debet|debit|odepsano/],
  counterparty: [/nazev protiuctu|protistrana|nazev|obchodnik|prijemce|platce|counterparty|merchant|payee/, /protiucet/],
  message: [/zprava|poznamka|popis|description|message|\bnote\b/],
  vs: [/^vs$|\bvs\b|variabilni/],
  id: [/identifikace|^id$|\bid\b|id transakce/],
}
// sloupce, které nejsou částkou pohybu
const NOT_AMOUNT = /puvodni|original|poplatek|\bfee\b|zustatek|balance|kurz|rate/

/**
 * Návrh mapování podle názvů sloupců a ukázkových hodnot.
 * Vrací { date, amount, income, expense, counterparty, message, vs, id } (index sloupce, nebo -1).
 */
export function suggestMapping(header, samples = []) {
  const names = header.map(normalizeText)
  const used = new Set()
  const mapping = {}
  const valuesOf = (i) => samples.map((r) => r[i] ?? '')
  const pick = (key, accept = () => true) => {
    for (const re of HINTS[key]) {
      const i = names.findIndex((n, idx) => n && !used.has(idx) && re.test(n) && accept(idx, n))
      if (i >= 0) {
        used.add(i)
        return i
      }
    }
    return -1
  }
  mapping.date = pick('date', (i) => !samples.length || detectDateFormat(valuesOf(i)) !== null)
  mapping.amount = pick('amount', (i, n) => !NOT_AMOUNT.test(n))
  mapping.income = mapping.amount >= 0 ? -1 : pick('income', (i, n) => !NOT_AMOUNT.test(n))
  mapping.expense = mapping.amount >= 0 ? -1 : pick('expense', (i, n) => !NOT_AMOUNT.test(n))
  mapping.vs = pick('vs')
  mapping.id = pick('id')
  mapping.counterparty = pick('counterparty')
  mapping.message = pick('message')
  // bez protistrany patří „Popis“ do hlavního pole (z něj vznikají i pravidla kategorií)
  if (mapping.counterparty < 0 && mapping.message >= 0) {
    mapping.counterparty = mapping.message
    mapping.message = pick('message')
  }
  return mapping
}

/** Otisk hlavičky = klíč uložené šablony. */
export const headerKey = (header) => hashString(header.map(normalizeText).join('|'))

/**
 * Rozbor souboru pro krok mapování: oddělovač, hlavička, ukázka 5 řádků,
 * navržené mapování a formáty. Chyba, když hlavičku nejde najít.
 */
export function analyze(text) {
  const delimiter = detectDelimiter(text)
  const rows = parseCSV(text, delimiter)
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) {
    throw importError('V souboru se nepodařilo najít hlavičku s názvy sloupců a pod ní řádky s datem. Zkontrolujte, že jde o CSV export pohybů.')
  }
  const header = rows[headerIndex].slice(0, width(rows[headerIndex]))
  const data = rows.slice(headerIndex + 1).filter((r) => !isBlankRow(r))
  const mapping = suggestMapping(header, data.slice(0, 20))
  return {
    delimiter,
    headerIndex,
    header,
    key: headerKey(header),
    samples: data.slice(0, 5),
    rowCount: data.length,
    config: { delimiter, mapping, ...detectFormats(data, mapping) },
  }
}

/** Formát data a desetinný oddělovač podle hodnot namapovaných sloupců. */
export function detectFormats(data, mapping) {
  const col = (i) => (i >= 0 ? data.slice(0, 50).map((r) => r[i] ?? '') : [])
  return {
    dateFormat: detectDateFormat(col(mapping.date)) ?? 'dmy',
    decimal: detectDecimal([...col(mapping.amount), ...col(mapping.income), ...col(mapping.expense)]),
  }
}

/** Mapování je použitelné: datum + částka, nebo datum + příjem / výdaj. */
export function mappingError(mapping) {
  if (!(mapping?.date >= 0)) return 'Přiřaďte sloupec s datem.'
  if (!(mapping.amount >= 0) && !(mapping.income >= 0) && !(mapping.expense >= 0)) {
    return 'Přiřaďte sloupec s částkou, nebo sloupce Příjem / Výdaj.'
  }
  return ''
}

const universal = {
  id: 'csv',
  name: 'Jiná banka (vlastní mapování)',
  encoding: 'auto',
  extensions: ['.csv', '.txt'],
  needsMapping: true,

  // nikdy nerozpozná sám – nabízí se, když soubor nepozná žádná banka
  detect: () => false,

  meta(text, { config } = {}) {
    if (!config) return {}
    const dates = universal
      .parse(text, { config })
      .map((r) => r.date)
      .filter(Boolean)
      .sort()
    return { from: dates[0] ?? null, to: dates.at(-1) ?? null }
  },

  parse(text, { config } = {}) {
    if (!config) throw importError('Nejdřív přiřaďte sloupce.')
    const error = mappingError(config.mapping)
    if (error) throw importError(error)
    const { mapping: m, dateFormat = 'dmy', decimal = ',' } = config
    const rows = parseCSV(text, config.delimiter)
    const headerIndex = findHeaderRow(rows)
    if (headerIndex < 0) throw importError('V souboru se nepodařilo najít hlavičku s názvy sloupců.')
    const get = (row, i) => (i >= 0 ? (row[i] ?? '').trim() : '')
    const num = (v) => (v ? parseNumber(v, decimal) : 0)

    return rows
      .slice(headerIndex + 1)
      .filter((r) => !isBlankRow(r))
      .map((row) => {
        const rawDate = get(row, m.date)
        const rawAmounts = [get(row, m.amount), get(row, m.income), get(row, m.expense)]
        // zápatí („Celkem“), mezisoučty apod.: bez data ve sloupci ani jinde v řádku → přeskočit
        if (!rawDate && (rawAmounts.every((v) => !v) || !looksLikeDateRow(row))) return null
        const date = parseDate(rawDate, dateFormat)
        let amount
        if (m.amount >= 0) amount = num(rawAmounts[0])
        else amount = Math.abs(num(rawAmounts[1])) - Math.abs(num(rawAmounts[2]))
        const counterparty = get(row, m.counterparty)
        const description = [counterparty, get(row, m.message)].filter(Boolean).join(' – ').slice(0, 200)
        let rowError = ''
        if (!date) rowError = `Neplatné datum „${rawDate}“`
        else if (Number.isNaN(amount)) rowError = `Neplatná částka „${rawAmounts.filter(Boolean).join(' / ')}“`
        else if (amount === 0) rowError = 'Nulová částka'
        return {
          date,
          amount: Number.isNaN(amount) ? 0 : Math.round(amount * 100) / 100,
          currency: 'CZK',
          description: description || 'Bez popisu',
          counterparty,
          variableSymbol: get(row, m.vs).replace(/^0+/, ''),
          externalId: get(row, m.id),
          ...(rowError ? { error: rowError } : {}),
        }
      })
      .filter(Boolean)
  },
}

export default universal
