import { getState, currentUser } from '../state/store.js'
import { categoryMap, accountMap } from '../state/selectors.js'
import { loadAll, upsertRows } from './api.js'
import { appError } from '../utils/errors.js'
import { downloadFile } from '../utils/dom.js'
import { today } from '../utils/dates.js'

// Pořadí respektuje cizí klíče
const ORDER = ['accounts', 'categories', 'recurring', 'transactions', 'transfers', 'goals', 'entries', 'budgets']

const strip = ({ user_id: _u, kind: _k, ...rest }) => rest

export function exportJSON() {
  const state = getState()
  const data = Object.fromEntries(ORDER.map((k) => [k, state[k].map(strip)]))
  const payload = {
    app: 'kalkulacka-penez',
    version: 1,
    exported_at: new Date().toISOString(),
    profile: { display_name: state.profile?.display_name ?? '' },
    data,
  }
  downloadFile(`kalkulacka-penez-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json')
}

/** Přečte a zkontroluje soubor zálohy. Vrací { payload, count }. */
export async function readBackup(file) {
  let payload
  try {
    payload = JSON.parse(await file.text())
  } catch {
    throw appError('Soubor není platný JSON.')
  }
  if (payload?.app !== 'kalkulacka-penez' || typeof payload.data !== 'object') {
    throw appError('Soubor není záloha Kalkulačky peněz.')
  }
  for (const key of ORDER) {
    if (payload.data[key] !== undefined && !Array.isArray(payload.data[key])) {
      throw appError('Záloha je poškozená.')
    }
  }
  const count = ORDER.reduce((s, k) => s + (payload.data[k]?.length ?? 0), 0)
  return { payload, count }
}

/** Obnoví data ze zálohy. Existující položky se stejným id se přepíšou. */
export async function importBackup(payload) {
  const userId = currentUser().id
  for (const key of ORDER) {
    const rows = (payload.data[key] ?? []).map((r) => ({ ...strip(r), user_id: userId }))
    if (!rows.length) continue
    await upsertRows(key, rows, key === 'budgets' ? 'user_id,category_id' : 'id')
  }
  await loadAll()
}

const csvCell = (value) => {
  const s = String(value ?? '')
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Export transakcí do CSV (středník + desetinná čárka pro český Excel). */
export function exportCSV() {
  const state = getState()
  const cats = categoryMap(state)
  const accs = accountMap(state)
  const rows = [...state.transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => [
      t.date,
      t.type === 'income' ? 'Příjem' : 'Výdaj',
      (t.type === 'income' ? 1 : -1) * Number(t.amount),
      cats.get(t.category_id)?.name ?? 'Bez kategorie',
      accs.get(t.account_id)?.name ?? '',
      t.note,
    ])
  const lines = [
    ['Datum', 'Typ', 'Částka (Kč)', 'Kategorie', 'Účet', 'Poznámka'],
    ...rows.map((r) => [r[0], r[1], String(r[2]).replace('.', ','), r[3], r[4], r[5]]),
  ].map((r) => r.map(csvCell).join(';'))
  downloadFile(`transakce-${today()}.csv`, `﻿${lines.join('\r\n')}`, 'text/csv;charset=utf-8')
}
