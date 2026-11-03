// Aktuální prostor (osobní / skupina) a oprávnění v něm.
// Databáze (RLS) pravidla hlídá vždy; tady jen skrýváme akce, které by stejně neprošly.
import { getState, currentUser } from './store.js'

export const ROLE_LABELS = { owner: 'Vlastník', editor: 'Editor', viewer: 'Pozorovatel' }

export function currentGroup(state = getState()) {
  return state.space ? (state.groups.find((g) => g.id === state.space) ?? null) : null
}

/** 'personal' | 'owner' | 'editor' | 'viewer' */
export function spaceRole(state = getState()) {
  return currentGroup(state)?.role ?? 'personal'
}

/** Vytvářet a upravovat (osobní prostor, vlastník, editor). */
export function canEdit(state = getState()) {
  return spaceRole(state) !== 'viewer'
}

/** Mazat účty, kategorie, rozpočty, cíle a opakované platby (osobní prostor, vlastník). */
export function canManage(state = getState()) {
  const role = spaceRole(state)
  return role === 'personal' || role === 'owner'
}

/** Upravit / smazat transakci, převod nebo vklad: vlastník, nebo autor s právem editace. */
export function canModifyEntry(entry, state = getState()) {
  const role = spaceRole(state)
  if (role === 'personal' || role === 'owner') return true
  return role === 'editor' && entry?.created_by === currentUser()?.id
}

/** Přezdívka autora záznamu ve skupině; kdo už není členem, je „Bývalý člen“. */
export function authorName(userId, state = getState()) {
  const member = state.members.find((m) => m.user_id === userId)
  return member?.username ?? 'Bývalý člen'
}
