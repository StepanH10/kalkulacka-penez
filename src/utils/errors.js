const BY_CODE = {
  invalid_credentials: 'Nesprávný e-mail nebo heslo.',
  user_already_exists: 'Účet s tímto e-mailem už existuje. Zkuste se přihlásit.',
  email_exists: 'Účet s tímto e-mailem už existuje. Zkuste se přihlásit.',
  email_not_confirmed: 'E-mail zatím není potvrzený. Klikněte na odkaz, který jsme vám poslali.',
  weak_password: 'Heslo je příliš slabé. Použijte alespoň 8 znaků a kombinaci písmen a čísel.',
  same_password: 'Nové heslo musí být jiné než současné.',
  email_address_invalid: 'Zadejte platný e-mail.',
  validation_failed: 'Zadané údaje nejsou platné.',
  signup_disabled: 'Registrace jsou momentálně vypnuté.',
  over_email_send_rate_limit: 'Odeslali jsme příliš mnoho e-mailů. Zkuste to prosím za chvíli.',
  over_request_rate_limit: 'Příliš mnoho pokusů. Zkuste to prosím za chvíli.',
  user_not_found: 'Uživatel nebyl nalezen.',
  session_not_found: 'Platnost přihlášení vypršela. Přihlaste se znovu.',
  refresh_token_not_found: 'Platnost přihlášení vypršela. Přihlaste se znovu.',
  otp_expired: 'Odkaz už vypršel. Požádejte o nový.',
  reauthentication_needed: 'Pro tuto změnu se musíte znovu přihlásit.',
  // PostgreSQL / PostgREST
  23505: 'Taková položka už existuje.',
  23503: 'Položka odkazuje na neexistující nebo smazaná data.',
  23514: 'Zadané hodnoty nejsou platné.',
  42501: 'K této akci nemáte oprávnění.',
  PGRST301: 'Platnost přihlášení vypršela. Přihlaste se znovu.',
}

const BY_MESSAGE = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/user already registered/i, BY_CODE.user_already_exists],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/password should be at least/i, 'Heslo musí mít alespoň 8 znaků.'],
  [/password is known to be weak|weak password/i, BY_CODE.weak_password],
  [/new password should be different/i, BY_CODE.same_password],
  [/rate limit|too many requests/i, BY_CODE.over_request_rate_limit],
  [/unable to validate email|invalid email|email address .* is invalid/i, BY_CODE.email_address_invalid],
  [/failed to fetch|networkerror|network request failed|load failed/i, 'Nelze se připojit k serveru. Zkontrolujte připojení k internetu.'],
  [/jwt expired/i, BY_CODE.PGRST301],
]

/** Převede chybu ze Supabase na srozumitelnou českou hlášku. */
export function translateError(error) {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (error.czMessage) return error.czMessage
  const code = error.code ?? error.error_code
  // Vlastní chyby z databázových funkcí (kód KPxxx) už nesou českou hlášku
  if (typeof code === 'string' && code.startsWith('KP') && error.message) return error.message
  if (code && BY_CODE[code]) return BY_CODE[code]
  const message = String(error.message ?? error.error_description ?? '')
  for (const [pattern, text] of BY_MESSAGE) {
    if (pattern.test(message)) return text
  }
  if (!navigator.onLine) return 'Jste offline. Změny teď nelze uložit.'
  return 'Něco se pokazilo. Zkuste to prosím znovu.'
}

/** Chyba s už přeloženou hláškou. */
export function appError(czMessage) {
  const err = new Error(czMessage)
  err.czMessage = czMessage
  return err
}
