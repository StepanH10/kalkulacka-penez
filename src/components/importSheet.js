// Import transakcí z CSV výpisu banky: soubor + banka + účet → náhled → hromadné vložení.
// Soubor se zpracuje jen v prohlížeči, na server jdou až hotové transakce.
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { getState } from '../state/store.js'
import { categoriesByType } from '../state/selectors.js'
import { canEdit } from '../state/space.js'
import { createRow, updateRow, importTransactions } from '../services/api.js'
import { BANKS, bankById, readStatement, parseStatement } from '../importers/index.js'
import { importHashes } from '../importers/utils.js'
import { rowType, suggestCategory, sameRule, ruleTextFor } from '../importers/categorize.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { formatDate } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

const LAST_KEY = 'kp-import'
const ACCEPT = '.csv,text/csv,text/comma-separated-values,application/vnd.ms-excel'

const readLast = () => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) ?? {}
  } catch {
    return {}
  }
}
const writeLast = (patch) => {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...readLast(), ...patch }))
  } catch {
    /* ignorovat */
  }
}

/** 1 transakci, 2 transakce, 5 transakcí */
const txWord = (n) => (n === 1 ? 'transakci' : n >= 2 && n <= 4 ? 'transakce' : 'transakcí')
const dupText = (n) => (n === 1 ? 'přeskočena 1 duplicita' : n >= 2 && n <= 4 ? `přeskočeny ${n} duplicity` : `přeskočeno ${n} duplicit`)

const STATUS = {
  new: ['Nová', 'import-badge--new'],
  dup: ['Duplicita – přeskočí se', 'import-badge--muted'],
  fx: ['Cizí měna – zkontrolujte', ''],
  error: ['', 'import-badge--danger'],
}

const foreign = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Částka se znaménkem; cizí měna bez „Kč“ (zatím bez přepočtu). */
function amountText(row) {
  if (row.currency === 'CZK') return formatMoney(row.amount, { sign: true })
  const sign = row.amount < 0 ? '−' : '+'
  return `${sign}${foreign.format(Math.abs(row.amount))} ${esc(row.currency)}`
}

function categoryOptions(type, selected) {
  return categoriesByType(type)
    .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
    .join('')
}

/** Řádky výpisu → položky náhledu se stavem, otiskem a navrženou kategorií. */
function buildItems(bank, parsed, accountId) {
  const { transactions, rules, categories } = getState()
  const existing = new Set(transactions.filter((t) => t.account_id === accountId && t.import_hash).map((t) => t.import_hash))
  const hashes = importHashes(bank.id, parsed)
  const inFile = new Set()
  return parsed.map((row, i) => {
    const hash = hashes[i]
    const type = rowType(row)
    let status = 'new'
    if (row.error) status = 'error'
    else if (existing.has(hash) || inFile.has(hash)) status = 'dup'
    else if (row.currency !== 'CZK') status = 'fx'
    inFile.add(hash)
    return {
      row,
      hash,
      type,
      status,
      checked: status === 'new' || status === 'fx',
      category_id: status === 'error' ? null : suggestCategory(row, rules, categories),
      edited: false,
    }
  })
}

function itemHtml(item, i) {
  const { row, status } = item
  const [label, cls] = STATUS[status]
  const off = status === 'dup' || status === 'error'
  const text = row.description || row.counterparty || 'Bez popisu'
  return `
    <li class="import-row ${off ? 'is-off' : ''}" data-i="${i}">
      <label class="import-row__check">
        <input type="checkbox" data-check ${item.checked ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="Importovat: ${esc(text)}">
      </label>
      <div class="import-row__body">
        <div class="import-row__top">
          <span class="import-row__desc">${esc(text)}</span>
          <span class="num ${item.type === 'income' ? 'income' : ''}">${amountText(row)}</span>
        </div>
        <div class="import-row__meta">
          ${row.date ? `<span>${esc(formatDate(row.date))}</span>` : ''}
          <span class="badge import-badge ${cls}">${status === 'fx' ? icon('triangle-alert', { size: 12 }) : ''}${esc(status === 'error' ? `${row.error} – přeskočí se` : label)}</span>
        </div>
        ${
          off
            ? ''
            : `<select class="select select--sm" data-cat aria-label="Kategorie">${categoryOptions(item.type, item.category_id)}</select>
               <div class="import-rule" data-rule hidden></div>`
        }
      </div>
    </li>`
}

