import { getState, subscribe } from '../../state/store.js'
import { categoriesByType, categoryMap } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow, processRecurring } from '../../services/api.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { showToast } from '../../components/toast.js'
import { subHeader, addButton } from './common.js'
import { canEdit, canManage } from '../../state/space.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { formatMoney, parseAmount, amountToInput } from '../../utils/format.js'
import { formatDate, today } from '../../utils/dates.js'
import { translateError } from '../../utils/errors.js'
import { validateAmount } from '../../utils/validation.js'

const INTERVALS = { weekly: 'Týdně', monthly: 'Měsíčně' }

function categoryOptions(type, selected) {
  return categoriesByType(type)
    .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
    .join('')
}

function openRecurringForm(rec = null) {
  const state = getState()
  if (!state.accounts.length) return showToast('Nejdřív si vytvořte účet.')
  let type = rec?.type ?? 'expense'
  let interval = rec?.interval ?? 'monthly'

  openSheet({
    title: rec ? 'Upravit opakovanou platbu' : 'Nová opakovaná platba',
    body: `
      <form class="form" novalidate>
        <div class="segmented" role="group" aria-label="Typ">
          <button type="button" data-type="expense" aria-pressed="${type === 'expense'}">Výdaj</button>
          <button type="button" data-type="income" aria-pressed="${type === 'income'}">Příjem</button>
        </div>
        <label class="field">
          <span class="field__label">Částka (Kč)</span>
          <input class="input num" name="amount" inputmode="decimal" value="${esc(amountToInput(rec?.amount))}" autofocus>
          <span class="field__error" data-error-for="amount"></span>
        </label>
        <label class="field">
          <span class="field__label">Popis</span>
          <input class="input" name="note" maxlength="200" placeholder="Např. Nájem, Netflix, Výplata" value="${esc(rec?.note ?? '')}">
        </label>
        <div class="grid-2">
          <label class="field">
            <span class="field__label">Kategorie</span>
            <select class="select" name="category">${categoryOptions(type, rec?.category_id)}</select>
          </label>
          <label class="field">
            <span class="field__label">Účet</span>
            <select class="select" name="account">
              ${state.accounts.map((a) => `<option value="${a.id}" ${a.id === rec?.account_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="field">
          <span class="field__label">Opakování</span>
          <div class="segmented" role="group" aria-label="Opakování">
            ${Object.entries(INTERVALS).map(([k, v]) => `<button type="button" data-interval="${k}" aria-pressed="${k === interval}">${v}</button>`).join('')}
          </div>
        </div>
        <label class="field">
          <span class="field__label">${rec ? 'Další platba' : 'První platba'}</span>
          <input class="input" type="date" name="next" value="${esc(rec?.next_date ?? today())}">
        </label>
        ${
          rec
            ? `<label class="menu-row" style="padding:0;border:0"><span>Aktivní</span>
                <input type="checkbox" name="active" ${rec.active ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--accent)"></label>`
            : ''
        }
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${rec && canManage() ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-type]')
        if (t) {
          type = t.dataset.type
          body.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)))
          form.elements.category.innerHTML = categoryOptions(type)
          return
        }
        const i = e.target.closest('[data-interval]')
        if (i) {
          interval = i.dataset.interval
          body.querySelectorAll('[data-interval]').forEach((b) => b.setAttribute('aria-pressed', String(b === i)))
          return
        }
        if (e.target.closest('[data-delete]')) {
          const ok = await confirmDialog({
            title: 'Smazat opakovanou platbu?',
            message: 'Už vytvořené transakce zůstanou zachované.',
            confirmLabel: 'Smazat',
            danger: true,
          })
          if (!ok) return
          try {
            await deleteRow('recurring', rec.id)
            showToast('Opakovaná platba smazána')
            close()
          } catch (err) {
            form.querySelector('.form-error').textContent = translateError(err)
          }
        }
      })

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const raw = form.elements.amount.value.trim()
        const amount = parseAmount(raw)
        const error = validateAmount(raw === '' ? '' : amount)
        if (error) return setFieldError(form, 'amount', error)
        const next_date = form.elements.next.value || today()
        const row = {
          type,
          amount,
          note: form.elements.note.value.trim(),
          category_id: form.elements.category.value || null,
          account_id: form.elements.account.value,
          interval,
          next_date,
          anchor_day: Number(next_date.slice(8, 10)),
          active: rec ? form.elements.active.checked : true,
        }
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (rec) await updateRow('recurring', rec.id, row)
          else await createRow('recurring', row)
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
          return
        }
        try {
          const created = row.active && next_date <= today() ? await processRecurring() : 0
          showToast(created ? `Uloženo · vytvořeno transakcí: ${created}` : 'Opakovaná platba uložena')
        } catch (err) {
          showToast(translateError(err))
        }
      })
    },
  })
}

export default function recurringView(el) {
  const draw = () => {
    const state = getState()
    const cats = categoryMap(state)
    const list = [...state.recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.next_date.localeCompare(b.next_date))
    el.innerHTML = `
      ${subHeader('Opakované platby', addButton('Nová'))}
      <p class="muted" style="margin:-12px 0 20px;font-size:.875rem">Splatné platby se automaticky zapíšou při otevření aplikace.</p>
      ${
        list.length
          ? `<div class="card card--flush list">
              ${list
                .map((r) => {
                  const cat = cats.get(r.category_id)
                  return `
                  <button type="button" class="list-row" data-recurring="${r.id}" style="${r.active ? '' : 'opacity:.55'}">
                    <div class="list-row__icon" style="--row-color:${esc(cat?.color ?? '#8A8A8A')}">${esc(cat?.icon ?? '🔁')}</div>
                    <div class="list-row__body">
                      <div class="list-row__title">${esc(r.note || cat?.name || 'Opakovaná platba')}</div>
                      <div class="list-row__sub">${INTERVALS[r.interval]} · ${r.active ? `příště ${formatDate(r.next_date)}` : 'pozastaveno'}</div>
                    </div>
                    <div class="list-row__end ${r.type === 'income' ? 'income' : ''}">${formatMoney(r.type === 'income' ? r.amount : -r.amount, { sign: true })}</div>
                  </button>`
                })
                .join('')}
            </div>`
          : `<div class="empty">${icon('repeat', { size: 24 })}<p>Přidejte pravidelné platby jako nájem, předplatné nebo výplatu.</p></div>`
      }`
  }

  const onClick = (e) => {
    if (!canEdit()) return
    if (e.target.closest('[data-add]')) return openRecurringForm()
    const row = e.target.closest('[data-recurring]')
    if (row) openRecurringForm(getState().recurring.find((r) => r.id === row.dataset.recurring))
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
