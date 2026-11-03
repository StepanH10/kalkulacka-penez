import { supabase } from '../lib/supabase.js'
import { appError } from '../utils/errors.js'
import { clearCache, currentUser, resetData, setState } from '../state/store.js'

export async function signUp({ email, password, username }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Přezdívku s náhodným číslem uloží do profilu trigger handle_new_user
      data: { username, display_name: username },
      emailRedirectTo: `${location.origin}/`,
    },
  })
  if (error) throw error
  // Při zapnutém potvrzování e-mailu vrací Supabase u existujícího účtu „falešného“ uživatele bez identit
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw appError('Účet s tímto e-mailem už existuje. Zkuste se přihlásit.')
  }
  return { needsConfirmation: !data.session }
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const user = currentUser()
  const { error } = await supabase.auth.signOut()
  if (user) clearCache(user.id)
  resetData()
  setState({ session: null })
  if (error) throw error
}

export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}/reset-password`,
  })
  if (error) throw error
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

/** Ověří současné heslo opětovným přihlášením. */
export async function verifyPassword(password) {
  const email = currentUser()?.email
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.code === 'invalid_credentials' || /invalid login/i.test(error.message)) {
      throw appError('Současné heslo není správné.')
    }
    throw error
  }
}

/** Smaže účet včetně všech dat (funkce delete_user v databázi). */
export async function deleteAccount() {
  const user = currentUser()
  const { error } = await supabase.rpc('delete_user')
  if (error) throw error
  await supabase.auth.signOut({ scope: 'local' })
  if (user) clearCache(user.id)
  resetData()
  setState({ session: null })
}
