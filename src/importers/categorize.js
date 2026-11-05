// Automatické kategorie pro importované transakce (bez závislostí na DOM / store).
import { normalizeText } from './utils.js'

/** Typ transakce podle znaménka: záporná = výdaj, kladná = příjem. */
export const rowType = (row) => (row.amount < 0 ? 'expense' : 'income')

/** Text, ve kterém se hledají pravidla: protistrana + popis. */
export const matchSource = (row) => normalizeText(`${row.counterparty ?? ''} ${row.description ?? ''}`)

/** Kategorie „Ostatní“ daného typu, jinak první kategorie typu. */
export function fallbackCategory(type, categories) {
  const ofType = categories.filter((c) => c.type === type)
  return ofType.find((c) => normalizeText(c.name) === 'ostatni') ?? ofType[0] ?? null
}

/**
 * Pravidlo pro řádek: jen pravidla, jejichž kategorie má stejný typ
 * jako řádek. Při více shodách vyhrává nejdelší (nejkonkrétnější) text,
 * pak novější pravidlo.
 */
export function findRule(row, rules, categories) {
  const type = rowType(row)
  const byId = new Map(categories.map((c) => [c.id, c]))
  const source = matchSource(row)
  let best = null
  for (const rule of rules) {
    if (byId.get(rule.category_id)?.type !== type) continue
    const text = normalizeText(rule.match_text)
    if (!text || !source.includes(text)) continue
    if (
      !best ||
      text.length > normalizeText(best.match_text).length ||
      (text.length === normalizeText(best.match_text).length && (rule.created_at ?? '') > (best.created_at ?? ''))
    ) {
      best = rule
    }
  }
  return best
}

/** Navržená kategorie: podle pravidla, jinak „Ostatní“ příslušného typu. */
export function suggestCategory(row, rules, categories) {
  const rule = findRule(row, rules, categories)
  return rule ? rule.category_id : (fallbackCategory(rowType(row), categories)?.id ?? null)
}

/** Existující pravidlo se stejným textem pro stejný typ (při „zapamatovat“ se upraví, nevytváří se druhé). */
export function sameRule(matchText, type, rules, categories) {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const text = normalizeText(matchText)
  return rules.find((r) => normalizeText(r.match_text) === text && byId.get(r.category_id)?.type === type) ?? null
}

/** Návrh textu pravidla z řádku: protistrana, jinak začátek popisu (max. 60 znaků). */
export const ruleTextFor = (row) => String(row.counterparty || row.description || '').trim().slice(0, 60)
