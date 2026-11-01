import { openSheet, confirmDialog } from './sheet.js'
import { showToast } from './toast.js'
import { getState } from '../state/store.js'
import { categoriesByType, spentInMonth, categoryMap } from '../state/selectors.js'
import { createRow, updateRow } from '../services/api.js'
import { deleteWithUndo } from './feed.js'
import { categoryFields, bindCategoryPickers, categoryNameError } from './categoryFields.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney, parseAmount, amountToInput, formatPercent } from '../utils/format.js'
import { today } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'
import { validateAmount } from '../utils/validation.js'

const LAST_KEY = 'kp-last'

function readLast() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) ?? {}
  } catch {
    return {}
  }
}

function writeLast(patch) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), ...patch }))
  } catch {
    /* ignorovat */
  }
}

const MODES = [
  ['expense', 'Výdaj'],
  ['income', 'Příjem'],
  ['transfer', 'Převod'],
]

function accountOptions(selected, excludeId) {
  return getState()
    .accounts.filter((a) => a.id !== excludeId)
    .map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`)
    .join('')
}

function categoryChips(type, selected) {
  return (
    categoriesByType(type)
      .map(
        (c) => `
      <button type="button" class="chip" data-category="${c.id}" style="--chip-color:${esc(c.color)}"
        aria-pressed="${c.id === selected}">
        <span class="chip__emoji">${esc(c.icon)}</span>${esc(c.name)}
      </button>`,
      )
      .join('') +
    `<button type="button" class="chip chip--add" data-add-category>
      <span class="chip__emoji">${icon('plus', { size: 20 })}</span>Vlastní
    </button>`
  )
}

const NEW_CATEGORY_TITLE = { expense: 'Nová kategorie výdajů', income: 'Nová kategorie příjmů' }

/** Po uložení výdaje upozorní na rozpočet nad 80 % / 100 %. */
function checkBudget(tx, previousSpent) {
  if (tx.type !== 'expense' || !tx.category_id) return
  const budget = getState().budgets.find((b) => b.category_id === tx.category_id)
  if (!budget) return
  const limit = Number(budget.monthly_limit)
  const spent = spentInMonth(tx.category_id, tx.date)
  const before = previousSpent / limit
  const ratio = spent / limit
  const name = categoryMap().get(tx.category_id)?.name ?? ''
  if (ratio >= 1 && before < 1) {
    showToast(`Rozpočet „${name}“ překročen: ${formatMoney(spent)} z ${formatMoney(limit)}`, { duration: 6000 })
  } else if (ratio >= 0.8 && before < 0.8) {
    showToast(`Rozpočet „${name}“ je využitý na ${formatPercent(ratio)}`, { duration: 6000 })
  }
}

/**
 * Formulář pro přidání nebo úpravu transakce / převodu.
 * item: existující transakce ({kind:'transaction'}) nebo převod ({kind:'transfer'}).
 */
export function openTransactionSheet({ item = null, mode: initialMode } = {}) {
  const state = getState()
  const last = readLast()
  const isEdit = Boolean(item)

  let mode = item ? (item.kind === 'transfer' ? 'transfer' : item.type) : (initialMode ?? 'expense')
  const firstAccount = state.accounts.find((a) => a.id === last.accountId)?.id ?? state.accounts[0]?.id
  const selected = {
    expense: item?.type === 'expense' ? item.category_id : last.expense,
    income: item?.type === 'income' ? item.category_id : last.income,
  }
  for (const type of ['expense', 'income']) {
    const cats = categoriesByType(type)
    if (!cats.some((c) => c.id === selected[type])) selected[type] = cats[0]?.id ?? null
  }

  const accountId = item?.kind === 'transfer' ? item.from_account_id : (item?.account_id ?? firstAccount)
  const toAccountId =
    item?.kind === 'transfer' ? item.to_account_id : state.accounts.find((a) => a.id !== accountId)?.id

  const availableModes = isEdit ? MODES.filter(([m]) => (mode === 'transfer' ? m === 'transfer' : m !== 'transfer')) : MODES
  const title = isEdit ? (mode === 'transfer' ? 'Upravit převod' : 'Upravit transakci') : 'Nová transakce'

  if (!state.accounts.length) {
    showToast('Nejdřív si v Nastavení vytvořte účet.')
    return
  }

  openSheet({
    title,
    body: `
      <form class="form" novalidate>
        ${
          availableModes.length > 1
            ? `<div class="segmented" role="group" aria-label="Typ">
                ${availableModes.map(([m, label]) => `<button type="button" data-mode="${m}" aria-pressed="${m === mode}">${label}</button>`).join('')}
              </div>`
            : ''
        }
        <div>
          <label class="amount-input">
            <span class="sr-only">Částka</span>
            <input name="amount" inputmode="decimal" placeholder="0" autocomplete="off" enterkeyhint="done"
              value="${esc(amountToInput(item?.amount))}" autofocus>
            <span>Kč</span>
          </label>
          <div class="field__error" data-error-for="amount" style="text-align:center"></div>
        </div>

        <div class="field" data-part="category">
          <span class="field__label">Kategorie</span>
          <div class="chips" data-chips></div>
          <div class="inline-panel" data-new-category hidden>
            <div class="inline-panel__title" data-new-category-title></div>
            ${categoryFields({ field: 'categoryName' })}
            <div class="inline-panel__actions">
              <button type="button" class="btn" data-category-cancel>Zrušit</button>
              <button type="button" class="btn btn--primary" data-category-save><span class="spinner"></span>Uložit</button>
            </div>
          </div>
        </div>

        <div class="grid-2">
          <label class="field">
            <span class="field__label" data-account-label>${mode === 'transfer' ? 'Z účtu' : 'Účet'}</span>
            <select class="select" name="account">${accountOptions(accountId)}</select>
          </label>
          <label class="field">
            <span class="field__label">Datum</span>
            <input class="input" type="date" name="date" value="${esc(item?.date ?? today())}" required>
          </label>
        </div>

        <label class="field" data-part="to-account">
          <span class="field__label">Na účet</span>
          <select class="select" name="toAccount">${accountOptions(toAccountId)}</select>
          <span class="field__error" data-error-for="toAccount"></span>
        </label>

        <label class="field">
          <span class="field__label">Poznámka</span>
          <input class="input" name="note" maxlength="200" placeholder="Nepovinné" value="${esc(item?.note ?? '')}">
        </label>

        <div class="form-error" role="alert"></div>

        <div class="sheet__actions">
          ${isEdit ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      const chips = body.querySelector('[data-chips]')
      const catPart = body.querySelector('[data-part="category"]')
      const toPart = body.querySelector('[data-part="to-account"]')
      const newPanel = body.querySelector('[data-new-category]')
      const pickers = bindCategoryPickers(newPanel)

      const renderMode = () => {
        body.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)))
        catPart.hidden = mode === 'transfer'
        toPart.hidden = mode !== 'transfer'
        body.querySelector('[data-account-label]').textContent = mode === 'transfer' ? 'Z účtu' : 'Účet'
        if (mode !== 'transfer') {
          chips.innerHTML = categoryChips(mode, selected[mode])
          body.querySelector('[data-new-category-title]').textContent = NEW_CATEGORY_TITLE[mode]
        }
      }
      renderMode()

      // Vlastní kategorie přímo ve formuláři – ostatní pole zůstávají vyplněná
      const toggleNewCategory = (open) => {
        newPanel.hidden = !open
        chips.hidden = open
        setFieldError(form, 'categoryName', '')
        if (open) {
          form.elements.categoryName.value = ''
          form.elements.categoryName.focus()
          newPanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        } else {
          chips.querySelector('[data-add-category]')?.focus({ preventScroll: true })
        }
      }

      const saveNewCategory = async () => {
        const type = mode
        const name = form.elements.categoryName.value.trim()
        const error = categoryNameError(name, type)
        if (error) {
          setFieldError(form, 'categoryName', error)
          form.elements.categoryName.focus()
          return
        }
        setFieldError(form, 'categoryName', '')
        const button = newPanel.querySelector('[data-category-save]')
        setLoading(button, true)
        try {
          const saved = await createRow('categories', { name, type, icon: pickers.icon, color: pickers.color })
          selected[type] = saved.id
          renderMode()
          toggleNewCategory(false)
        } catch (err) {
          showToast(translateError(err))
        } finally {
          setLoading(button, false)
        }
      }

      form.elements.categoryName.addEventListener('input', () => setFieldError(form, 'categoryName', ''))
      form.elements.categoryName.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        saveNewCategory()
      })

      body.addEventListener('click', async (e) => {
        const modeBtn = e.target.closest('[data-mode]')
        if (modeBtn) {
          mode = modeBtn.dataset.mode
          if (mode === 'transfer' && getState().accounts.length < 2) {
            setFieldError(form, 'toAccount', 'Pro převod potřebujete alespoň dva účty (Nastavení → Účty).')
          }
          renderMode()
          return
        }
        if (e.target.closest('[data-add-category]')) return toggleNewCategory(true)
        if (e.target.closest('[data-category-cancel]')) return toggleNewCategory(false)
        if (e.target.closest('[data-category-save]')) return saveNewCategory()
        const chip = e.target.closest('[data-category]')
        if (chip) {
          selected[mode] = chip.dataset.category
          chips.querySelectorAll('[data-category]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)))
          return
        }
        if (e.target.closest('[data-delete]')) {
          const ok = await confirmDialog({
            title: mode === 'transfer' ? 'Smazat převod?' : 'Smazat transakci?',
            message: 'Tuto akci můžete hned vrátit tlačítkem „Zpět“.',
            confirmLabel: 'Smazat',
            danger: true,
          })
          if (!ok) return
          close()
          deleteWithUndo(item)
        }
      })

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const amount = parseAmount(form.elements.amount.value)
        const amountError = validateAmount(form.elements.amount.value.trim() === '' ? '' : amount)
        if (amountError) {
          setFieldError(form, 'amount', amountError)
          form.elements.amount.focus()
          return
        }
        const date = form.elements.date.value || today()
        const note = form.elements.note.value.trim()
        const account_id = form.elements.account.value
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (mode === 'transfer') {
            const to_account_id = form.elements.toAccount.value
            if (!to_account_id || to_account_id === account_id) {
              setFieldError(form, 'toAccount', 'Vyberte jiný cílový účet.')
              return
            }
            const row = { from_account_id: account_id, to_account_id, amount, date, note }
            if (isEdit) await updateRow('transfers', item.id, row)
            else await createRow('transfers', row)
            showToast(isEdit ? 'Převod upraven' : 'Převod uložen')
          } else {
            const category_id = selected[mode]
            const previousSpent = category_id && mode === 'expense' ? spentInMonth(category_id, date) : 0
            const row = { type: mode, amount, date, note, account_id, category_id }
            const saved = isEdit ? await updateRow('transactions', item.id, row) : await createRow('transactions', row)
            writeLast({ accountId: account_id, [mode]: category_id })
            showToast(isEdit ? 'Transakce upravena' : mode === 'income' ? 'Příjem uložen' : 'Výdaj uložen')
            const countedBefore =
              isEdit && item.type === 'expense' && item.category_id === category_id && item.date.slice(0, 7) === date.slice(0, 7)
            const before = countedBefore ? previousSpent - Number(item.amount) : previousSpent
            checkBudget(saved, before)
          }
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
        } finally {
          setLoading(button, false)
        }
      })

      return pickers.destroy
    },
  })
}
