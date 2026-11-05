// Předplatná: formulář (ruční přidání, úprava) a detail s historií plateb.
import { getState } from '../state/store.js'
import { categoriesByType, categoryMap } from '../state/selectors.js'
import { canEdit } from '../state/space.js'
import { createRow, updateRow, deleteRow } from '../services/api.js'
import { normalizeText } from '../importers/utils.js'
import { INTERVALS, paymentsLabel, subscriptionPeriodLabel } from '../utils/subscriptions.js'
import { openSheet, confirmDialog } from './sheet.js'
import { showToast } from './toast.js'
import { priceChart } from './charts.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { amountToInput, formatMoney, parseAmount } from '../utils/format.js'
import { formatDate, today } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'
import { validateAmount } from '../utils/validation.js'

const capitalize = (text) => text[0].toUpperCase() + text.slice(1)

/** Formulář předplatného; bez `subscription` ruční přidání. */
export function openSubscriptionForm(subscription = null) {
  const interval = subscription?.interval ?? 'monthly'
  openSheet({
    title: subscription ? 'Upravit předplatné' : 'Nové předplatné',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Název</span>
          <input class="input" name="name" maxlength="80" placeholder="Např. Netflix, Nájem" autocomplete="off" value="${esc(subscription?.name ?? '')}" autofocus>
          <span class="field__error" data-error-for="name"></span>
        </label>
        <div class="grid-2">
          <label class="field">
            <span class="field__label">Částka (Kč)</span>
            <input class="input num" name="amount" inputmode="decimal" autocomplete="off" value="${esc(amountToInput(subscription?.amount))}">
            <span class="field__error" data-error-for="amount"></span>
          </label>
          <label class="field">
            <span class="field__label">Opakování</span>
            <select class="select" name="interval">
              ${Object.entries(INTERVALS).map(([key, { label }]) => `<option value="${key}" ${key === interval ? 'selected' : ''}>${capitalize(label)}</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="field">
          <span class="field__label">Kategorie</span>
          <select class="select" name="category">
            <option value="">Bez kategorie</option>
            ${categoriesByType('expense').map((c) => `<option value="${c.id}" ${c.id === subscription?.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Text pro párování s transakcemi</span>
          <input class="input" name="match" maxlength="60" placeholder="Vyplní se z názvu" autocomplete="off" value="${esc(subscription?.match_text ?? '')}">
          <span class="field__hint">Hledá se v popisu transakce. Nezáleží na velikosti písmen ani diakritice.</span>
          <span class="field__error" data-error-for="match"></span>
        </label>
        <label class="field">
          <span class="field__label">Od kdy</span>
          <input class="input" type="date" name="started" value="${esc(subscription?.started_on ?? today())}" max="9999-12-31">
          <span class="field__error" data-error-for="started"></span>
        </label>
        <label class="field">
          <span class="field__label">Poznámka</span>
          <input class="input" name="note" maxlength="500" autocomplete="off" value="${esc(subscription?.note ?? '')}">
        </label>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        if (!name) return setFieldError(form, 'name', 'Zadejte název.')
        const amount = parseAmount(form.elements.amount.value)
        const amountError = validateAmount(form.elements.amount.value.trim() === '' ? '' : amount)
        if (amountError) return setFieldError(form, 'amount', amountError)
        const match_text = normalizeText(form.elements.match.value || name).slice(0, 60).trim()
        if (match_text.length < 2) return setFieldError(form, 'match', 'Zadejte alespoň 2 znaky.')
        const started_on = form.elements.started.value
        if (!started_on) return setFieldError(form, 'started', 'Zadejte datum.')
        if (subscription?.ended_on && started_on > subscription.ended_on) {
          return setFieldError(form, 'started', 'Začátek nemůže být po datu zrušení.')
        }
        const clash = getState().subscriptions.find((s) => s.match_text === match_text && s.id !== subscription?.id)
        // zamítnutý návrh je v seznamech skrytý: přidání ho oživí, jinak by text nešel nikdy použít
        const revive = clash?.status === 'ignored' && !subscription
        if (clash && !revive) return setFieldError(form, 'match', `Text „${match_text}“ už používá předplatné ${clash.name}.`)
        const values = {
          name,
          amount,
          interval: form.elements.interval.value,
          category_id: form.elements.category.value || null,
          match_text,
          started_on,
          note: form.elements.note.value.trim(),
        }
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (subscription) await updateRow('subscriptions', subscription.id, values)
          else if (revive) await updateRow('subscriptions', clash.id, { ...values, status: 'active', ended_on: null })
          else await createRow('subscriptions', values)
          showToast(subscription ? 'Předplatné upraveno' : 'Předplatné přidáno')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

/** Tlačítko „Aktualizovat cenu“ u upozornění na zdražení; obsluhuje ho updateSubscriptionPrice. */
export const priceUpdateButton = (id, amount) =>
  `<button type="button" class="btn btn--sm" data-update-price="${esc(id)}" data-amount="${esc(amount)}">Aktualizovat cenu</button>`

/** Nastaví očekávanou částku na poslední spárovanou platbu. Vrací true, když se to povedlo. */
export async function updateSubscriptionPrice(button) {
  button.disabled = true
  const id = button.dataset.updatePrice
  const amount = Number(button.dataset.amount)
  try {
    const row = await updateRow('subscriptions', id, { amount })
    showToast(`Cena ${row.name} je teď ${formatMoney(amount)}`)
    return true
  } catch (err) {
    button.disabled = false
    showToast(translateError(err))
    return false
  }
}

const detailStat = (label, value) => `<div class="sub-detail__stat"><span class="muted">${esc(label)}</span><strong class="num">${esc(value)}</strong></div>`

/** Detail: analysis je položka z subscriptionData (active / cancelled). */
export function openSubscriptionDetail(analysis) {
  const { subscription: sub, payments, total, next, alerts } = analysis
  const category = categoryMap().get(sub.category_id)
  const editable = canEdit()
  const newestFirst = [...payments].reverse()
  let chart = null

  openSheet({
    title: sub.name,
    body: `
      <div class="sub-detail">
        ${alerts
          .map(
            (a) => `<div class="alert ${a.danger ? 'alert--danger' : ''} ${a.type === 'price' && editable ? 'alert--action' : ''}">
              <div class="alert__open">${icon('triangle-alert', { size: 18 })}<span>${esc(a.text)}</span></div>
              ${a.type === 'price' && editable ? priceUpdateButton(sub.id, a.latestAmount) : ''}
            </div>`,
          )
          .join('')}
        <div class="sub-detail__stats">
          ${detailStat('Částka', `${formatMoney(sub.amount)} ${INTERVALS[sub.interval].label}`)}
          ${detailStat('Celkem zaplaceno', formatMoney(total))}
          ${detailStat('Období', subscriptionPeriodLabel(sub))}
          ${next ? detailStat('Příští platba', formatDate(next.date)) : ''}
          ${detailStat('Kategorie', category ? `${category.icon} ${category.name}` : 'Bez kategorie')}
          ${detailStat('Páruje se podle', `„${sub.match_text}“`)}
        </div>
        ${sub.note ? `<p class="muted sub-detail__note">${esc(sub.note)}</p>` : ''}
        ${
          payments.length >= 2
            ? `<div>
                <h3 class="sub-detail__heading">Vývoj ceny</h3>
                <div class="chart-box sub-detail__chart"><canvas data-price aria-label="Graf vývoje ceny, jednotlivé platby jsou v historii níže" role="img"></canvas></div>
              </div>`
            : ''
        }
        <div>
          <h3 class="sub-detail__heading">Historie plateb (${esc(paymentsLabel(payments.length))})</h3>
          ${
            payments.length
              ? `<ul class="sub-history">
                  ${newestFirst.map((p) => `<li><span>${esc(formatDate(p.date))}</span><span class="sub-history__note">${esc(p.note)}</span><span class="num">${formatMoney(p.amount)}</span></li>`).join('')}
                </ul>`
              : `<p class="muted sub-detail__note">Zatím žádná spárovaná transakce. Zkontrolujte text pro párování a částku.</p>`
          }
        </div>
        <div class="form-error" role="alert"></div>
        ${
          editable
            ? `<div class="sub-detail__actions">
                <button type="button" class="btn" data-edit-sub>${icon('pencil', { size: 16 })}Upravit</button>
                ${
                  sub.status === 'active'
                    ? '<button type="button" class="btn" data-cancel-sub>Zrušit předplatné</button>'
                    : '<button type="button" class="btn" data-resume-sub>Znovu sledovat</button>'
                }
                <button type="button" class="btn btn--danger" data-delete-sub>${icon('trash', { size: 16 })}Smazat</button>
              </div>`
            : ''
        }
      </div>`,
    onMount(body, close) {
      const canvas = body.querySelector('[data-price]')
      if (canvas) {
        chart = priceChart(canvas, { labels: payments.map((p) => formatDate(p.date)), values: payments.map((p) => Number(p.amount)) })
      }
      const fail = (err) => {
        body.querySelector('.form-error').textContent = translateError(err)
      }

      const onClick = async (e) => {
        const update = e.target.closest('[data-update-price]')
        if (update) {
          if (await updateSubscriptionPrice(update)) close()
          return
        }
        if (e.target.closest('[data-edit-sub]')) {
          close()
          return openSubscriptionForm(sub)
        }
        if (e.target.closest('[data-cancel-sub]')) {
          const ok = await confirmDialog({
            title: 'Zrušit předplatné?',
            message: 'Přesune se mezi zrušená. Pokud se po dnešku objeví další platba, upozorníme vás.',
            confirmLabel: 'Zrušit předplatné',
            danger: true,
          })
          if (!ok) return
          try {
            // databáze nedovolí konec před začátkem (předplatné s budoucím začátkem)
            const ended_on = sub.started_on > today() ? sub.started_on : today()
            await updateRow('subscriptions', sub.id, { status: 'cancelled', ended_on })
            showToast('Předplatné zrušeno')
            close()
          } catch (err) {
            fail(err)
          }
          return
        }
        if (e.target.closest('[data-resume-sub]')) {
          try {
            await updateRow('subscriptions', sub.id, { status: 'active', ended_on: null })
            showToast('Předplatné se znovu sleduje')
            close()
          } catch (err) {
            fail(err)
          }
          return
        }
        if (e.target.closest('[data-delete-sub]')) {
          const ok = await confirmDialog({
            title: 'Smazat předplatné?',
            message: 'Transakce zůstanou beze změny. Detektor ho může později znovu navrhnout.',
            confirmLabel: 'Smazat',
            danger: true,
          })
          if (!ok) return
          try {
            await deleteRow('subscriptions', sub.id)
            showToast('Předplatné smazáno')
            close()
          } catch (err) {
            fail(err)
          }
        }
      }
      body.addEventListener('click', onClick)
      return () => {
        body.removeEventListener('click', onClick)
        chart?.destroy()
      }
    },
  })
}
