import { getState, subscribe } from '../../state/store.js'
import { accountBalances } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow } from '../../services/api.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { openTransactionSheet } from '../../components/transactionSheet.js'
import { showToast } from '../../components/toast.js'
import { subHeader, addButton } from './common.js'
import { canEdit, canManage } from '../../state/space.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { formatMoney } from '../../utils/format.js'
import { translateError } from '../../utils/errors.js'
import { validateName } from '../../utils/validation.js'

export const ACCOUNT_TYPES = {
  cash: 'Hotovost',
  bank: 'Bankovní účet',
  card: 'Platební karta',
  savings: 'Spořicí účet',
  other: 'Jiný',
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
        ${account ? '' : '<p class="muted" style="font-size:.8125rem">Počáteční zůstatek zadejte jako příjem na tento účet.</p>'}
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${account && canManage() ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
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
        const row = { name, type: form.elements.type.value }
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
              <div class="list-row__sub">${ACCOUNT_TYPES[a.type] ?? ''}</div>
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
