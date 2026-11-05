import { getState, subscribe } from '../state/store.js'
import { accountBalances, totalBalance, transactionsInRange, totals, budgetStatus, feedItems } from '../state/selectors.js'
import { renderFeed, bindFeed } from '../components/feed.js'
import { renderInviteBanner, bindInviteBanner } from '../components/inviteBanner.js'
import { renderInsightsCard, bindInsightsCard } from '../components/insightsCard.js'
import { buildInsights } from '../utils/insights.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney, formatPercent } from '../utils/format.js'
import { monthRange, formatMonth } from '../utils/dates.js'

function budgetAlerts(state) {
  return budgetStatus(state)
    .filter((b) => b.ratio >= 0.8)
    .map(
      (b) => `
      <a class="alert ${b.ratio >= 1 ? 'alert--danger' : ''}" href="/settings/budgets" data-link>
        ${icon('triangle-alert', { size: 18 })}
        <span><strong>${esc(b.category.icon)} ${esc(b.category.name)}</strong> –
        ${b.ratio >= 1 ? 'rozpočet překročen' : `využito ${formatPercent(b.ratio)} rozpočtu`}
        (${formatMoney(b.spent)} z ${formatMoney(b.limit)})</span>
      </a>`,
    )
    .join('')
}

export default function overviewView(el) {
  let monthInsights = { enoughHistory: true, insights: [] }

  const draw = () => {
    const state = getState()
    const { from, to } = monthRange(0)
    const month = totals(transactionsInRange(from, to))
    const balances = accountBalances(state)
    const name = state.profile?.username ?? ''
    const alerts = budgetAlerts(state)
    monthInsights = buildInsights({ transactions: state.transactions, categories: state.categories, group: Boolean(state.space) })

    el.innerHTML = `
      <header class="page-header">
        <div>
          ${name ? `<p class="muted">Ahoj, ${esc(name)}</p>` : ''}
          <h1>Přehled</h1>
        </div>
        <span class="muted" style="text-transform:capitalize">${esc(formatMonth(from))}</span>
      </header>

      ${renderInviteBanner(state)}

      <section class="card overview-hero">
        <div class="stat">
          <span class="stat__label">${icon('wallet', { size: 16 })}Celkový zůstatek</span>
          <span class="balance ${totalBalance(state) < 0 ? 'expense' : ''}">${formatMoney(totalBalance(state))}</span>
        </div>
        <div class="overview-hero__stats">
          <div class="stat">
            <span class="stat__label">${icon('arrow-down-left', { size: 16 })}Příjmy</span>
            <span class="stat__value income">${formatMoney(month.income)}</span>
          </div>
          <div class="stat">
            <span class="stat__label">${icon('arrow-up-right', { size: 16 })}Výdaje</span>
            <span class="stat__value expense">${formatMoney(month.expense)}</span>
          </div>
        </div>
      </section>

      ${
        state.accounts.length > 1
          ? `<section class="section">
              <div class="accounts-strip">
                ${state.accounts
                  .map(
                    (a) => `<a class="account-chip" href="/settings/accounts" data-link>${esc(a.name)}<strong>${formatMoney(balances.get(a.id))}</strong></a>`,
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }

      ${alerts ? `<section class="section stack">${alerts}</section>` : ''}

      ${renderInsightsCard(monthInsights)}

      <section class="section">
        <div class="section__head">
          <h2>Poslední transakce</h2>
          <a class="btn btn--ghost btn--sm" href="/transactions" data-link>Vše ${icon('chevron-right', { size: 16 })}</a>
        </div>
        <div data-feed>${renderFeed(feedItems({ limit: 30 }, state))}</div>
      </section>`
  }

  draw()
  const unsub = subscribe(draw)
  const unbind = bindFeed(el)
  const unbindInvites = bindInviteBanner(el)
  const unbindInsights = bindInsightsCard(el, () => monthInsights.insights)
  return () => {
    unsub()
    unbind()
    unbindInvites()
    unbindInsights()
  }
}
