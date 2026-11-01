import { getState, subscribe } from '../../state/store.js'
import { budgetStatus, categoriesByType } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow } from '../../services/api.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { showToast } from '../../components/toast.js'
import { subHeader, addButton } from './common.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { formatMoney, formatPercent, parseAmount, amountToInput } from '../../utils/format.js'
import { formatMonth, today } from '../../utils/dates.js'
import { translateError } from '../../utils/errors.js'
import { validateAmount } from '../../utils/validation.js'

function openBudgetForm(budget = null) {
  const used = new Set(getState().budgets.map((b) => b.category_id))
  const options = categoriesByType('expense').filter((c) => c.id === budget?.category_id || !used.has(c.id))
  if (!options.length) {
    showToast('Všechny výdajové kategorie už mají rozpočet.')
    return
  }
  openSheet({
    title: budget ? 'Upravit rozpočet' : 'Nový rozpočet',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Kategorie</span>
          <select class="select" name="category" ${budget ? 'disabled' : ''}>
            ${options.map((c) => `<option value="${c.id}" ${c.id === budget?.category_id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span class="field__label">Měsíční limit (Kč)</span>
          <input class="input num" name="limit" inputmode="decimal" value="${esc(amountToInput(budget?.monthly_limit))}" autofocus>
          <span class="field__error" data-error-for="limit"></span>
        </label>
        <p class="muted" style="font-size:.8125rem">Upozorníme vás při využití 80 % a 100 % limitu.</p>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${budget ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: 'Smazat rozpočet?', message: 'Transakce zůstanou beze změny.', confirmLabel: 'Smazat', danger: true })
        if (!ok) return
        try {
          await deleteRow('budgets', budget.id)
          showToast('Rozpočet smazán')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
        }
      })
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const raw = form.elements.limit.value.trim()
        const limit = parseAmount(raw)
        const error = validateAmount(raw === '' ? '' : limit)
        if (error) return setFieldError(form, 'limit', error)
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (budget) await updateRow('budgets', budget.id, { monthly_limit: limit })
          else await createRow('budgets', { category_id: form.elements.category.value, monthly_limit: limit })
          showToast(budget ? 'Rozpočet upraven' : 'Rozpočet vytvořen')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

export default function budgetsView(el) {
  const draw = () => {
    const status = budgetStatus(getState())
    el.innerHTML = `
      ${subHeader('Rozpočty', addButton('Nový'))}
      <p class="muted" style="margin:-12px 0 20px;text-transform:capitalize">${esc(formatMonth(today()))}</p>
      ${
        status.length
          ? `<div class="card card--flush">
              ${status
                .map((s) => {
                  const cls = s.ratio >= 1 ? 'is-over' : s.ratio >= 0.8 ? 'is-warning' : ''
                  return `
                  <button type="button" class="budget-row" data-budget="${s.budget.id}">
                    <div class="budget-row__top">
                      <span>${esc(s.category.icon)} ${esc(s.category.name)}</span>
                      <span class="num"><strong>${formatMoney(s.spent)}</strong> <span class="muted">/ ${formatMoney(s.limit)}</span></span>
                    </div>
                    <div class="progress"><div class="progress__bar ${cls}" style="width:${Math.min(100, s.ratio * 100)}%"></div></div>
                    <div class="goal__meta">
                      <span class="${s.ratio >= 1 ? 'expense' : ''}">${formatPercent(s.ratio)}</span>
                      <span>${s.ratio >= 1 ? `Překročeno o ${formatMoney(s.spent - s.limit)}` : `Zbývá ${formatMoney(s.limit - s.spent)}`}</span>
                    </div>
                  </button>`
                })
                .join('')}
            </div>`
          : `<div class="empty">${icon('target', { size: 24 })}<p>Nastavte si měsíční limit pro kategorie výdajů a hlídejte si útratu.</p></div>`
      }`
  }

  const onClick = (e) => {
    if (e.target.closest('[data-add]')) return openBudgetForm()
    const row = e.target.closest('[data-budget]')
    if (row) openBudgetForm(getState().budgets.find((b) => b.id === row.dataset.budget))
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
