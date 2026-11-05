import { getState, subscribe } from '../state/store.js'
import { transactionsInRange, totals, feedItems, byNewest } from '../state/selectors.js'
import { getTransactionFilter, setTransactionFilter, setMonthOffset } from '../state/transactionFilter.js'
import { renderFeed, bindFeed } from '../components/feed.js'
import { filterChips, removeFilterChip, pruneFilter, openTransactionFilterSheet } from '../components/transactionFilterSheet.js'
import { emptyFilter, filterTransactions, foundLabel, hasActiveFilter } from '../utils/transactionFilter.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { monthRange, formatMonth } from '../utils/dates.js'

const SEARCH_DEBOUNCE = 250
// Filtruje se v paměti, ale tisíce řádků v DOM by na telefonu zpomalily posouvání
const RENDER_STEP = 200

function browseMonth(offset, state) {
  const { from, to } = monthRange(offset)
  const t = totals(transactionsInRange(from, to, {}, state))
  return `
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

function searchResults(filter, shown, state) {
  const found = filterTransactions(state.transactions, filter)
  if (!found.length) {
    return `
      <div class="empty">
        ${icon('search', { size: 24 })}
        <p>Nic nenalezeno</p>
        <button type="button" class="btn btn--sm" data-clear-all>Zrušit filtry</button>
      </div>`
  }
  const t = totals(found)
  const items = found
    .map((item) => ({ kind: 'transaction', ...item }))
    .sort(byNewest)
    .slice(0, shown)
  const rest = found.length - items.length
  return `
    <p class="tx-summary">${esc(foundLabel(found.length))} · výdaje <span class="num expense">${formatMoney(-t.expense)}</span> · příjmy <span class="num income">${formatMoney(t.income, { sign: true })}</span></p>
    ${renderFeed(items)}
    ${rest ? `<button type="button" class="btn tx-more" data-more>Zobrazit další (zbývá ${rest})</button>` : ''}`
}

export default function transactionsView(el) {
  let shown = RENDER_STEP
  let timer = null

  el.innerHTML = `
    <header class="page-header">
      <div class="page-header__title">
        <a class="icon-btn back" href="/" data-link aria-label="Zpět">${icon('chevron-left')}</a>
        <h1>Transakce</h1>
      </div>
    </header>

    <div class="tx-tools">
      <div class="tx-search">
        <span class="tx-search__icon">${icon('search', { size: 18 })}</span>
        <input class="input" type="search" data-search placeholder="Hledat v poznámce, popisu, protistraně" aria-label="Hledat transakce" autocomplete="off" enterkeyhint="search">
        <button type="button" class="icon-btn" data-search-clear aria-label="Smazat hledaný text">${icon('x', { size: 18 })}</button>
      </div>
      <button type="button" class="btn tx-tools__filter" data-open-filters></button>
    </div>
    <div data-chips></div>
    <div data-results></div>`

  const input = el.querySelector('[data-search]')
  const clearBtn = el.querySelector('[data-search-clear]')
  const filterBtn = el.querySelector('[data-open-filters]')
  const chipsEl = el.querySelector('[data-chips]')
  const resultsEl = el.querySelector('[data-results]')

  /** Vstup se nepřekresluje, jinak by při psaní ztrácel fokus. */
  const draw = () => {
    const state = getState()
    const held = getTransactionFilter()
    const filter = state.loaded ? pruneFilter(held.filter, state) : held.filter
    if (filter !== held.filter) setTransactionFilter(filter)
    if (document.activeElement !== input) input.value = filter.q
    clearBtn.hidden = !input.value

    const chips = filterChips(filter, state)
    filterBtn.innerHTML = `${icon('sliders-horizontal', { size: 18 })}Filtry${chips.length ? `<span class="tx-tools__count">${chips.length}</span>` : ''}`
    chipsEl.innerHTML = chips.length
      ? `<div class="filter-chips">
          ${chips.map((c) => `<button type="button" class="filter-chip" data-chip="${esc(c.id)}" aria-label="Odebrat filtr: ${esc(c.label)}">${esc(c.label)}${icon('x', { size: 14 })}</button>`).join('')}
          <button type="button" class="filter-chips__clear" data-clear-all>Zrušit vše</button>
        </div>`
      : ''

    resultsEl.innerHTML = hasActiveFilter(filter) ? searchResults(filter, shown, state) : browseMonth(held.monthOffset, state)
  }

  const apply = (filter) => {
    shown = RENDER_STEP
    setTransactionFilter(filter)
    draw()
  }

  const commitSearch = () => {
    clearTimeout(timer)
    timer = null
    const q = input.value
    if (q !== getTransactionFilter().filter.q) apply({ ...getTransactionFilter().filter, q })
  }

  const onInput = () => {
    clearBtn.hidden = !input.value
    clearTimeout(timer)
    timer = setTimeout(commitSearch, SEARCH_DEBOUNCE)
  }

  const onClick = (e) => {
    const { filter, monthOffset } = getTransactionFilter()
    const month = e.target.closest('[data-month]')
    if (month && !month.disabled) {
      setMonthOffset(monthOffset + Number(month.dataset.month))
      return draw()
    }
    if (e.target.closest('[data-open-filters]')) return openTransactionFilterSheet(filter, apply)
    if (e.target.closest('[data-search-clear]')) {
      input.value = ''
      input.focus()
      return commitSearch()
    }
    if (e.target.closest('[data-clear-all]')) {
      input.value = ''
      return apply(emptyFilter())
    }
    const chip = e.target.closest('[data-chip]')
    if (chip) return apply(removeFilterChip(filter, chip.dataset.chip))
    if (e.target.closest('[data-more]')) {
      shown += RENDER_STEP
      draw()
    }
  }

  draw()
  const unsub = subscribe(draw)
  const unbind = bindFeed(el)
  input.addEventListener('input', onInput)
  el.addEventListener('click', onClick)
  return () => {
    if (timer) commitSearch() // rozepsané hledání se neztratí ani při rychlém odchodu
    unsub()
    unbind()
    input.removeEventListener('input', onInput)
    el.removeEventListener('click', onClick)
  }
}
