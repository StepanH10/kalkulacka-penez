// Šablony univerzálního importu CSV: mapování sloupců uložené v prohlížeči
// pro každého uživatele zvlášť. Klíč = otisk hlavičky souboru, takže se stejný
// export z banky příště namapuje sám.
import { currentUser } from '../state/store.js'

const KEY = () => `kp-import-templates-${currentUser()?.id ?? 'anon'}`
const MAX = 30

function readAll() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY()))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(KEY(), JSON.stringify(data))
  } catch {
    /* plné nebo zakázané úložiště – šablona je jen pohodlí navíc */
  }
}

/** Všechny šablony seřazené podle názvu: [{ key, name, header, config, updatedAt }]. */
export function listTemplates() {
  return Object.entries(readAll())
    .map(([key, t]) => ({ key, ...t }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}

export const findTemplate = (key) => {
  const t = readAll()[key]
  return t ? { key, ...t } : null
}

/** Uloží nebo přepíše šablonu; nejstarší se při překročení limitu zahodí. */
export function saveTemplate({ key, name, header, config }) {
  const data = readAll()
  data[key] = { name: name.trim().slice(0, 40) || 'Bez názvu', header, config, updatedAt: new Date().toISOString() }
  const keys = Object.keys(data).sort((a, b) => (data[b].updatedAt ?? '').localeCompare(data[a].updatedAt ?? ''))
  keys.slice(MAX).forEach((k) => delete data[k])
  writeAll(data)
}

export function renameTemplate(key, name) {
  const data = readAll()
  if (!data[key]) return
  data[key].name = name.trim().slice(0, 40) || data[key].name
  data[key].updatedAt = new Date().toISOString()
  writeAll(data)
}

export function deleteTemplate(key) {
  const data = readAll()
  delete data[key]
  writeAll(data)
}
