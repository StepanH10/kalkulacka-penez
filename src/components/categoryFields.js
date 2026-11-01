import { getState } from '../state/store.js'
import { esc } from '../utils/dom.js'

export const CATEGORY_NAME_MAX = 30

/** Tlumené barvy ladící s paletou aplikace. */
export const CATEGORY_COLORS = [
  ['#D9944A', 'Oranžová'],
  ['#C0533A', 'Cihlová'],
  ['#CF6679', 'Růžová'],
  ['#8466AE', 'Fialová'],
  ['#4F86B5', 'Modrá'],
  ['#3E9C9E', 'Tyrkysová'],
  ['#3A7D5C', 'Zelená'],
  ['#8A8A8A', 'Šedá'],
]

export const CATEGORY_EMOJIS = [
  '🍽️', '🛒', '☕', '🚌', '🚗', '⛽', '🏠', '💡',
  '📱', '🎬', '🎮', '💊', '🏋️', '🛍️', '👕', '🎁',
  '✈️', '📚', '🐶', '💼', '💰', '📈', '🧾', '📦',
]

/** Pole formuláře kategorie: název, mřížka emoji a barev. `field` = name inputu. */
export function categoryFields({ name = '', icon = CATEGORY_EMOJIS[0], color = CATEGORY_COLORS[0][0], field = 'name', autofocus = false } = {}) {
  return `
    <label class="field">
      <span class="field__label">Název</span>
      <input class="input" name="${field}" maxlength="${CATEGORY_NAME_MAX}" autocomplete="off" enterkeyhint="done"
        value="${esc(name)}" ${autofocus ? 'autofocus' : ''}>
      <span class="field__error" data-error-for="${field}"></span>
    </label>
    <div class="field">
      <span class="field__label">Ikona</span>
      <div class="emoji-grid" role="group" aria-label="Ikona">
        ${CATEGORY_EMOJIS.map((em) => `<button type="button" data-emoji="${em}" aria-pressed="${em === icon}">${em}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <span class="field__label">Barva</span>
      <div class="swatches" role="group" aria-label="Barva">
        ${CATEGORY_COLORS.map(([c, label]) => `<button type="button" data-color="${c}" style="--swatch:${c}" aria-label="${label}" aria-pressed="${c === color}"></button>`).join('')}
      </div>
    </div>`
}

/**
 * Výběr emoji a barvy kliknutím uvnitř `root`.
 * Vrací objekt s aktuálními hodnotami ({ icon, color }) a funkci `destroy`.
 */
export function bindCategoryPickers(root, { icon = CATEGORY_EMOJIS[0], color = CATEGORY_COLORS[0][0] } = {}) {
  const value = { icon, color }
  const onClick = (e) => {
    const btn = e.target.closest('[data-emoji], [data-color]')
    if (!btn || !root.contains(btn)) return
    const attr = btn.dataset.emoji !== undefined ? 'emoji' : 'color'
    value[attr === 'emoji' ? 'icon' : 'color'] = btn.dataset[attr]
    root.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
  }
  root.addEventListener('click', onClick)
  value.destroy = () => root.removeEventListener('click', onClick)
  return value
}

/** Prázdný, příliš dlouhý nebo duplicitní název (v rámci typu, bez ohledu na velikost písmen). */
export function categoryNameError(name, type, excludeId = null) {
  const v = String(name || '').trim()
  if (!v) return 'Zadejte název kategorie.'
  if (v.length > CATEGORY_NAME_MAX) return `Název může mít nejvýše ${CATEGORY_NAME_MAX} znaků.`
  const key = v.toLocaleLowerCase('cs')
  const duplicate = getState().categories.some(
    (c) => c.type === type && c.id !== excludeId && c.name.trim().toLocaleLowerCase('cs') === key,
  )
  if (duplicate) return `Kategorie „${v}“ už mezi ${type === 'income' ? 'příjmy' : 'výdaji'} existuje.`
  return ''
}
