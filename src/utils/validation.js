const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value) {
  const v = String(value || '').trim()
  if (!v) return 'Zadejte e-mail.'
  if (!EMAIL_RE.test(v)) return 'Zadejte platný e-mail, např. jana@example.cz.'
  return ''
}

export function validatePassword(value) {
  if (!value) return 'Zadejte heslo.'
  if (value.length < 8) return 'Heslo musí mít alespoň 8 znaků.'
  return ''
}

export function validatePasswordConfirm(password, confirm) {
  if (!confirm) return 'Zopakujte heslo.'
  if (password !== confirm) return 'Hesla se neshodují.'
  return ''
}

export function validateName(value, label = 'jméno') {
  const v = String(value || '').trim()
  if (!v) return `Zadejte ${label}.`
  if (v.length > 60) return 'Text je příliš dlouhý (max. 60 znaků).'
  return ''
}

export const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/
export const RESERVED_USERNAMES = ['admin', 'administrator', 'support', 'system', 'moderator', 'kalkulacka', 'null', 'undefined']

/** Stejná pravidla hlídá i databáze (validate_username). */
export function validateUsername(value) {
  const v = String(value || '').trim()
  if (!v) return 'Zadejte přezdívku.'
  if (v.length < 3 || v.length > 20) return 'Přezdívka musí mít 3–20 znaků.'
  if (!USERNAME_RE.test(v)) return 'Použijte jen písmena bez diakritiky, číslice, _ nebo tečku.'
  if (RESERVED_USERNAMES.includes(v.toLowerCase())) return 'Tuto přezdívku nelze použít.'
  return ''
}

export function validateAmount(value, { allowNegative = false } = {}) {
  if (value === '' || value === null || value === undefined) return 'Zadejte částku.'
  if (Number.isNaN(value)) return 'Zadejte platnou částku, např. 1250 nebo 99,90.'
  if (!allowNegative && value <= 0) return 'Částka musí být větší než nula.'
  if (value === 0) return 'Částka nesmí být nula.'
  if (Math.abs(value) >= 1e10) return 'Částka je příliš velká.'
  return ''
}
