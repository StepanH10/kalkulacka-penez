import { esc } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { canEdit } from '../../state/space.js'

export function subHeader(title, action = '') {
  return `
    <header class="page-header">
      <div class="page-header__title">
        <a class="icon-btn back" href="/settings" data-link aria-label="Zpět do nastavení">${icon('chevron-left')}</a>
        <h1>${esc(title)}</h1>
      </div>
      ${action}
    </header>`
}

/** Tlačítko „přidat“ v hlavičce; pozorovatel ho nevidí. */
export function addButton(label) {
  if (!canEdit()) return ''
  return `<button type="button" class="btn btn--sm btn--primary" data-add>${icon('plus', { size: 16 })}${esc(label)}</button>`
}