export function openImportSheet() {
  const state = getState()
  if (!canEdit(state)) return showToast('V této skupině máte jen právo čtení.')
  if (!state.accounts.length) return showToast('Nejdřív si v Nastavení vytvořte účet.')

  const last = readLast()
  const pick = {
    file: null, // { name, buffer }
    bankId: null,
    accountId: state.accounts.find((a) => a.id === last.accountId)?.id ?? state.accounts[0].id,
  }
  let items = []
  let meta = {}

  openSheet({
    title: 'Import z banky',
    body: '<div data-import></div>',
    onMount(body, close) {
      const slot = body.querySelector('[data-import]')

      // ------------------------------------------------ 1. soubor, banka, účet
      const drawPick = (error = '') => {
        const accounts = getState().accounts
        slot.innerHTML = `
          <form class="form" novalidate data-pick>
            <div class="field">
              <span class="field__label">Výpis z banky (CSV)</span>
              <label class="btn btn--block import-file">
                ${icon('file-up', { size: 18 })}<span>${pick.file ? esc(pick.file.name) : 'Vybrat soubor'}</span>
                <input type="file" accept="${ACCEPT}" data-file class="sr-only">
              </label>
              <span class="field__hint">Soubor zůstává ve vašem zařízení – zpracuje se jen v prohlížeči.</span>
            </div>
            <label class="field">
              <span class="field__label">Banka</span>
              <select class="select" name="bank">
                ${pick.bankId ? '' : '<option value="" selected disabled>Vyberte banku</option>'}
                ${BANKS.map((b) => `<option value="${b.id}" ${b.id === pick.bankId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span class="field__label">Importovat do účtu</span>
              <select class="select" name="account">
                ${accounts.map((a) => `<option value="${a.id}" ${a.id === pick.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>
            </label>
            <div class="form-error" role="alert">${esc(error)}</div>
            <div class="sheet__actions">
              <button type="submit" class="btn btn--primary" ${pick.file ? '' : 'disabled'}>Zobrazit náhled</button>
            </div>
          </form>`
      }

      const onFile = async (input) => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const { buffer, bank } = await readStatement(file)
          pick.file = { name: file.name, buffer }
          // předvýběr podle detect(); uživatel může banku změnit
          pick.bankId = bank?.id ?? pick.bankId
          drawPick(bank ? '' : 'Formát výpisu se nepodařilo rozpoznat. Vyberte banku ručně.')
        } catch (err) {
          pick.file = null
          drawPick(translateError(err))
        }
      }

      // ------------------------------------------------ 2. náhled
      const selectedCount = () => items.filter((it) => it.checked && (it.status === 'new' || it.status === 'fx')).length

      const updateSubmit = () => {
        const n = selectedCount()
        const btn = slot.querySelector('[data-run]')
        if (!btn) return
        btn.disabled = n === 0
        btn.querySelector('[data-run-label]').textContent = n ? `Importovat ${n} ${txWord(n)}` : 'Nic k importu'
      }

      const drawPreview = () => {
        const dups = items.filter((it) => it.status === 'dup').length
        const errors = items.filter((it) => it.status === 'error').length
        const account = getState().accounts.find((a) => a.id === pick.accountId)
        const period = meta.from && meta.to ? `${formatDate(meta.from)} – ${formatDate(meta.to)}` : ''
        const selectable = items.filter((it) => it.status === 'new' || it.status === 'fx')
        slot.innerHTML = `
          <div class="import-summary">
            <div><strong>${esc(bankById(pick.bankId)?.name ?? '')}</strong>${period ? ` · ${esc(period)}` : ''}</div>
            <div class="muted">${items.length} ${items.length === 1 ? 'položka' : items.length <= 4 ? 'položky' : 'položek'} → ${esc(account?.name ?? '')}${dups ? ` · ${dups} ${dups === 1 ? 'duplicita' : dups <= 4 ? 'duplicity' : 'duplicit'}` : ''}${errors ? ` · ${errors} s chybou` : ''}</div>
          </div>
          ${
            selectable.length > 1
              ? `<button type="button" class="btn btn--ghost btn--sm import-all" data-all>${icon('check-check', { size: 16 })}<span data-all-label></span></button>`
              : ''
          }
          <ul class="card card--flush import-list">${items.map(itemHtml).join('')}</ul>
          <div class="import-actions">
            <button type="button" class="btn" data-back>${icon('chevron-left', { size: 18 })}Zpět</button>
            <button type="button" class="btn btn--primary" data-run><span class="spinner"></span><span data-run-label></span></button>
          </div>`
        updateAllLabel()
        updateSubmit()
      }

      const updateAllLabel = () => {
        const label = slot.querySelector('[data-all-label]')
        if (!label) return
        const selectable = items.filter((it) => it.status === 'new' || it.status === 'fx')
        label.textContent = selectable.every((it) => it.checked) ? 'Odznačit vše' : 'Vybrat vše'
      }

      const showPreview = () => {
        try {
          const bank = bankById(pick.bankId)
          const parsed = parseStatement(pick.file.buffer, bank)
          meta = parsed.meta
          items = buildItems(bank, parsed.rows, pick.accountId)
          writeLast({ accountId: pick.accountId })
          drawPreview()
          body.scrollTop = 0
        } catch (err) {
          drawPick(translateError(err))
        }
      }

      // ------------------------------------------------ pravidla z náhledu
      const rowEl = (i) => slot.querySelector(`[data-i="${i}"]`)

      const askRule = (i) => {
        const item = items[i]
        const panel = rowEl(i).querySelector('[data-rule]')
        const category = getState().categories.find((c) => c.id === item.category_id)
        const text = ruleTextFor(item.row)
        if (!category || text.length < 2) return
        // jen jedna otevřená nabídka
        slot.querySelectorAll('[data-rule]').forEach((p) => {
          if (p !== panel) p.hidden = true
        })
        panel.innerHTML = `
          <div class="import-rule__q">Zapamatovat pravidlo pro „${esc(text)}“ → ${esc(category.icon)} ${esc(category.name)}?</div>
          <label class="field">
            <span class="field__label">Text, který musí popis obsahovat</span>
            <input class="input" name="ruleText" maxlength="60" value="${esc(text)}" autocomplete="off">
            <span class="field__error" data-rule-error></span>
          </label>
          <div class="inline-panel__actions">
            <button type="button" class="btn btn--sm" data-rule-no>Ne</button>
            <button type="button" class="btn btn--sm btn--primary" data-rule-yes><span class="spinner"></span>Zapamatovat</button>
          </div>`
        panel.hidden = false
      }

      const saveRule = async (i, button) => {
        const item = items[i]
        const panel = rowEl(i).querySelector('[data-rule]')
        const matchText = panel.querySelector('[name="ruleText"]').value.trim()
        const errorEl = panel.querySelector('[data-rule-error]')
        if (matchText.length < 2) {
          errorEl.textContent = 'Zadejte alespoň 2 znaky.'
          return
        }
        setLoading(button, true)
        try {
          const { rules, categories } = getState()
          const existing = sameRule(matchText, item.type, rules, categories)
          if (existing) await updateRow('rules', existing.id, { category_id: item.category_id })
          else await createRow('rules', { match_text: matchText, category_id: item.category_id })
          panel.hidden = true
          applyRules()
          showToast(`Pravidlo „${matchText}“ uloženo`)
        } catch (err) {
          setLoading(button, false)
          errorEl.textContent = translateError(err)
        }
      }

      // nové pravidlo se hned projeví u řádků, které uživatel neměnil
      const applyRules = () => {
        const { rules, categories } = getState()
        items.forEach((item, i) => {
          if (item.edited || item.status === 'dup' || item.status === 'error') return
          const next = suggestCategory(item.row, rules, categories)
          if (next === item.category_id) return
          item.category_id = next
          const select = rowEl(i)?.querySelector('[data-cat]')
          if (select) select.value = next ?? ''
        })
      }

      // ------------------------------------------------ 3. import
      const runImport = async (button) => {
        const chosen = items.filter((it) => it.checked && (it.status === 'new' || it.status === 'fx'))
        if (!chosen.length) return
        const localDups = items.filter((it) => it.status === 'dup').length
        setLoading(button, true)
        try {
          const { inserted, skipped } = await importTransactions(
            chosen.map((it) => ({
              account_id: pick.accountId,
              type: it.type,
              amount: Math.abs(it.row.amount),
              date: it.row.date,
              note: it.row.description,
              category_id: it.category_id,
              import_hash: it.hash,
            })),
          )
          const dups = localDups + skipped
          showToast(`Importováno ${inserted}${dups ? `, ${dupText(dups)}` : ''}`, { duration: 6000 })
          close()
        } catch (err) {
          setLoading(button, false)
          showToast(translateError(err), { duration: 6000 })
        }
      }

      // ------------------------------------------------ události
      slot.addEventListener('change', (e) => {
        const t = e.target
        if (t.matches('[data-file]')) return onFile(t)
        if (t.name === 'bank') pick.bankId = t.value
        if (t.name === 'account') pick.accountId = t.value
        const li = t.closest('[data-i]')
        if (!li) return
        const i = Number(li.dataset.i)
        if (t.matches('[data-check]')) {
          items[i].checked = t.checked
          updateAllLabel()
          updateSubmit()
        } else if (t.matches('[data-cat]')) {
          items[i].category_id = t.value
          items[i].edited = true
          askRule(i)
        }
      })

      slot.addEventListener('submit', (e) => {
        e.preventDefault()
        if (!pick.file) return drawPick('Vyberte soubor s výpisem.')
        if (!pick.bankId) return drawPick('Vyberte banku.')
        showPreview()
      })

      slot.addEventListener('click', (e) => {
        if (e.target.closest('[data-back]')) return drawPick()
        const run = e.target.closest('[data-run]')
        if (run) return runImport(run)
        if (e.target.closest('[data-all]')) {
          const selectable = items.filter((it) => it.status === 'new' || it.status === 'fx')
          const value = !selectable.every((it) => it.checked)
          selectable.forEach((it) => (it.checked = value))
          slot.querySelectorAll('[data-check]:not(:disabled)').forEach((c) => (c.checked = value))
          updateAllLabel()
          updateSubmit()
          return
        }
        const li = e.target.closest('[data-i]')
        if (!li) return
        const i = Number(li.dataset.i)
        if (e.target.closest('[data-rule-no]')) {
          li.querySelector('[data-rule]').hidden = true
          return
        }
        const yes = e.target.closest('[data-rule-yes]')
        if (yes) saveRule(i, yes)
      })

      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.name === 'ruleText') {
          e.preventDefault()
          const li = e.target.closest('[data-i]')
          saveRule(Number(li.dataset.i), li.querySelector('[data-rule-yes]'))
        }
      })

      drawPick()
    },
  })
}
