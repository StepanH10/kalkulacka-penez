// Statistiky → Předplatná: souhrn, upozornění, aktivní, návrhy detektoru, zrušená.
// Pozorovatel ve skupině vidí, ale nemění (bez tlačítek a bez návrhů).
import { getState, subscribe } from '../state/store.js'
import { categoryMap } from '../state/selectors.js'
import { canEdit } from '../state/space.js'
import { subscriptionData, markSuggestionHintSeen } from '../state/subscriptions.js'
import { createRow, deleteRow } from '../services/api.js'
import { openSubscriptionDetail, openSubscriptionForm, priceUpdateButton, updateSubscriptionPrice } from '../components/subscriptionSheets.js'
import { showToast } from '../components/toast.js'
import { INTERVALS, paymentsLabel, subscriptionPeriodLabel } from '../utils/subscriptions.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { formatDate } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

function subscriptionRow({ subscription: sub, total, next }, cats) {
  const cat = cats.get(sub.category_id)
  const timing = next ? `Příští platba ${formatDate(next.date)}` : ''
  return `
    <button type="button" class="list-row sub-row" data-subscription="${sub.id}">
      <div class="list-row__icon" style="--row-color:${esc(cat?.color ?? '#8A8A8A')}">${esc(cat?.icon ?? '🔁')}</div>
      <div class="list-row__body">
        <div class="list-row__title">${esc(sub.name)}</div>
        <div class="list-row__sub">${esc(subscriptionPeriodLabel(sub))} · zaplaceno ${formatMoney(total)}</div>
        ${timing ? `<div class="list-row__sub">${esc(timing)}</div>` : ''}
      </div>
      <div class="list-row__end">
        ${formatMoney(sub.amount)}
        <div class="sub-row__interval">${INTERVALS[sub.interval].label}</div>
      </div>
    </button>`
}

function alertRow(alert, editable) {
  const open = (tag, classes) => `<${tag} type="button" class="${classes} ${alert.danger ? 'alert--danger' : ''}" data-subscription="${alert.id}">
    ${icon('triangle-alert', { size: 18 })}<span>${esc(alert.text)}</span>
  </${tag}>`
  if (alert.type !== 'price' || !editable) return open('button', 'alert alert--button')
  return `
    <div class="alert alert--action">
      ${open('button', 'alert__open')}
      ${priceUpdateButton(alert.id, alert.latestAmount)}
    </div>`
}

function suggestionCard(item, editable) {
  const month = `${item.firstDate.slice(5, 7)}/${item.firstDate.slice(0, 4)}`
  return `
    <div class="card sub-suggestion">
      <div>
        <div class="sub-suggestion__name">${esc(item.name)}</div>
        <div class="muted sub-suggestion__meta">${formatMoney(item.amount)} ${INTERVALS[item.interval].label} · od ${month} · ${esc(paymentsLabel(item.count))}</div>
      </div>
      ${
        editable
          ? `<div class="sub-suggestion__actions">
              <button type="button" class="btn btn--sm" data-suggestion-ignore="${esc(item.matchText)}">Není předplatné</button>
              <button type="button" class="btn btn--sm btn--primary" data-suggestion-track="${esc(item.matchText)}">Sledovat</button>
            </div>`
          : ''
      }
    </div>`
}

const suggestionRow = (item, status) => ({
  name: item.name,
  match_text: item.matchText,
  amount: item.amount,
  interval: item.interval,
  started_on: item.firstDate,
  category_id: item.categoryId,
  status,
})

export default function subscriptionsTab(el) {
  let cancelledOpen = false
  let busy = false

  const draw = () => {
    const state = getState()
    const data = subscriptionData(state)
    const editable = canEdit(state)
    const cats = categoryMap(state)
    const suggestions = editable ? data.suggestions : []
    if (suggestions.length) markSuggestionHintSeen(suggestions.length)

    el.innerHTML = `
      <section class="card sub-summary">
        Aktivní předplatná: <strong class="num">${data.active.length}</strong>
        · měsíčně <strong class="num">${formatMoney(data.costs.monthly)}</strong>
        · ročně <strong class="num">${formatMoney(data.costs.yearly)}</strong>
      </section>

      ${
        data.alerts.length
          ? `<section class="section stack">
              ${data.alerts.map((a) => alertRow(a, editable)).join('')}
            </section>`
          : ''
      }

      <section class="section">
        <div class="section__head">
          <h2>Aktivní</h2>
          ${editable ? `<button type="button" class="btn btn--sm btn--primary" data-add-subscription>${icon('plus', { size: 16 })}Přidat</button>` : ''}
        </div>
        ${
          data.active.length
            ? `<div class="card card--flush list">${data.active.map((a) => subscriptionRow(a, cats)).join('')}</div>`
            : `<div class="empty">${icon('repeat', { size: 24 })}<p>${editable ? 'Zatím nesledujete žádné předplatné. Přidejte ho ručně, nebo potvrďte nalezené z importovaných plateb.' : 'Skupina zatím nesleduje žádné předplatné.'}</p></div>`
        }
      </section>

      ${
        suggestions.length
          ? `<section class="section">
              <div class="section__head"><h2>Nalezená předplatná</h2></div>
              <div class="stack">${suggestions.map((s) => suggestionCard(s, editable)).join('')}</div>
            </section>`
          : ''
      }

      ${
        data.cancelled.length
          ? `<section class="section">
              <details class="sub-cancelled" data-cancelled ${cancelledOpen ? 'open' : ''}>
                <summary>Zrušená (${data.cancelled.length})${icon('chevron-down', { size: 18 })}</summary>
                <div class="card card--flush list">${data.cancelled.map((a) => subscriptionRow(a, cats)).join('')}</div>
              </details>
            </section>`
          : ''
      }`
  }

  const decide = async (matchText, status) => {
    if (busy) return
    const item = subscriptionData().suggestions.find((s) => s.matchText === matchText)
    if (!item) return
    busy = true
    try {
      const row = await createRow('subscriptions', suggestionRow(item, status))
      if (status === 'active') showToast(`${item.name} se teď sleduje`)
      else {
        showToast('Návrh už se nebude nabízet', {
          actionLabel: 'Zpět',
          onAction: () => deleteRow('subscriptions', row.id).catch((err) => showToast(translateError(err))),
        })
      }
    } catch (err) {
      showToast(translateError(err))
    } finally {
      busy = false
    }
  }

  const onClick = (e) => {
    const update = e.target.closest('[data-update-price]')
    if (update) return updateSubscriptionPrice(update)
    const open = e.target.closest('[data-subscription]')
    if (open) {
      const data = subscriptionData()
      const analysis = [...data.active, ...data.cancelled].find((a) => a.subscription.id === open.dataset.subscription)
      if (analysis) openSubscriptionDetail(analysis)
      return
    }
    if (!canEdit()) return
    if (e.target.closest('[data-add-subscription]')) return openSubscriptionForm()
    const track = e.target.closest('[data-suggestion-track]')
    if (track) return decide(track.dataset.suggestionTrack, 'active')
    const ignore = e.target.closest('[data-suggestion-ignore]')
    if (ignore) decide(ignore.dataset.suggestionIgnore, 'ignored')
  }

  // událost toggle nebublá, proto zachycení
  const onToggle = (e) => {
    if (e.target.matches?.('[data-cancelled]')) cancelledOpen = e.target.open
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  el.addEventListener('toggle', onToggle, true)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
    el.removeEventListener('toggle', onToggle, true)
  }
}
