// ABO / GPC – standardní český formát výpisů s pevnou šířkou polí (většina českých bank).
//
// Pozice polí podle veřejné specifikace formátu ABO (dokumentace a parsery
// webwingscz/bank-statements a jakubzapletal/bank-statements, specifikace
// České spořitelny a Fio). Pozice jsou 1-based BAJTOVÉ offsety, proto se čte
// z bajtů souboru a jednotlivá textová pole se dekódují zvlášť – pozice pak
// sedí i v souboru uloženém jako UTF-8.
//
// 074 – hlavička výpisu
//   4–19 číslo účtu (bez kódu banky) · 40–45 datum starého zůstatku (ddmmrr)
//   46–59 starý zůstatek v haléřích · 60 znaménko · 61–74 nový zůstatek · 75 znaménko
//   76–89 obrat debet · 90 · 91–104 obrat kredit · 105 · 106–108 pořadí výpisu
//   109–114 datum výpisu (ddmmrr)
// 075 – transakce
//   4–19 číslo účtu · 20–35 protiúčet · 36–48 číslo dokladu · 49–60 částka v haléřích
//   61 kód zaúčtování · 62–71 VS · 72–81 KS (74–77 kód banky protiúčtu) · 82–91 SS
//   92–97 valuta (ddmmrr) · 98–117 název protistrany / typ · 118–122 kód měny ISO 4217
//   (jen Fio a ČSOB) · 123–128 datum splatnosti / zaúčtování (ddmmrr)
// 076 – 36–127 název protistrany předchozí transakce
// 078 / 079 – 4–38 a 39–73 zpráva (AV1–AV4) předchozí transakce
// Ostatní řádky (UHL1 z KB, 077 …) se přeskočí.
import { importError, decodeBytes } from './utils.js'

/**
 * Dialekty: kód zaúčtování → znaménko částky. Storno obrací původní pohyb
 * (storno debetu = peníze zpět = +, storno kreditu = −).
 */
const DIALECTS = {
  standard: { codes: { 1: -1, 2: 1, 4: 1, 5: -1 }, reversal: ['4', '5'], currency: false },
  cs: { codes: { 1: -1, 2: 1, 3: 1, 4: -1 }, reversal: ['3', '4'], currency: false },
  currency: { codes: { 1: -1, 2: 1, 4: 1, 5: -1 }, reversal: ['4', '5'], currency: true },
}

// ISO 4217 – číselné kódy běžných měn
const ISO = {
  203: 'CZK', 978: 'EUR', 840: 'USD', 826: 'GBP', 756: 'CHF', 985: 'PLN', 348: 'HUF',
  208: 'DKK', 752: 'SEK', 578: 'NOK', 946: 'RON', 975: 'BGN', 124: 'CAD', 36: 'AUD', 392: 'JPY',
}

const RECORDS = ['074', '075', '076', '077', '078', '079']

/** Bajty souboru; bez nich (testy s ASCII textem) z textu po znacích. */
function toBytes(text, bytes) {
  if (bytes) return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return Uint8Array.from(text, (ch) => (ch.charCodeAt(0) < 256 ? ch.charCodeAt(0) : 63))
}

/** Řádky jako pole bajtů (CR LF i LF), prázdné vynechá. */
function byteLines(bytes) {
  const lines = []
  let start = 0
  for (let i = 0; i <= bytes.length; i++) {
    if (i === bytes.length || bytes[i] === 0x0a) {
      let end = i
      if (end > start && bytes[end - 1] === 0x0d) end--
      const line = bytes.subarray(start, end)
      if (line.some((b) => b !== 0x20)) lines.push(line)
      start = i + 1
    }
  }
  return lines
}

const ascii = new TextDecoder('ascii')
const field = (line, pos, len) => line.subarray(pos - 1, pos - 1 + len)
const raw = (line, pos, len) => ascii.decode(field(line, pos, len))
const text = (line, pos, len) => decodeBytes(field(line, pos, len), 'windows-1250').trim()
const digits = (line, pos, len) => raw(line, pos, len).trim().replace(/^0+/, '')
const type = (line) => raw(line, 1, 3)

