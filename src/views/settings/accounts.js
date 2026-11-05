import { getState, subscribe } from '../../state/store.js'
import { accountBalances, movementsBefore } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow } from '../../services/api.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { openTransactionSheet } from '../../components/transactionSheet.js'
import { showToast } from '../../components/toast.js'
import { subHeader, addButton } from './common.js'
import { canEdit, canManage } from '../../state/space.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { formatMoney, parseAmount, amountToInput } from '../../utils/format.js'
import { formatDate, today } from '../../utils/dates.js'
import { translateError } from '../../utils/errors.js'
import { validateName } from '../../utils/validation.js'

export const ACCOUNT_TYPES = {
  cash: 'Hotovost',
  bank: 'Bankovní účet',
  card: 'Platební karta',
  savings: 'Spořicí účet',
  other: 'Jiný',
}

const MAX_OPENING = 1e12 // numeric(14, 2)

/** Počáteční zůstatek z formuláře: { value } nebo { field, error }. Obě pole prázdná = bez zůstatku. */
function readOpening(form) {
  const raw = form.elements.openingBalance.value.trim().replace('−', '-')
  const date = form.elements.openingDate.value
  if (!raw && !date) return { value: { opening_balance: null, opening_balance_date: null } }
  if (!raw) return { field: 'openingBalance', error: 'Zadejte počáteční zůstatek, nebo smažte datum.' }
  const amount = parseAmount(raw)
  if (Number.isNaN(amount) || Math.abs(amount) >= MAX_OPENING) return { field: 'openingBalance', error: 'Zadejte platnou částku, např. 12 500,50 (může být záporná).' }
  if (!date) return { field: 'openingDate', error: 'Zadejte datum, od kterého zůstatek platí.' }
  return { value: { opening_balance: amount, opening_balance_date: date } }
}

function openAccountForm(account = null) {
  openSheet({
    title: account ? 'Upravit účet' : 'Nový účet',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Název</span>
          <input class="input" name="name" maxlength="60" placeholder="Např. Běžný účet" value="${esc(account?.name ?? '')}" autofocus>
          <span class="field__error" data-error-for="name"></span>
        </label>
        <label class="field">
          <span class="field__label">Typ</span>
          <select class="select" name="type">
            ${Object.entries(ACCOUNT_TYPES)
              .map(([k, v]) => `<option value="${k}" ${k === (account?.type ?? 'bank') ? 'selected' : ''}>${v}</option>`)
              .join('')}
          </select>
        </label>
        <div class="grid-2">
          <label class="field">
            <span class="field__label">Počáteční zůstatek (Kč)</span>
            <input class="input num" name="openingBalance" inputmode="text" autocomplete="off" placeholder="Nepovinné" value="${esc(amountToInput(account?.opening_balance))}">
          </label>
          <label class="field">
            <span class="field__label">Platí od</span>
            <input class="input" type="date" name="openingDate" value="${esc(account?.opening_balance_date ?? '')}">
          </label>
        </div>
        <div class="field__error" data-error-for="openingBalance"></div>
        <div class="field__error" data-error-for="openingDate"></div>
        <p class="muted" style="font-size:.8125rem" data-opening-hint></p>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${account && canManage() ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      const hint = () => {
        const date = form.elements.openingDate.value
        const older = account ? movementsBefore(account.id, date) : 0
        body.querySelector('[data-opening-hint]').textContent =
          `Zůstatek účtu = počáteční zůstatek + pohyby od tohoto data. Do statistik se nepočítá.${
            older ? ` Starší pohyby na tomto účtu (${older}) se do zůstatku přestanou počítat, ve statistikách zůstanou.` : ''
          }`
      }
      hint()
      form.elements.openingDate.addEventListener('input', () => {
        setFieldError(form, 'openingDate', '')
        hint()
      })
      form.elements.openingBalance.addEventListener('input', () => {
        setFieldError(form, 'openingBalance', '')
        // s první číslicí předvyplní dnešek, aby šel zůstatek uložit na jedno ťuknutí
        if (form.elements.openingBalance.value.trim() && !form.elements.openingDate.value) {
          form.elements.openingDate.value = today()
          hint()
        }
      })
      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        if (getState().accounts.length <= 1) {
          form.querySelector('.form-error').textContent = 'Musíte mít alespoň jeden účet.'
          return
        }
        const ok = await confirmDialog({
          title: `Smazat účet „${account.name}“?`,
          message: 'Smažou se i všechny transakce, převody a opakované platby tohoto účtu. Tuto akci nelze vrátit.',
          confirmLabel: 'Smazat účet',
          danger: true,
        })
        if (!ok) return
        try {
          await deleteRow('accounts', account.id)
          showToast('Účet smazán')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
        }
      })
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        const error = validateName(name, 'název účtu')
        if (error) return setFieldError(form, 'name', error)
        const opening = readOpening(form)
        if (opening.error) return setFieldError(form, opening.field, opening.error)
        const row = { name, type: form.elements.type.value, ...opening.value }
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (account) await updateRow('accounts', account.id, row)
          else await createRow('accounts', row)
          showToast(account ? 'Účet upraven' : 'Účet vytvořen')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

export default function accountsView(el) {
  const draw = () => {
    const state = getState()
    const balances = accountBalances(state)
    el.innerHTML = `
      ${subHeader('Účty', addButton('Nový účet'))}
      <div class="card card--flush list">
        ${state.accounts
          .map(
            (a) => `
          <button type="button" class="list-row" data-account="${a.id}">
            <div class="list-row__icon">${icon('wallet', { size: 18 })}</div>
            <div class="list-row__body">
              <div class="list-row__title">${esc(a.name)}</div>
              <div class="list-row__sub" style="white-space:normal">${ACCOUNT_TYPES[a.type] ?? ''}${a.opening_balance_date ? ` · od ${esc(formatDate(a.opening_balance_date))}` : ''}</div>
            </div>
            <div class="list-row__end ${balances.get(a.id) < 0 ? 'expense' : ''}">${formatMoney(balances.get(a.id))}</div>
          </button>`,
          )
          .join('')}
      </div>
      ${canEdit(state) ? `<section class="section">
        <button type="button" class="btn btn--block" data-transfer ${state.accounts.length < 2 ? 'disabled' : ''}>
          ${icon('arrow-left-right', { size: 18 })}Převod mezi účty
        </button>
        ${state.accounts.length < 2 ? '<p class="muted" style="margin-top:8px;font-size:.8125rem;text-align:center">Pro převody přidejte další účet.</p>' : ''}
      </section>` : ''}`
  }

  const onClick = (e) => {
    if (!canEdit()) return
    if (e.target.closest('[data-add]')) return openAccountForm()
    if (e.target.closest('[data-transfer]')) return openTransactionSheet({ mode: 'transfer' })
    const row = e.target.closest('[data-account]')
    if (row) openAccountForm(getState().accounts.find((a) => a.id === row.dataset.account))
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
