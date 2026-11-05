// Revolut – CSV výpis osobního účtu (anglický i český export, stejná struktura).
// UTF-8, oddělovač čárka, desetinná tečka (u české lokalizace se oddělovač
// a desetinná čárka rozpoznají podle obsahu). Byznys export má jiné, širší
// sloupce – ten se nerozpozná a použije se univerzální mapování.
import { parseCSV, isBlankRow, parseNumber, parseDate, detectDecimal, normalizeText, hashString } from './utils.js'

// klíč → název sloupce v anglickém a českém exportu
const COLUMNS = {
  type: ['Type', 'Typ'],
  product: ['Product', 'Produkt'],
  started: ['Started Date', 'Datum zahájení'],
  completed: ['Completed Date', 'Datum dokončení'],
  description: ['Description', 'Popis'],
  amount: ['Amount', 'Částka'],
  fee: ['Fee', 'Poplatek'],
  currency: ['Currency', 'Měna'],
  state: ['State', 'Stav'],
  balance: ['Balance', 'Zůstatek'],
}
const LANGS = [0, 1].map((i) => Object.values(COLUMNS).map((names) => normalizeText(names[i])))

// zaúčtované transakce; ostatní stavy (PENDING, REVERTED, DECLINED…) se jen označí
const COMPLETED = ['completed', 'dokonceno', 'dokoncena', 'dokoncene']

function headerOf(text) {
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  for (const delimiter of [',', ';']) {
    const cells = parseCSV(first, delimiter)[0]?.filter((c, i, all) => c || i < all.length - 1) ?? []
    const names = cells.map(normalizeText)
    // přesně 10 sloupců osobního exportu (byznys export jich má víc → false)
    if (names.length === 10 && LANGS.some((lang) => lang.every((n) => names.includes(n)))) return { delimiter, names }
  }
  return null
}

const revolut = {
  id: 'revolut',
  name: 'Revolut (osobní účet)',
  encoding: 'utf-8',

  detect(text) {
    return headerOf(text) !== null
  },

  meta(text) {
    const dates = revolut
      .parse(text)
      .map((r) => r.date)
      .filter(Boolean)
      .sort()
    return { from: dates[0] ?? null, to: dates.at(-1) ?? null }
  },

  parse(text) {
    const header = headerOf(text)
    if (!header) return []
    const rows = parseCSV(text.replace(/^﻿/, ''), header.delimiter)
    const start = rows.findIndex((r) => r.some((c) => c)) + 1
    const data = rows.slice(start).filter((r) => !isBlankRow(r))
    const idx = Object.fromEntries(
      Object.entries(COLUMNS).map(([key, names]) => [key, header.names.findIndex((n) => names.some((name) => normalizeText(name) === n))]),
    )
    const get = (row, key) => row[idx[key]] ?? ''
    const decimal = detectDecimal(data.flatMap((r) => [get(r, 'amount'), get(r, 'fee')]))

    const result = []
    for (const row of data) {
      const started = get(row, 'started')
      const rawDate = get(row, 'completed') || started
      const date = parseDate(rawDate)
      const amount = parseNumber(get(row, 'amount'), decimal)
      const fee = get(row, 'fee') ? parseNumber(get(row, 'fee'), decimal) : 0
      const currency = (get(row, 'currency') || 'CZK').toUpperCase()
      const text_ = get(row, 'description')
      const description = (text_ || get(row, 'type')).slice(0, 200)
      const state = get(row, 'state')
      const warning = COMPLETED.includes(normalizeText(state)) ? '' : `Stav „${state || 'neznámý'}“ – není zaúčtováno`
      // Revolut nemá ID transakce → otisk ze začátku (s časem), částky, popisu a měny
      const id = hashString([started, get(row, 'amount'), text_, currency].join('|'))
      let error = ''
      if (!date) error = `Neplatné datum „${rawDate}“`
      else if (Number.isNaN(amount)) error = `Neplatná částka „${get(row, 'amount')}“`
      else if (Number.isNaN(fee)) error = `Neplatný poplatek „${get(row, 'fee')}“`
      const base = { date, currency, counterparty: text_, variableSymbol: '', ...(warning ? { warning } : {}) }

      if (error) {
        result.push({ ...base, amount: 0, description, externalId: id, error })
        continue
      }
      if (amount !== 0) result.push({ ...base, amount, description, externalId: id })
      // poplatek jako zvláštní výdaj (zůstatek = předchozí + částka − poplatek)
      if (fee !== 0) {
        result.push({ ...base, amount: -Math.abs(fee), description: `Poplatek Revolut${text_ ? ` – ${text_}` : ''}`.slice(0, 200), counterparty: 'Revolut', externalId: `${id}:fee` })
      }
      if (amount === 0 && fee === 0) result.push({ ...base, amount: 0, description, externalId: id, error: 'Nulová částka' })
    }
    return result
  },
}

export default revolut
