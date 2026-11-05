// Počáteční zůstatek účtu podle výpisu: kdy ho nabídnout a jaký bude výsledný zůstatek.
// Bez závislostí na DOM / store, aby šlo testovat v Node.

const cents = (n) => Math.round(n * 100) / 100

/**
 * Datum počátečního zůstatku: starší z začátku výpisu a nejstaršího pohybu ve výpisu.
 * Výpis totiž může obsahovat platbu provedenou před svým začátkem (provedeno 30. 9.,
 * zaúčtováno 2. 10.) a ta musí zůstat ve výsledném zůstatku.
 */
export function openingDate(meta, rows) {
  const dates = rows.filter((r) => !r.error && r.date).map((r) => r.date)
  if (meta?.from) dates.push(meta.from)
  return dates.sort()[0] ?? null
}

/**
 * Nabídka pro účet: 'set' (účet zůstatek nemá), 'overwrite' (výpis je starší než současné
 * datum), jinak null. Výpis bez zůstatků (Revolut, vlastní mapování) nic nenabízí.
 */
export function openingOffer(account, meta, rows) {
  if (!account || meta?.opening == null) return null
  const date = openingDate(meta, rows)
  if (!date) return null
  const current = account.opening_balance_date ?? null
  if (current && date >= current) return null
  return {
    mode: current ? 'overwrite' : 'set',
    amount: meta.opening,
    date,
    closing: meta.closing ?? null,
    to: meta.to ?? null,
  }
}

/**
 * Výsledek po importu s počátečním zůstatkem z nabídky.
 * importing: vybrané řádky výpisu ({ date, amount } se znaménkem).
 * Vrací { balance, atStatementEnd, later, diff, matches, hidden }:
 * balance = zůstatek účtu se všemi pohyby, atStatementEnd = jen s pohyby do konce výpisu
 * (ten se porovnává s konečným zůstatkem), later = pohyby po konci výpisu,
 * hidden = počet stávajících pohybů starších než datum, které se přestanou počítat.
 */
export function projectBalance({ accountId, offer, transactions = [], transfers = [], importing = [] }) {
  const moves = [
    ...transactions.filter((t) => t.account_id === accountId).map((t) => ({ date: t.date, amount: (t.type === 'income' ? 1 : -1) * Number(t.amount) })),
    ...transfers.filter((t) => t.from_account_id === accountId).map((t) => ({ date: t.date, amount: -Number(t.amount) })),
    ...transfers.filter((t) => t.to_account_id === accountId).map((t) => ({ date: t.date, amount: Number(t.amount) })),
  ]
  const hidden = moves.filter((m) => m.date < offer.date).length
  const counted = [...moves, ...importing].filter((m) => m.date >= offer.date)
  const sum = (list) => list.reduce((s, m) => s + m.amount, 0)
  const end = offer.to ?? '9999-12-31'
  const balance = cents(offer.amount + sum(counted))
  const atStatementEnd = cents(offer.amount + sum(counted.filter((m) => m.date <= end)))
  const later = cents(balance - atStatementEnd)
  const diff = offer.closing === null ? null : cents(atStatementEnd - offer.closing)
  return { balance, atStatementEnd, later, diff, matches: diff === null ? null : Math.abs(diff) < 0.005, hidden }
}
