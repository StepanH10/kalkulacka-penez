// Karta „Tento měsíc“ na Přehledu. Klik na postřeh otevře Transakce s jeho filtrem.
import { setTransactionFilter } from '../state/transactionFilter.js'
import { navigate } from '../router.js'
import { emptyFilter } from '../utils/transactionFilter.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'

export function renderInsightsCard({ enoughHistory, insights }) {
  if (enoughHistory && !insights.length) return ''
  return `
    <section class="section">
      <div class="section__head"><h2>Tento měsíc</h2></div>
      <div class="card card--flush list">
        ${insights
          .map(
            (item, i) => `
            <button type="button" class="list-row insight" data-insight="${i}">
              <span class="insight__icon ${item.tone ?? ''}">${icon(item.icon, { size: 18 })}</span>
              <span class="insight__text">${esc(item.text)}</span>
              ${icon('chevron-right', { size: 18 })}
            </button>`,
          )
          .join('')}
        ${
          enoughHistory
            ? ''
            : `<p class="insight__note">Na srovnání s minulým měsícem je zatím málo dat. Objeví se, až bude historie pokrývat celý minulý měsíc.</p>`
        }
      </div>
    </section>`
}

/** getInsights vrací postřehy právě vykreslené karty. */
export function bindInsightsCard(root, getInsights) {
  const onClick = (e) => {
    const row = e.target.closest('[data-insight]')
    if (!row) return
    const insight = getInsights()[Number(row.dataset.insight)]
    if (!insight) return
    setTransactionFilter({ ...emptyFilter(), ...insight.filter })
    navigate('/transactions')
  }
  root.addEventListener('click', onClick)
  return () => root.removeEventListener('click', onClick)
}
