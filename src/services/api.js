import { supabase } from '../lib/supabase.js'
import { getState, setState, saveCache, loadCache, currentUser } from '../state/store.js'
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

async function fetchAll(table, order = 'created_at') {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order, { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

let loading = null

/** Načte všechna data uživatele. Bez připojení použije poslední uloženou cache. */
export function loadAll() {
  if (loading) return loading
  loading = (async () => {
    const user = currentUser()
    if (!user) return
    try {
      const [profile, ...lists] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        ...Object.values(TABLES).map((t) => fetchAll(t, ['transactions', 'transfers', 'savings_entries'].includes(t) ? 'date' : 'created_at')),
      ])
      if (profile.error) throw profile.error
      const data = Object.fromEntries(Object.keys(TABLES).map((k, i) => [k, lists[i]]))
      setState({ profile: profile.data, ...data, loaded: true, offline: false })
      saveCache()
    } catch (error) {
      const cached = loadCache(user.id)
      if (!cached) throw error
      const { savedAt: _savedAt, ...data } = cached
      setState({ ...data, loaded: true, offline: true })
    }
  })().finally(() => {
    loading = null
  })
  return loading
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
    .insert({ ...row, user_id: currentUser().id })
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

export async function updateProfile(patch) {
  ensureOnline()
  const user = currentUser()
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', user.id).select().single()
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
