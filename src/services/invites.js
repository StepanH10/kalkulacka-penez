import { supabase } from '../lib/supabase.js'
import { getState, setState } from '../state/store.js'
import { loadAll, fetchMyInvites } from './api.js'
import { appError } from '../utils/errors.js'

function ensureOnline() {
  if (!navigator.onLine) throw appError('Jste offline. Změny teď nelze uložit.')
}

/** RPC vracející { ok, message, … }: neúspěch převede na chybu s českou hláškou z databáze. */
async function rpcResult(name, params) {
  ensureOnline()
  const { data, error } = await supabase.rpc(name, params)
  if (error) throw error
  if (!data?.ok) throw appError(data?.message || 'Něco se pokazilo. Zkuste to prosím znovu.')
  return data
}

/** Odkaz pro připojení ke skupině. */
export function inviteUrl(token) {
  return `${location.origin}/join/${token}`
}

// --- vlastník skupiny ---

export function inviteByTag(groupId, tag, role) {
  return rpcResult('invite_by_tag', { p_group: groupId, p_tag: tag, p_role: role })
}

export function createInviteLink(groupId, role) {
  return rpcResult('create_invite_link', { p_group: groupId, p_role: role })
}

export async function revokeInvite(inviteId) {
  ensureOnline()
  const { error } = await supabase.rpc('revoke_invite', { p_invite: inviteId })
  if (error) throw error
}

export async function fetchGroupInvites(groupId) {
  const { data, error } = await supabase.rpc('get_group_invites', { p_group: groupId })
  if (error) throw error
  return data ?? []
}

// --- pozvaný ---

/** Přijme pozvánku podle tagu; vrací id skupiny. */
export async function acceptInvite(inviteId) {
  const result = await rpcResult('accept_invite', { p_invite: inviteId })
  await loadAll()
  return result.group_id
}

export async function declineInvite(inviteId) {
  ensureOnline()
  const { error } = await supabase.rpc('decline_invite', { p_invite: inviteId })
  if (error) throw error
  setState({ invites: getState().invites.filter((i) => i.id !== inviteId) })
  // pozvánka mohla mezitím vypršet – seznam se srovná s databází
  setState({ invites: await fetchMyInvites() })
}

export function previewInviteToken(token) {
  return rpcResult('preview_invite_token', { p_token: token })
}

/** Připojí se ke skupině odkazem; vrací id skupiny. */
export async function acceptInviteToken(token) {
  const result = await rpcResult('accept_invite_token', { p_token: token })
  await loadAll()
  return result.group_id
}
