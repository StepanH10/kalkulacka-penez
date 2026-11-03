import { supabase } from '../lib/supabase.js'
import { getState, setState, subscribe, currentUser } from '../state/store.js'
import { loadAll, fetchMyInvites } from './api.js'

export function unreadCount(state = getState()) {
  return state.notifications.filter((n) => !n.read_at).length
}

export async function markRead(id) {
  const n = getState().notifications.find((x) => x.id === id)
  if (!n || n.read_at) return
  const read_at = new Date().toISOString()
  setState({ notifications: getState().notifications.map((x) => (x.id === id ? { ...x, read_at } : x)) })
  const { error } = await supabase.from('notifications').update({ read_at }).eq('id', id)
  if (error) throw error
}

export async function markAllRead() {
  const read_at = new Date().toISOString()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at })
    .eq('user_id', currentUser().id)
    .is('read_at', null)
  if (error) throw error
  setState({ notifications: getState().notifications.map((x) => (x.read_at ? x : { ...x, read_at })) })
}

/**
 * Nová upozornění přes Supabase Realtime (jen INSERT pro přihlášeného; RLS platí i tady).
 * Podle typu dočte, co se změnilo: pozvánky, skupiny/role, data aktuální skupiny.
 * onNew(notification) – např. toast. Vrací funkci pro odhlášení.
 */
export function watchNotifications(onNew) {
  let channel = null
  let userId = null

  const handle = async (n) => {
    if (getState().notifications.some((x) => x.id === n.id)) return
    setState({ notifications: [n, ...getState().notifications].slice(0, 50) })
    onNew?.(n)
    try {
      if (n.type === 'invite_received') {
        setState({ invites: await fetchMyInvites() })
      } else if (n.type !== 'group_expense' || n.data?.group_id === getState().space) {
        // role, odebrání, nový člen nebo výdaj ve zvolené skupině → obnovit data
        await loadAll()
      }
    } catch {
      /* obnoví se při dalším návratu do aplikace */
    }
  }

  const connect = () => {
    const id = currentUser()?.id ?? null
    if (id === userId) return
    if (channel) supabase.removeChannel(channel)
    channel = null
    userId = id
    if (!id) return
    channel = supabase
      .channel(`notifications:${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${id}` },
        (payload) => handle(payload.new),
      )
      .subscribe()
  }

  connect()
  const unsub = subscribe(connect)
  return () => {
    unsub()
    if (channel) supabase.removeChannel(channel)
  }
}
