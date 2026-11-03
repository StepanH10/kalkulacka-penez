const moneyWhole = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const moneyCents = new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const plainNumber = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 2 })

/** Formát částky: 1 250 Kč, případně 1 250,50 Kč. Volitelně se znaménkem. */
export function formatMoney(value, { sign = false } = {}) {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  const text = Number.isInteger(Math.round(abs * 100) / 100) ? moneyWhole.format(abs) : moneyCents.format(abs)
  if (n < 0) return `−${text}`
  if (sign && n > 0) return `+${text}`
  return text
}

export function formatNumber(value) {
  return plainNumber.format(Number(value) || 0)
}

/** Převede vstup „1 250,50“ na číslo; vrací NaN, pokud není platné. */
export function parseAmount(input) {
  const cleaned = String(input ?? '')
    .replace(/[\s ]/g, '')
    .replace(/kč/i, '')
    .replace(',', '.')
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return NaN
  return Number(cleaned)
}

/** Hodnota pro předvyplnění inputu: 1250.5 → „1250,5“ */
export function amountToInput(value) {
  if (value === null || value === undefined || value === '') return ''
  return String(Number(value)).replace('.', ',')
}

export function formatPercent(ratio) {
  return `${Math.round(ratio * 100)} %`
}

/** Tag uživatele „jana#0482“ (bez přezdívky prázdný řetězec). */
export function formatTag(profile) {
  return profile?.username ? `${profile.username}#${profile.discriminator ?? '????'}` : ''
}

export function initials(name) {
  return (
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}