/** ddmmrr → YYYY-MM-DD (null pro prázdné / nuly / neplatné). */
function gpcDate(value) {
  if (!/^\d{6}$/.test(value) || /^0+$/.test(value)) return null
  const [d, m, y] = [Number(value.slice(0, 2)), Number(value.slice(2, 4)), 2000 + Number(value.slice(4, 6))]
  const date = new Date(y, m - 1, d)
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Částka v haléřích → Kč (null při nečíselném poli). */
function minor(value) {
  const v = value.trim()
  return /^\d+$/.test(v) ? Number(v) / 100 : null
}

const signed = (value, sign) => {
  const n = minor(value)
  return n === null ? null : sign.trim() === '-' ? -n : n
}

/** Hlavičky 074 a transakce 075 s doplňky 076/078/079 (bez interpretace kódu zaúčtování). */
function records(text_, bytes_) {
  const lines = byteLines(toBytes(text_, bytes_))
  const headers = []
  const items = []
  for (const line of lines) {
    const t = type(line)
    if (t === '074') {
      headers.push({
        opening: signed(raw(line, 46, 14), raw(line, 60, 1)),
        closing: signed(raw(line, 61, 14), raw(line, 75, 1)),
        openingDate: gpcDate(raw(line, 40, 6)),
        date: gpcDate(raw(line, 109, 6)),
      })
    } else if (t === '075') {
      items.push({
        account: digits(line, 4, 16),
        documentId: digits(line, 36, 13),
        amountRaw: raw(line, 49, 12),
        code: raw(line, 61, 1),
        vs: digits(line, 62, 10),
        valueDate: raw(line, 92, 6),
        dueDate: raw(line, 123, 6),
        note: text(line, 98, 20),
        currencyRaw: raw(line, 118, 5),
        name: '',
        messages: [],
      })
    } else if (items.length && t === '076') {
      items.at(-1).name = text(line, 36, 92)
    } else if (items.length && (t === '078' || t === '079')) {
      items.at(-1).messages.push(text(line, 4, 35), text(line, 39, 35))
    }
    // 077, UHL1 a jiné řádky nenesou popis transakce → přeskočit
  }
  return { headers, items }
}

/** Součet pohybů podle dialektu (pro volbu dialektu podle zůstatků). */
function movementSum(items, dialect) {
  let sum = 0
  for (const it of items) {
    const sign = DIALECTS[dialect].codes[it.code]
    const amount = minor(it.amountRaw)
    if (!sign || amount === null) return null
    sum += sign * amount
  }
  return Math.round(sum * 100) / 100
}

const isIsoCurrency = (value) => /^00\d{3}$/.test(value) && Boolean(ISO[Number(value)])

const gpc = {
  id: 'gpc',
  name: 'ABO / GPC (většina bank)',
  encoding: 'windows-1250',
  extensions: ['.gpc', '.abo', '.txt'],
  variantLabel: 'Banka (dialekt formátu ABO)',
  variants: [
    { id: 'standard', label: 'Standard – KB, Raiffeisenbank, Moneta, Air Bank a další' },
    { id: 'cs', label: 'Česká spořitelna' },
    { id: 'currency', label: 'Fio / ČSOB (s kódem měny)' },
  ],

  detect(text_) {
    const lines = text_.split(/\r?\n/).filter((l) => l.trim())
    const tx = lines.filter((l) => l.startsWith('075'))
    if (!tx.length || !tx.some((l) => l.length >= 97)) return false
    // kromě hlavičky UHL1 (KB) jen záznamy ABO
    return lines.every((l, i) => RECORDS.includes(l.slice(0, 3)) || (i === 0 && l.startsWith('UHL1')))
  },

  /**
   * Dialekt podle obsahu souboru. Hlavička 074 kód banky neobsahuje (jen číslo účtu),
   * proto: kód 3 = jen Česká spořitelna; platný kód měny ISO v bajtech 118–122 ve všech
   * transakcích = Fio / ČSOB; kód 4 bez 3 a 5 je nejednoznačný → rozhodne kontrola
   * zůstatků (starý zůstatek + pohyby = nový zůstatek). Jinak standard.
   */
  detectVariant(text_, { bytes } = {}) {
    const { headers, items } = records(text_, bytes)
    const codes = new Set(items.map((it) => it.code))
    if (codes.has('3')) return 'cs'
    if (items.length && items.every((it) => isIsoCurrency(it.currencyRaw))) return 'currency'
    if (codes.has('4') && !codes.has('5') && headers.length) {
      const expected = headers.reduce((s, h) => s + ((h.closing ?? 0) - (h.opening ?? 0)), 0)
      const fits = (d) => {
        const sum = movementSum(items, d)
        return sum !== null && Math.abs(sum - expected) < 0.005
      }
      if (fits('cs') && !fits('standard')) return 'cs'
    }
    return 'standard'
  },

  meta(text_, { bytes } = {}) {
    const { headers, items } = records(text_, bytes)
    const dates = items.map((it) => gpcDate(it.dueDate) ?? gpcDate(it.valueDate)).filter(Boolean).sort()
    const first = headers[0]
    const last = headers.at(-1)
    return {
      from: dates[0] ?? null,
      to: [last?.date, dates.at(-1)].filter(Boolean).sort().at(-1) ?? null,
      opening: first?.opening ?? null,
      closing: last?.closing ?? null,
    }
  },

  parse(text_, { bytes, variant } = {}) {
    const dialectId = variant ?? gpc.detectVariant(text_, { bytes })
    const dialect = DIALECTS[dialectId] ?? DIALECTS.standard
    const { items } = records(text_, bytes)
    if (!items.length) throw importError('Soubor ABO neobsahuje žádné transakce (řádky 075).')

    return items.map((it) => {
      const sign = dialect.codes[it.code]
      const amount = minor(it.amountRaw)
      const date = gpcDate(it.dueDate) ?? gpcDate(it.valueDate)
      const reversal = dialect.reversal.includes(it.code)
      const counterparty = it.name || it.note
      const message = it.messages.filter(Boolean).join(' ')
      const parts = [counterparty, message].filter(Boolean)
      const body_ = parts.join(' – ') || (sign === 1 ? 'Příchozí platba' : 'Odchozí platba')
      // „Storno“ jen když to popis sám neříká
      const description = `${reversal && !/storno/i.test(body_) ? 'Storno – ' : ''}${body_}`.slice(0, 200)
      let error = ''
      if (!sign) error = `Neznámý kód zaúčtování „${it.code}“ – zkontrolujte banku`
      else if (amount === null) error = 'Neplatná částka'
      else if (amount === 0) error = 'Nulová částka'
      else if (!date) error = 'Neplatné datum'
      const value = sign && amount ? sign * amount : 0
      // otisk: účet + datum + částka + číslo dokladu (když ho banka vyplňuje)
      const externalId = it.documentId ? `${it.account}:${date ?? ''}:${Math.round(value * 100)}:${it.documentId}` : ''
      return {
        date,
        amount: value,
        currency: dialect.currency ? (ISO[Number(it.currencyRaw)] ?? 'CZK') : 'CZK',
        description,
        counterparty,
        variableSymbol: it.vs,
        externalId,
        ...(error ? { error } : {}),
      }
    })
  },
}

export default gpc
