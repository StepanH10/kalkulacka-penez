// Komerční banka (KB+) – CSV výpis z internetového bankovnictví.
// windows-1250, středník, bez uvozovek, na začátku metadata účtu,
// pak hlavička „Datum zauctovani;Datum provedeni;…“ a transakce.
import { importError, parseCSV, isBlankRow, parseCzechNumber, parseCzechDate } from './utils.js'

const HEADER_START = 'Datum zauctovani;Datum provedeni;'
const MAX_NOTE = 200

const COL = {
  booked: 'Datum zauctovani',
  executed: 'Datum provedeni',
  name: 'Nazev protiuctu',
  amount: 'Castka',
  currency: 'Mena',
  vs: 'VS',
  id: 'Identifikace transakce',
  kind: 'Typ transakce',
  myNote: 'Popis pro me',
  message: 'Zprava pro prijemce',
}
// sloupec „Protistrana“ (u karet maskované číslo karty) se záměrně nečte

// hlavička = řádek se sloupcem „Castka“ a aspoň jedním datem (pořadí sloupců nehraje roli)
const findHeader = (rows) => rows.findIndex((r) => r.includes(COL.amount) && (r.includes(COL.booked) || r.includes(COL.executed)))

export default {
  id: 'kb',
  name: 'Komerční banka',
  encoding: 'windows-1250',

  detect(text) {
    const t = text.replace(/^﻿/, '')
    return t.startsWith('KB+, vypis v csv. formatu') || t.split(/\r?\n/).some((line) => line.startsWith(HEADER_START))
  },

  /** Období výpisu z metadat („Vypis od“ / „Vypis do“). Číslo účtu, IBAN ani název se nečtou. */
  meta(text) {
    const rows = parseCSV(text, ';')
    const end = findHeader(rows)
    const value = (key) => rows.slice(0, end < 0 ? rows.length : end).find((r) => r[0] === key)?.[1] ?? ''
    return { from: parseCzechDate(value('Vypis od')), to: parseCzechDate(value('Vypis do')) }
  },

  parse(text) {
    const rows = parseCSV(text, ';')
    const headerAt = findHeader(rows)
    if (headerAt < 0) throw importError('Ve výpisu chybí hlavička s transakcemi („Datum zauctovani;Datum provedeni;…“).')

    // sloupce podle názvu – KB může pořadí změnit
    const header = rows[headerAt]
    const idx = Object.fromEntries(Object.entries(COL).map(([k, name]) => [k, header.indexOf(name)]))
    if (idx.amount < 0 || (idx.executed < 0 && idx.booked < 0)) {
      throw importError('Hlavička výpisu neobsahuje sloupce „Castka“ a „Datum provedeni“.')
    }
    const get = (row, key) => (idx[key] >= 0 ? (row[idx[key]] ?? '') : '')

    return rows
      .slice(headerAt + 1)
      .filter((row) => !isBlankRow(row))
      .map((row) => {
        const rawDate = get(row, 'executed') || get(row, 'booked')
        const date = parseCzechDate(rawDate)
        const amount = parseCzechNumber(get(row, 'amount'))
        const counterparty = get(row, 'name')
        const parts = [counterparty, get(row, 'message'), get(row, 'myNote')].filter(Boolean)
        const description = (parts.join(' – ') || get(row, 'kind')).slice(0, MAX_NOTE)
        let error = ''
        if (!date) error = `Neplatné datum „${rawDate}“`
        else if (Number.isNaN(amount)) error = `Neplatná částka „${get(row, 'amount')}“`
        else if (amount === 0) error = 'Nulová částka'
        return {
          date,
          amount: Number.isNaN(amount) ? 0 : amount,
          currency: (get(row, 'currency') || 'CZK').toUpperCase(),
          description,
          counterparty,
          variableSymbol: get(row, 'vs'),
          externalId: get(row, 'id'),
          ...(error ? { error } : {}),
        }
      })
  },
}
