import { getState, subscribe } from '../state/store.js'
import { transactionsInRange, totals, categoryMap, categoriesByType } from '../state/selectors.js'
import { donutChart, barChart } from '../components/charts.js'
import subscriptionsTab from './subscriptions.js'
import { authorName } from '../state/space.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { monthRange, monthsBetween, formatMonthShort, formatDate, today, toISODate } from '../utils/dates.js'

const PERIODS = [
  ['this', 'Tento měsíc'],
  ['last', 'Minulý měsíc'],
  ['custom', 'Vlastní'],
]

function resolveRange(filter) {
  if (filter.period === 'this') return monthRange(0)
  if (filter.period === 'last') return monthRange(-1)
  const from = filter.from || monthRange(0).from
  const to = filter.to || today()
  return from <= to ? { from, to } : { from: to, to: from }
}

/** Měsíce pro sloupcový graf: u jednoho měsíce posledních 6, jinak měsíce v období. */
function barMonths({ from, to }) {
  const months = monthsBetween(from, to)
  if (months.length > 1) return months.slice(-24)
  const end = new Date(`${to}T12:00:00`)
  const start = new Date(end.getFullYear(), end.getMonth() - 5, 1)
  return monthsBetween(toISODate(start), to)
}

function categoryOptions(selected) {
  const group = (type, label) =>
    `<optgroup label="${label}">${categoriesByType(type)
      .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
      .join('')}</optgroup>`
  return `<option value="">Všechny kategorie</option>${group('expense', 'Výdaje')}${group('income', 'Příjmy')}`
}

