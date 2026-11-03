import { supabase } from '../lib/supabase.js'
import { getState, setState, emptyData, loadCache, clearCache, currentUser } from '../state/store.js'
import { loadAll, fetchMembers, storeSpace } from './api.js'
import { appError } from '../utils/errors.js'

function ensureOnline() {
  if (!navigator.onLine) throw appError('Jste offline. Změny teď nelze uložit.')
}

/** Přepne prostor (null = osobní). Hned ukáže uložená data prostoru, pak načte aktuální. */
export async function switchSpace(space) {
  const user = currentUser()
  if (!user) return
  storeSpace(user.id, space)
  const cached = loadCache(user.id, space)
  const { savedAt: _savedAt, profile: _profile, groups: _groups, ...data } = cached ?? {}
  setState({ space, ...emptyData(), members: [], ...data })
  await loadAll()
}

export async function createGroup(name) {
  ensureOnline()
  const { data, error } = await supabase.rpc('create_group', { p_name: name })
  if (error) throw error
  await switchSpace(data.id)
  return data
}

export async function renameGroup(groupId, name) {
  ensureOnline()
  const { data, error } = await supabase.from('groups').update({ name }).eq('id', groupId).select().maybeSingle()
  if (error) throw error
  if (!data) throw appError('Skupinu může přejmenovat jen vlastník.')
  setState({ groups: getState().groups.map((g) => (g.id === groupId ? { ...g, name: data.name } : g)) })
}

async function refreshMembers(groupId) {
  if (getState().space === groupId) setState({ members: await fetchMembers(groupId) })
}

export async function setMemberRole(groupId, userId, role) {
  ensureOnline()
  const { count, error } = await supabase
    .from('group_members')
    .update({ role }, { count: 'exact' })
    .eq('group_id', groupId)
    .eq('user_id', userId)
  if (error) throw error
  if (!count) throw appError('Roli se nepodařilo změnit.')
  await refreshMembers(groupId)
}

export async function removeMember(groupId, userId) {
  ensureOnline()
  const { count, error } = await supabase
    .from('group_members')
    .delete({ count: 'exact' })
    .eq('group_id', groupId)
    .eq('user_id', userId)
  if (error) throw error
  if (!count) throw appError('Člena se nepodařilo odebrat.')
  await refreshMembers(groupId)
}

export async function transferOwnership(groupId, userId) {
  ensureOnline()
  const { error } = await supabase.rpc('transfer_ownership', { p_group: groupId, p_new_owner: userId })
  if (error) throw error
  await loadAll()
}

export async function leaveGroup(groupId) {
  ensureOnline()
  const user = currentUser()
  const { count, error } = await supabase
    .from('group_members')
    .delete({ count: 'exact' })
    .eq('group_id', groupId)
    .eq('user_id', user.id)
  if (error) throw error
  if (!count) throw appError('Vlastník nemůže skupinu opustit. Nejdřív předejte vlastnictví jinému členovi.')
  clearCache(user.id, groupId)
  await switchSpace(null)
}

/** Smaže skupinu i se všemi jejími daty (jen vlastník). */
export async function deleteGroup(groupId) {
  ensureOnline()
  const { count, error } = await supabase.from('groups').delete({ count: 'exact' }).eq('id', groupId)
  if (error) throw error
  if (!count) throw appError('Skupinu může smazat jen vlastník.')
  clearCache(currentUser().id, groupId)
  await switchSpace(null)
}
