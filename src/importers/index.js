// Registr bank pro import výpisů.
// Nová banka = nový soubor v této složce se stejným rozhraním jako kb.js
// (id, name, encoding, detect, parse, volitelně meta, extensions, variants)
// + jeden řádek v BANKS. Univerzální import s mapováním sloupců je poslední
// a soubor nikdy nerozpozná sám – nabídne se, když žádná banka soubor nepozná.
import kb from './kb.js'
import gpc from './gpc.js'
import revolut from './revolut.js'
import universal from './universal.js'
import { importError, decodeBytes, decodeUnknown } from './utils.js'

export const BANKS = [kb, gpc, revolut, universal]
export const UNIVERSAL_ID = universal.id

export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_ROWS = 2000

/** Koncovky pro výběr souboru (všechny banky dohromady). */
export const ACCEPT = [...new Set(['.csv', 'text/csv', 'text/plain', 'text/comma-separated-values', 'application/vnd.ms-excel', ...BANKS.flatMap((b) => b.extensions ?? [])])].join(',')

export const bankById = (id) => BANKS.find((b) => b.id === id) ?? null

/** Text souboru v kódování banky ('auto' = UTF-8 nebo windows-1250 podle obsahu). */
export const statementText = (buffer, bank) => decodeBytes(buffer, bank?.encoding ?? 'auto')

/**
 * Přečte soubor a pozná banku. Vrací { buffer, bank, variant, text }; bank je null,
 * když formát nepoznala žádná banka (nabídne se univerzální mapování).
 */
export async function readStatement(file) {
  if (!file) throw importError('Vyberte soubor s výpisem.')
  if (file.size > MAX_FILE_SIZE) throw importError('Soubor je větší než 5 MB. Exportujte kratší období.')
  const buffer = await file.arrayBuffer()
  if (!buffer.byteLength) throw importError('Soubor je prázdný.')
  const bytes = new Uint8Array(buffer)
  for (const bank of BANKS) {
    const text = statementText(buffer, bank)
    if (bank.detect(text)) return { buffer, bank, variant: bank.detectVariant?.(text, { bytes }) ?? null, text }
  }
  const text = decodeUnknown(buffer)
  if (!text.trim()) throw importError('Soubor je prázdný.')
  return { buffer, bank: null, variant: null, text }
}

/**
 * Zpracuje výpis vybranou bankou. options: { variant } u ABO, { config } u univerzálního
 * mapování. Vrací { rows, meta }. Chyby (neznámý formát, chybí hlavička, prázdný výpis,
 * moc řádků) česky.
 */
export function parseStatement(buffer, bank, options = {}) {
  if (!bank) throw importError('Neznámý formát výpisu. Vyberte banku, ze které soubor pochází.')
  const text = statementText(buffer, bank)
  if (!text.trim()) throw importError('Soubor je prázdný.')
  if (!bank.detect(text) && bank.id !== UNIVERSAL_ID) {
    throw importError(`Soubor nevypadá jako výpis – ${bank.name}. Zkontrolujte banku a formát exportu, nebo zvolte „${universal.name}“.`)
  }
  const opts = { ...options, bytes: new Uint8Array(buffer) }
  const rows = bank.parse(text, opts)
  if (!rows.length) throw importError('Výpis neobsahuje žádné transakce.')
  if (rows.length > MAX_ROWS) throw importError(`Výpis má ${rows.length} transakcí, najednou jde importovat nejvýše ${MAX_ROWS}. Exportujte kratší období.`)
  return { rows, meta: bank.meta?.(text, opts) ?? {} }
}

/**
 * Kontrola zůstatků: starý zůstatek + součet pohybů = nový zůstatek.
 * Vrací null, když výpis zůstatky nenese; jinak { opening, closing, sum, ok, diff }.
 */
export function balanceCheck(rows, meta) {
  if (meta?.opening == null || meta?.closing == null) return null
  const sum = Math.round(rows.filter((r) => !r.error).reduce((s, r) => s + r.amount, 0) * 100) / 100
  const diff = Math.round((meta.closing - meta.opening - sum) * 100) / 100
  return { opening: meta.opening, closing: meta.closing, sum, diff, ok: Math.abs(diff) < 0.005 }
}
