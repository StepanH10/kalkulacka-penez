// Registr bank pro import CSV výpisů.
// Nová banka = nový soubor v této složce se stejným rozhraním jako kb.js
// (id, name, encoding, detect, parse, volitelně meta) + jeden řádek v BANKS.
import kb from './kb.js'
import { importError, decodeBytes, decodeUnknown } from './utils.js'

export const BANKS = [kb]

export const MAX_FILE_SIZE = 5 * 1024 * 1024
export const MAX_ROWS = 2000

export const bankById = (id) => BANKS.find((b) => b.id === id) ?? null

/**
 * Přečte soubor a pozná banku. Vrací { buffer, bank, text }; bank je null,
 * když formát nepoznala žádná banka (uživatel ji může vybrat ručně).
 */
export async function readStatement(file) {
  if (!file) throw importError('Vyberte soubor s výpisem.')
  if (file.size > MAX_FILE_SIZE) throw importError('Soubor je větší než 5 MB. Exportujte kratší období.')
  const buffer = await file.arrayBuffer()
  if (!buffer.byteLength) throw importError('Soubor je prázdný.')
  for (const bank of BANKS) {
    const text = decodeBytes(buffer, bank.encoding)
    if (bank.detect(text)) return { buffer, bank, text }
  }
  const text = decodeUnknown(buffer)
  if (!text.trim()) throw importError('Soubor je prázdný.')
  return { buffer, bank: null, text }
}

/**
 * Zpracuje výpis vybranou bankou. Vrací { rows, meta }.
 * Chyby (neznámý formát, chybí hlavička, prázdný výpis, moc řádků) česky.
 */
export function parseStatement(buffer, bank) {
  if (!bank) throw importError('Neznámý formát výpisu. Vyberte banku, ze které soubor pochází.')
  const text = decodeBytes(buffer, bank.encoding)
  if (!text.trim()) throw importError('Soubor je prázdný.')
  if (!bank.detect(text)) throw importError(`Soubor nevypadá jako výpis z banky ${bank.name}. Zkontrolujte, že jste stáhli výpis ve formátu CSV.`)
  const rows = bank.parse(text)
  if (!rows.length) throw importError('Výpis neobsahuje žádné transakce.')
  if (rows.length > MAX_ROWS) throw importError(`Výpis má ${rows.length} transakcí, najednou jde importovat nejvýše ${MAX_ROWS}. Exportujte kratší období.`)
  return { rows, meta: bank.meta?.(text) ?? {} }
}
