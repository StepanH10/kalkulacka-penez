import { getState, subscribe } from '../state/store.js'
import { transactionsInRange, totals, feedItems } from '../state/selectors.js'
import { renderFeed, bindFeed } from '../components/feed.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { monthRange, formatMonth } from '../utils/dates.js'

export default function transactionsView(el) {
  let offset = 0

  const draw = () => {
    const state = getState()
    const { from, to } = monthRange(offset)
    const t = totals(transactionsInRange(from, to))
    el.innerHTML = `
      <header class="page-header">
        <div class="page-header__title">
          <a class="icon-btn back" href="/" data-link aria-label="Zpět">${icon('chevron-left')}</a>
          <h1>Transakce</h1>
        </div>
      </header>

      <div class="month-switch">
        <button type="button" class="icon-btn" data-month="-1" aria-label="Předchozí měsíc">${icon('chevron-left')}</button>
        <strong>${esc(formatMonth(from))}</strong>
        <button type="button" class="icon-btn" data-month="1" aria-label="Další měsíc" ${offset >= 0 ? 'disabled' : ''}>${icon('chevron-right')}</button>
      </div>

      <div class="grid-2" style="margin-bottom:24px">
        <div class="card stat"><span class="stat__label">Příjmy</span><span class="stat__value income">${formatMoney(t.income)}</span></div>
        <div class="card stat"><span class="stat__label">Výdaje</span><span class="stat__value expense">${formatMoney(t.expense)}</span></div>
      </div>

      ${renderFeed(feedItems({ from, to }, state), 'V tomto měsíci nejsou žádné transakce.')}`
  }

  draw()
  const unsub = subscribe(draw)
  const unbind = bindFeed(el)
  const onClick = (e) => {
    const btn = e.target.closest('[data-month]')
    if (!btn || btn.disabled) return
    offset += Number(btn.dataset.month)
    draw()
  }
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    unbind()
    el.removeEventListener('click', onClick)
  }
}
