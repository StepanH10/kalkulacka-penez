import { supabase } from '../lib/supabase.js'
import { getState, setState, saveCache, loadCache, clearCache, currentUser, emptyData } from '../state/store.js'
import { showToast } from '../components/toast.js'
import { appError } from '../utils/errors.js'
import { today } from '../utils/dates.js'

/** Klíč ve stavu → tabulka v databázi. */
export const TABLES = {
  accounts: 'accounts',
  categories: 'categories',
  transactions: 'transactions',
  transfers: 'transfers',
  goals: 'savings_goals',
  entries: 'savings_entries',
  budgets: 'budgets',
  recurring: 'recurring',
}

const PAGE = 1000
const SPACE_KEY = (userId) => `kp-space-${userId}`

/** Zvolený prostor uložený v prohlížeči (null = osobní). */
export function readStoredSpace(userId) {
  try {
    return localStorage.getItem(SPACE_KEY(userId)) || null
  } catch {
    return null
  }
}

export function storeSpace(userId, space) {
  try {
    if (space) localStorage.setItem(SPACE_KEY(userId), space)
    else localStorage.removeItem(SPACE_KEY(userId))
  } catch {
    /* nevadí */
  }
}

/** Řádky jen aktuálního prostoru: osobní (group_id null) nebo jedné skupiny. */
async function fetchAll(table, order, space) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select('*')
    query = space ? query.eq('group_id', space) : query.is('group_id', null)
    const { data, error } = await query
      .order(order, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

async function fetchGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('role, groups(id, name, owner_id, created_at)')
    .eq('user_id', userId)
  if (error) throw error
  return data
    .filter((m) => m.groups)
    .map((m) => ({ ...m.groups, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}

export async function fetchMembers(groupId) {
  const { data, error } = await supabase.rpc('get_group_members', { p_group: groupId })
  if (error) throw error
  return data ?? []
}

let loading = null
let loadingSpace
let loadSeq = 0

/**
 * Načte profil, seznam skupin a data aktuálního prostoru.
 * Bez připojení použije poslední uloženou cache prostoru.
 */
export function loadAll() {
  const user = currentUser()
  if (!user) return Promise.resolve()
  const requested = getState().space === undefined ? readStoredSpace(user.id) : getState().space
  if (loading && loadingSpace === requested) return loading
  const seq = ++loadSeq
  loadingSpace = requested

  const run = (async () => {
    let space = requested
    try {
      const [profile, groups] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        fetchGroups(user.id),
      ])
      if (profile.error) throw profile.error
      // ze skupiny mě mezitím odebrali nebo zanikla → zpět do osobního prostoru
      const lost = space && !groups.some((g) => g.id === space)
      if (lost) {
        space = null
        storeSpace(user.id, null)
        clearCache(user.id, requested)
      }
      const [lists, members] = await Promise.all([
        Promise.all(
          Object.values(TABLES).map((t) => fetchAll(t, ['transactions', 'transfers', 'savings_entries'].includes(t) ? 'date' : 'created_at', space)),
        ),
        space ? fetchMembers(space) : [],
      ])
      if (seq !== loadSeq) return // mezitím se přepnul prostor
      const data = Object.fromEntries(Object.keys(TABLES).map((k, i) => [k, lists[i]]))
      setState({ profile: profile.data, groups, members, space, ...data, loaded: true, offline: false })
      saveCache()
      if (lost) showToast('Skupina už pro vás není dostupná. Přepnuto na osobní prostor.', { duration: 6000 })
    } catch (error) {
      if (seq !== loadSeq) return
      const cached = loadCache(user.id, space)
      if (!cached) throw error
      const { savedAt: _savedAt, ...data } = cached
      setState({ ...emptyData(), members: [], ...data, space, loaded: true, offline: true })
    }
  })().finally(() => {
    if (loading === run) loading = null
  })
  loading = run
  return run
}

function ensureOnline() {
  if (!navigator.onLine) throw appError('Jste offline. Změny teď nelze uložit.')
}

function commit(key, rows) {
  setState({ [key]: rows })
  saveCache()
}

export async function createRow(key, row) {
  ensureOnline()
  const { data, error } = await supabase
    .from(TABLES[key])
    // ve skupině přepíše user_id na null databáze (trigger set_row_scope)
    .insert({ ...row, user_id: currentUser().id, group_id: getState().space ?? null })
    .select()
    .single()
  if (error) throw error
  commit(key, [...getState()[key], data])
  return data
}

export async function updateRow(key, id, patch) {
  ensureOnline()
  const { data, error } = await supabase.from(TABLES[key]).update(patch).eq('id', id).select().single()
  if (error) throw error
  commit(
    key,
    getState()[key].map((r) => (r.id === id ? data : r)),
  )
  return data
}

/** Smaže řádek. U tabulek s kaskádou (účty, kategorie, cíle) znovu načte data. */
export async function deleteRow(key, id) {
  ensureOnline()
  const { error } = await supabase.from(TABLES[key]).delete().eq('id', id)
  if (error) throw error
  if (['accounts', 'categories', 'goals', 'recurring'].includes(key)) {
    await loadAll()
  } else {
    commit(
      key,
      getState()[key].filter((r) => r.id !== id),
    )
  }
}

/** Přesune transakce a opakované platby z jedné kategorie do jiné (null = bez kategorie). */
export async function reassignCategory(fromId, toId) {
  ensureOnline()
  for (const table of ['transactions', 'recurring']) {
    const { error } = await supabase.from(table).update({ category_id: toId }).eq('category_id', fromId)
    if (error) throw error
  }
}

/** Vrátí smazaný řádek zpět (tlačítko „Zpět“). */
export async function restoreRow(key, row) {
  ensureOnline()
  const { kind: _kind, ...clean } = row
  const { data, error } = await supabase.from(TABLES[key]).insert(clean).select().single()
  if (error) throw error
  commit(key, [...getState()[key], data])
  return data
}

/** Nastaví nebo změní přezdívku. Číslo (discriminator) přidělí databáze. */
export async function setUsername(username) {
  ensureOnline()
  const { data, error } = await supabase.rpc('set_username', { p_username: username })
  if (error) throw error
  setState({ profile: data })
  saveCache()
  return data
}

/** Vytvoří splatné opakované transakce. Vrací počet nově vytvořených. */
export async function processRecurring() {
  if (!navigator.onLine) return 0
  const { data, error } = await supabase.rpc('process_recurring', { p_today: today() })
  if (error) throw error
  if (data > 0) await loadAll()
  return data ?? 0
}

/** Uloží řádky ze zálohy (upsert podle id) po dávkách. */
export async function upsertRows(key, rows, onConflict = 'id') {
  ensureOnline()
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from(TABLES[key]).upsert(rows.slice(i, i + 500), { onConflict })
    if (error) throw error
  }
}
