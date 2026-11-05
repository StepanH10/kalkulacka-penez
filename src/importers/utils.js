// Společné utility pro importy bankovních výpisů.
// Běží jen v prohlížeči (a v testech v Node) – soubor se nikam neodesílá.
// Záměrně bez závislostí na DOM, store a Supabase, aby šly testovat v Node.

/** Chyba importu se srozumitelnou českou hláškou (translateError ji předá beze změny). */
export function importError(czMessage) {
  const err = new Error(czMessage)
  err.czMessage = czMessage
  return err
}

const utf8Strict = () => new TextDecoder('utf-8', { fatal: true })
const hasNonAscii = (bytes) => bytes.some((b) => b > 0x7f)

/**
 * Dekóduje obsah souboru. Banka udává své kódování (KB: windows-1250).
 * Když je soubor platné UTF-8 s diakritikou (např. přeuložený v Excelu),
 * použije UTF-8 – v textu z windows-1250 se platné vícebajtové UTF-8
 * sekvence prakticky nevyskytují. BOM se odstraní.
 */
export function decodeBytes(buffer, encoding = 'utf-8') {
  if (encoding === 'auto') return decodeUnknown(buffer)
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let text
  if (encoding.toLowerCase() !== 'utf-8' && hasNonAscii(bytes)) {
    try {
      text = utf8Strict().decode(bytes)
    } catch {
      text = new TextDecoder(encoding).decode(bytes)
    }
  } else {
    text = new TextDecoder(encoding).decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

/**
 * Bez známé banky: zkusí UTF-8 i windows-1250 a vybere variantu bez „�“.
 */
export function decodeUnknown(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1250').decode(bytes).replace(/^﻿/, '')
}

/**
 * Rozdělí CSV na řádky a buňky. Podporuje uvozovky ("a;b", "" uvnitř)
 * i konce řádků \n / \r\n. Koncový oddělovač na řádku dá prázdnou buňku navíc.
 */
export function parseCSV(text, delimiter = ';') {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((c) => c.trim()))
}

/** Řádek bez obsahu (prázdný nebo jen oddělovače). */
export const isBlankRow = (row) => row.every((c) => c === '')

/**
 * České číslo: „-1 234,50“, „1 234,5“ (i nezlomitelná mezera), „1275“.
 * Vrací Number, nebo NaN.
 */
export function parseCzechNumber(input) {
  const s = String(input ?? '')
    .replace(/[\s  ]/g, '')
    .replace(/^\+/, '')
  if (!/^-?\d+(,\d+)?$/.test(s)) return NaN
  return Number(s.replace(',', '.'))
}

/** Datum „DD.MM.YYYY“ (i „D.M.YYYY“) → „YYYY-MM-DD“, neplatné → null. */
export function parseCzechDate(input) {
  const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(String(input ?? '').trim())
  if (!m) return null
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Číslo v libovolném běžném zápisu: „-1 234,50“, „1.234,50“, „1,234.50“,
 * „1234.5“, „123,45-“ (mínus na konci), „(12,50)“, „−5“, s měnou na konci.
 * decimal: ',' | '.' | 'auto' (podle posledního oddělovače). Vrací Number, nebo NaN.
 */
export function parseNumber(input, decimal = 'auto') {
  let s = String(input ?? '')
    .replace(/[\s\u00A0\u202F']/g, '')
    .replace(/(kč|kc|[a-z]{3})$/i, '')
  if (!s) return NaN
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/[-−]$/.test(s)) {
    negative = true
    s = s.slice(0, -1)
  }
  if (/^[-−]/.test(s)) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) s = s.slice(1)
  let dec = decimal
  if (dec === 'auto') {
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    dec = lastComma > lastDot ? ',' : lastDot > lastComma ? '.' : ','
  }
  const thousands = dec === ',' ? '.' : ','
  // oddělovač tisíců jen ve skupinách po třech číslicích
  const [whole, ...rest] = s.split(dec)
  if (rest.length > 1) return NaN
  if (whole.includes(thousands) && !new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(whole)) return NaN
  const normalized = whole.split(thousands).join('') + (rest.length ? `.${rest[0]}` : '')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return NaN
  const n = Number(normalized)
  return negative ? -n : n
}

/** Desetinný oddělovač sloupce podle hodnot (většina vyhrává; výchozí čárka). */
export function detectDecimal(values) {
  let comma = 0
  let dot = 0
  for (const v of values) {
    const s = String(v ?? '').replace(/[\s\u00A0\u202F]/g, '').replace(/[-−]$/, '')
    if (/,\d{1,2}$/.test(s) || /\.\d{3},\d+$/.test(s)) comma++
    else if (/\.\d{1,2}$/.test(s) || /,\d{3}\.\d+$/.test(s)) dot++
  }
  return dot > comma ? '.' : ','
}

const DATE_RE = {
  dmy: /^(\d{1,2})[./]\s*(\d{1,2})[./]\s*(\d{4})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/,
  ymd: /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
}

/**
 * Datum v zápisu D.M.YYYY / DD.MM.YYYY (i s lomítky a časem) nebo YYYY-MM-DD
 * (i s časem) → „YYYY-MM-DD“. format: 'dmy' | 'ymd' | 'auto'. Neplatné → null.
 */
export function parseDate(input, format = 'auto') {
  const s = String(input ?? '').trim()
  for (const f of format === 'auto' ? ['dmy', 'ymd'] : [format]) {
    const m = DATE_RE[f]?.exec(s)
    if (!m) continue
    const [y, mo, d] = f === 'ymd' ? [m[1], m[2], m[3]].map(Number) : [m[3], m[2], m[1]].map(Number)
    const date = new Date(y, mo - 1, d)
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** Formát data sloupce: 'dmy' | 'ymd', nebo null, když hodnoty nejsou data. */
export function detectDateFormat(values) {
  const filled = values.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (!filled.length) return null
  for (const f of ['dmy', 'ymd']) {
    if (filled.every((v) => parseDate(v, f))) return f
  }
  return null
}

/** Text pro porovnání: malá písmena, bez diakritiky, jedna mezera. */
export function normalizeText(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Rychlý 53bitový hash (cyrb53) jako hex – jen pro rozpoznání duplicit, ne pro bezpečnost. */
export function hashString(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const cents = (amount) => Math.round(Number(amount) * 100)

/** Otisk rozlišující řádky se stejným ID: ID + datum + částka + protistrana (bez pořadí). */
const repeatStem = (bankId, r) =>
  `${`${bankId}:${r.externalId}`.slice(0, 150)}:${r.date}:${cents(r.amount)}:${hashString(normalizeText(r.counterparty))}`

/**
 * Otisky řádků pro kontrolu duplicit. Každý řádek souboru má vlastní a opakovaný
 * import stejného souboru dá stejné otisky.
 * - ID je v souboru jednou: „<banka>:<externalId>“
 * - ID se v souboru opakuje (KB ho sdílí např. u vyrovnávacích úhrad):
 *   „<banka>:<externalId>:<datum>:<haléře>:<hash protistrany>:<pořadí stejné kombinace>“
 * - bez ID: „<banka>:h:<hash data, částky, protistrany a popisu>:<pořadí>“
 * Pořadí rozliší i dvě stejné platby téhož dne (dvě kávy).
 */
export function importHashes(bankId, rows) {
  const idCount = new Map()
  for (const r of rows) if (r.externalId) idCount.set(r.externalId, (idCount.get(r.externalId) ?? 0) + 1)
  const seen = new Map()
  const nth = (key) => {
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    return n
  }
  return rows.map((r) => {
    if (r.externalId) {
      if (idCount.get(r.externalId) === 1) return `${bankId}:${r.externalId}`.slice(0, 200)
      const stem = repeatStem(bankId, r)
      return `${stem}:${nth(stem)}`
    }
    const base = hashString([r.date, r.amount, normalizeText(r.counterparty), normalizeText(r.description)].join('|'))
    return `${bankId}:h:${base}:${nth(base)}`
  })
}

/**
 * Které řádky už jsou v účtu: duplicita je jen shoda s transakcí v databázi, nikdy
 * shoda uvnitř souboru. existing = transakce účtu s import_hash.
 * Tvar otisku závisí na tom, jestli se ID v daném souboru opakuje, proto se porovnává i křížem:
 * - řádek s opakovaným ID × starý otisk „<banka>:<ID>“ se stejným datem a částkou
 *   (import z doby, kdy se druhý řádek dvojice zahodil), každý starý otisk jen jednou
 * - řádek s ID bez opakování × otisk s rozlišením stejného řádku (výpis za kratší období)
 */
export function duplicateFlags(bankId, rows, hashes, existing) {
  const exact = new Set()
  const stems = new Set()
  const plain = new Map()
  for (const t of existing) {
    exact.add(t.import_hash)
    stems.add(t.import_hash.replace(/:\d+$/, ''))
    const list = plain.get(t.import_hash) ?? []
    list.push(`${t.date}:${(t.type === 'income' ? 1 : -1) * cents(t.amount)}`)
    plain.set(t.import_hash, list)
  }
  return rows.map((r, i) => {
    if (exact.has(hashes[i])) return true
    if (!r.externalId) return false
    const base = `${bankId}:${r.externalId}`.slice(0, 200)
    if (hashes[i] === base) return stems.has(repeatStem(bankId, r))
    const old = plain.get(base)
    const at = old ? old.indexOf(`${r.date}:${cents(r.amount)}`) : -1
    if (at < 0) return false
    old.splice(at, 1)
    return true
  })
}