function overviewTab(el) {
  const filter = { period: 'this', from: monthRange(0).from, to: today(), categoryId: '' }
  let charts = []

  const destroyCharts = () => {
    charts.forEach((c) => c.destroy())
    charts = []
  }

  const draw = () => {
    destroyCharts()
    const state = getState()
    const range = resolveRange(filter)
    const list = transactionsInRange(range.from, range.to, { categoryId: filter.categoryId }, state)
    const sum = totals(list)
    const cats = categoryMap(state)

    // Výdaje podle kategorií
    const byCat = new Map()
    for (const t of list) {
      if (t.type !== 'expense') continue
      byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) + Number(t.amount))
    }
    const slices = [...byCat]
      .map(([id, value]) => ({ cat: cats.get(id), value }))
      .sort((a, b) => b.value - a.value)

    // Skupina: výdaje podle členů (autor transakce; kdo odešel = „Bývalý člen“)
    const byMember = new Map()
    if (state.space) {
      for (const t of list) {
        if (t.type !== 'expense') continue
        const name = authorName(t.created_by, state)
        byMember.set(name, (byMember.get(name) ?? 0) + Number(t.amount))
      }
    }
    const memberRows = [...byMember].sort((a, b) => b[1] - a[1])

    // Příjmy vs. výdaje po měsících
    const months = barMonths(range)
    const monthly = new Map(months.map((m) => [m, { income: 0, expense: 0 }]))
    for (const t of state.transactions) {
      const m = monthly.get(t.date.slice(0, 7))
      if (!m || (filter.categoryId && t.category_id !== filter.categoryId)) continue
      m[t.type] += Number(t.amount)
    }

    el.innerHTML = `
      <div class="filters">
        <div class="pills" role="group" aria-label="Období">
          ${PERIODS.map(([key, label]) => `<button type="button" class="pill" data-period="${key}" aria-pressed="${filter.period === key}">${label}</button>`).join('')}
        </div>
        ${
          filter.period === 'custom'
            ? `<div class="period-custom">
                <label class="field"><span class="field__label">Od</span><input class="input" type="date" name="from" value="${filter.from}"></label>
                <label class="field"><span class="field__label">Do</span><input class="input" type="date" name="to" value="${filter.to}"></label>
              </div>`
            : ''
        }
        <select class="select" name="category" aria-label="Kategorie">${categoryOptions(filter.categoryId)}</select>
      </div>

      <div class="grid-2">
        <div class="card stat"><span class="stat__label">Příjmy</span><span class="stat__value income">${formatMoney(sum.income)}</span></div>
        <div class="card stat"><span class="stat__label">Výdaje</span><span class="stat__value expense">${formatMoney(sum.expense)}</span></div>
      </div>
      <p class="muted" style="margin-top:8px;font-size:.8125rem">${formatDate(range.from)} – ${formatDate(range.to)} · bilance
        <span class="num ${sum.net >= 0 ? 'income' : 'expense'}">${formatMoney(sum.net, { sign: true })}</span></p>

      <section class="section">
        <h2>Výdaje podle kategorií</h2>
        ${
          slices.length
            ? `<div class="card stack">
                <div class="chart-box chart-box--donut"><canvas data-donut aria-label="Graf výdajů podle kategorií" role="img"></canvas></div>
                <div class="legend">
                  ${slices
                    .map(
                      (s) => `
                    <div class="legend__row">
                      <span class="dot" style="--dot:${esc(s.cat?.color ?? '#8A8A8A')}"></span>
                      <span class="legend__name">${esc(s.cat?.icon ?? '📦')} ${esc(s.cat?.name ?? 'Bez kategorie')}</span>
                      <span class="num">${formatMoney(s.value)}</span>
                      <span class="legend__pct num">${Math.round((s.value / sum.expense) * 100)} %</span>
                    </div>`,
                    )
                    .join('')}
                </div>
              </div>`
            : `<div class="empty">${icon('chart-pie', { size: 24 })}<p>V tomto období nejsou žádné výdaje.</p></div>`
        }
      </section>

      ${
        state.space
          ? `<section class="section">
              <h2>Výdaje podle členů</h2>
              ${
                memberRows.length
                  ? `<div class="card stack">
                      ${memberRows
                        .map(
                          ([name, value]) => `
                        <div class="member-share">
                          <div class="member-share__top">
                            <span>${esc(name)}</span>
                            <span class="num"><strong>${formatMoney(value)}</strong> <span class="muted">${Math.round((value / sum.expense) * 100)} %</span></span>
                          </div>
                          <div class="progress"><div class="progress__bar" style="width:${(value / memberRows[0][1]) * 100}%"></div></div>
                        </div>`,
                        )
                        .join('')}
                    </div>`
                  : `<div class="empty"><p>V tomto období nejsou žádné výdaje.</p></div>`
              }
            </section>`
          : ''
      }

      <section class="section">
        <h2>Příjmy a výdaje po měsících</h2>
        <div class="card">
          <div class="chart-box"><canvas data-bars aria-label="Sloupcový graf příjmů a výdajů" role="img"></canvas></div>
        </div>
      </section>`

    const donut = el.querySelector('[data-donut]')
    if (donut) {
      charts.push(
        donutChart(donut, {
          labels: slices.map((s) => s.cat?.name ?? 'Bez kategorie'),
          values: slices.map((s) => Math.round(s.value * 100) / 100),
          colors: slices.map((s) => s.cat?.color ?? '#8A8A8A'),
        }),
      )
    }
    charts.push(
      barChart(el.querySelector('[data-bars]'), {
        labels: months.map(formatMonthShort),
        income: months.map((m) => Math.round(monthly.get(m).income * 100) / 100),
        expense: months.map((m) => Math.round(monthly.get(m).expense * 100) / 100),
      }),
    )
  }

  const onClick = (e) => {
    const pill = e.target.closest('[data-period]')
    if (!pill) return
    filter.period = pill.dataset.period
    draw()
  }
  const onChange = (e) => {
    const { name, value } = e.target
    if (name === 'category') filter.categoryId = value
    else if (name === 'from' || name === 'to') filter[name] = value
    else return
    draw()
  }

  draw()
  const unsub = subscribe(draw)
  window.addEventListener('themechange', draw)
  el.addEventListener('click', onClick)
  el.addEventListener('change', onChange)
  return () => {
    unsub()
    destroyCharts()
    window.removeEventListener('themechange', draw)
    el.removeEventListener('click', onClick)
    el.removeEventListener('change', onChange)
  }
}

const TABS = { overview: ['Přehled', overviewTab], subscriptions: ['Předplatná', subscriptionsTab] }

export default function statsView(el) {
  const requested = new URLSearchParams(location.search).get('tab')
  let tab = TABS[requested] ? requested : 'overview'
  let cleanup = null

  el.innerHTML = `
    <header class="page-header"><h1>Statistiky</h1></header>
    <div class="segmented stats-tabs" role="group" aria-label="Sekce statistik">
      ${Object.entries(TABS).map(([key, [label]]) => `<button type="button" data-tab="${key}" aria-pressed="${key === tab}">${label}</button>`).join('')}
    </div>
    <div data-tab-body></div>`
  const body = el.querySelector('[data-tab-body]')

  const mount = () => {
    cleanup?.()
    body.innerHTML = ''
    cleanup = TABS[tab][1](body) ?? null
  }

  const onClick = (e) => {
    const button = e.target.closest('[data-tab]')
    if (!button || button.dataset.tab === tab) return
    tab = button.dataset.tab
    el.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)))
    // záložka je v adrese, aby přežila obnovení stránky a šel na ni odkaz z Přehledu
    history.replaceState(null, '', tab === 'overview' ? '/stats' : `/stats?tab=${tab}`)
    mount()
  }

  el.addEventListener('click', onClick)
  mount()
  return () => {
    cleanup?.()
    el.removeEventListener('click', onClick)
  }
}
