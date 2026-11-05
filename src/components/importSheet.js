// Import transakcí z výpisu banky:
// soubor + banka (+ dialekt ABO) + účet → [mapování sloupců u jiné banky] → náhled → hromadné vložení.
// Soubor se zpracuje jen v prohlížeči, na server jdou až hotové transakce.
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { getState } from '../state/store.js'
import { categoriesByType } from '../state/selectors.js'
import { canEdit } from '../state/space.js'
import { createRow, updateRow, importTransactions } from '../services/api.js'
import { findTemplate, saveTemplate } from '../services/importTemplates.js'
import { ACCEPT, BANKS, UNIVERSAL_ID, bankById, readStatement, parseStatement, statementText, balanceCheck } from '../importers/index.js'
import { analyze, FIELDS, mappingError } from '../importers/universal.js'
import { importHashes, duplicateFlags } from '../importers/utils.js'
import { rowType, suggestCategory, sameRule, ruleTextFor } from '../importers/categorize.js'
import { openingOffer, projectBalance } from '../importers/openingBalance.js'
import { esc, setLoading } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { formatDate } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

const LAST_KEY = 'kp-import'

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
  warn: ['', ''],
  error: ['', 'import-badge--danger'],
}
// stavy, které jde importovat (warn = např. nezaúčtovaná platba Revolutu, předem nezaškrtnutá)
const SELECTABLE = ['new', 'fx', 'warn']
const selectable = (it) => SELECTABLE.includes(it.status)

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
  const hashes = importHashes(bank.id, parsed)
  // duplicita = jen shoda s transakcí, která už v účtu je
  const duplicates = duplicateFlags(bank.id, parsed, hashes, transactions.filter((t) => t.account_id === accountId && t.import_hash))
  return parsed.map((row, i) => {
    const hash = hashes[i]
    const type = rowType(row)
    let status = 'new'
    if (row.error) status = 'error'
    else if (duplicates[i]) status = 'dup'
    else if (row.warning) status = 'warn'
    else if (row.currency !== 'CZK') status = 'fx'
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

function badgeText(item) {
  const { row, status } = item
  if (status === 'error') return `${row.error} – přeskočí se`
  if (status === 'warn') return `${row.warning}${row.currency !== 'CZK' ? ` · ${row.currency}` : ''}`
  return STATUS[status][0]
}

function itemHtml(item, i) {
  const { row, status } = item
  const off = !selectable(item)
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
          <span class="badge import-badge ${STATUS[status][1]}">${status === 'fx' || status === 'warn' ? icon('triangle-alert', { size: 12 }) : ''}${esc(badgeText(item))}</span>
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

/** Kontrola zůstatků výpisu (KB, ABO): starý zůstatek + pohyby = nový zůstatek. */
function balanceHtml(check, bank) {
  if (!check) return ''
  const range = `${formatMoney(check.opening)} → ${formatMoney(check.closing)}`
  if (check.ok) return `<div class="import-check is-ok">${icon('check', { size: 16 })}<span>Zůstatky sedí: ${esc(range)}</span></div>`
  return `
    <div class="import-check">${icon('triangle-alert', { size: 16 })}
      <span>Součet pohybů nesedí se zůstatky výpisu (${esc(range)}, rozdíl ${esc(formatMoney(check.diff))}).
      ${bank.variants ? 'Zkuste v prvním kroku jinou banku (dialekt formátu ABO).' : 'Zkontrolujte, že soubor obsahuje celý výpis.'}</span>
    </div>`
}

/** Nabídka počátečního zůstatku podle výpisu (zaškrtává se ručně, mění to zůstatek účtu). */
function offerHtml(offer) {
  if (!offer) return ''
  return `
    <div class="opening-offer">
      <label class="opening-offer__check">
        <input type="checkbox" data-offer-check>
        <span>${offer.mode === 'overwrite' ? 'Přepsat počáteční zůstatek podle výpisu' : 'Nastavit počáteční zůstatek podle výpisu'}</span>
      </label>
      <div data-offer-details></div>
    </div>`
}

function offerDetails(offer, account, result) {
  const row = (label, value, cls = '') => `<div class="opening-offer__row"><dt>${esc(label)}</dt><dd class="num ${cls}">${value}</dd></div>`
  const money = (n) => esc(formatMoney(n))
  return `
    <dl>
      ${offer.mode === 'overwrite' ? row('Současný', `${money(account.opening_balance)} od ${esc(formatDate(account.opening_balance_date))}`) : ''}
      ${row(offer.mode === 'overwrite' ? 'Nový počáteční' : 'Počáteční zůstatek', `${money(offer.amount)} od ${esc(formatDate(offer.date))}`)}
      ${row('Výsledný zůstatek účtu', `<strong>${money(result.balance)}</strong>`)}
      ${offer.closing === null ? '' : row('Konečný zůstatek ve výpisu', money(offer.closing))}
      ${result.later ? row('Pohyby po konci výpisu', esc(formatMoney(result.later, { sign: true }))) : ''}
    </dl>
    ${
      result.matches === null
        ? ''
        : result.matches
          ? `<p class="import-check is-ok">${icon('check', { size: 16 })}<span>Sedí s konečným zůstatkem výpisu.</span></p>`
          : `<p class="import-check">${icon('triangle-alert', { size: 16 })}<span>Nesedí s konečným zůstatkem výpisu, rozdíl ${esc(formatMoney(result.diff, { sign: true }))}. Zkontrolujte odškrtnuté řádky a pohyby zadané ručně.</span></p>`
    }
    ${result.hidden ? `<p class="field__hint">Starší pohyby na tomto účtu (${result.hidden}) se do zůstatku přestanou počítat, ve statistikách zůstanou.</p>` : ''}`
}

const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`)

export function openImportSheet() {
  const state = getState()
  if (!canEdit(state)) return showToast('V této skupině máte jen právo čtení.')
  if (!state.accounts.length) return showToast('Nejdřív si v Nastavení vytvořte účet.')

  const last = readLast()
  const pick = {
    file: null, // { name, buffer }
    bankId: null,
    variant: null,
    detectedVariant: null,
    accountId: state.accounts.find((a) => a.id === last.accountId)?.id ?? state.accounts[0].id,
  }
  // univerzální import: rozbor souboru a aktuální mapování
  let mapState = null // { info, config, name, template }
  let items = []
  let meta = {}
  let check = null
  let offer = null
  let offerAccepted = false

  openSheet({
    title: 'Import z banky',
    body: '<div data-import></div>',
    onMount(body, close) {
      const slot = body.querySelector('[data-import]')
      const bank = () => bankById(pick.bankId)

      // ------------------------------------------------ 1. soubor, banka, účet
      const drawPick = (error = '', notice = '') => {
        const accounts = getState().accounts
        const b = bank()
        slot.innerHTML = `
          <form class="form" novalidate data-pick>
            <div class="field">
              <span class="field__label">Výpis z banky</span>
              <label class="btn btn--block import-file">
                ${icon('file-up', { size: 18 })}<span>${pick.file ? esc(pick.file.name) : 'Vybrat soubor'}</span>
                <input type="file" accept="${ACCEPT}" data-file class="sr-only">
              </label>
              <span class="field__hint">CSV, nebo ABO/GPC (.gpc, .abo, .txt). Soubor zůstává ve vašem zařízení – zpracuje se jen v prohlížeči.</span>
            </div>
            <p class="import-tip">${icon('landmark', { size: 16 })}<span>Většina českých bank umí export ve formátu ABO/GPC – hledejte v internetovém bankovnictví u exportu pohybů / výpisů.</span></p>
            <label class="field">
              <span class="field__label">Banka / formát</span>
              <select class="select" name="bank">
                ${pick.bankId ? '' : '<option value="" selected disabled>Vyberte banku</option>'}
                ${BANKS.map((x) => `<option value="${x.id}" ${x.id === pick.bankId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
              </select>
            </label>
            ${
              b?.variants
                ? `<label class="field">
                    <span class="field__label">${esc(b.variantLabel ?? 'Varianta')}</span>
                    <select class="select" name="variant">
                      ${b.variants.map((v) => `<option value="${v.id}" ${v.id === pick.variant ? 'selected' : ''}>${esc(v.label)}${v.id === pick.detectedVariant ? ' (rozpoznáno)' : ''}</option>`).join('')}
                    </select>
                    <span class="field__hint">Banky se liší v kódech storen a v poli měny. Nesedí-li v náhledu zůstatky, zkuste jinou.</span>
                  </label>`
                : ''
            }
            <label class="field">
              <span class="field__label">Importovat do účtu</span>
              <select class="select" name="account">
                ${accounts.map((a) => `<option value="${a.id}" ${a.id === pick.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              </select>
            </label>
            ${notice ? `<p class="import-notice">${icon('triangle-alert', { size: 16 })}<span>${esc(notice)}</span></p>` : ''}
            <div class="form-error" role="alert">${esc(error)}</div>
            <div class="sheet__actions">
              <button type="submit" class="btn btn--primary" ${pick.file ? '' : 'disabled'}>${b?.needsMapping ? 'Přiřadit sloupce' : 'Zobrazit náhled'}</button>
            </div>
          </form>`
      }

      const onFile = async (input) => {
        const file = input.files?.[0]
        if (!file) return
        mapState = null
        try {
          const { buffer, bank: detected, variant } = await readStatement(file)
          pick.file = { name: file.name, buffer }
          // předvýběr podle detect(); nepozná-li soubor žádná banka, nabídne se vlastní mapování
          pick.bankId = detected?.id ?? UNIVERSAL_ID
          pick.variant = variant ?? detected?.variants?.[0]?.id ?? null
          pick.detectedVariant = variant
          drawPick('', detected ? '' : 'Formát výpisu se nepodařilo rozpoznat. Přiřaďte sloupce ručně, nebo vyberte banku.')
        } catch (err) {
          pick.file = null
          drawPick(translateError(err))
        }
      }

      // ------------------------------------------------ 1b. mapování sloupců (jiná banka)
      const currentConfig = () => {
        const form = slot.querySelector('[data-map]')
        const mode = form.querySelector('[data-amount-mode] [aria-pressed="true"]')?.dataset.mode ?? 'single'
        const mapping = {}
        for (const f of FIELDS) {
          const value = Number(form.elements[`map-${f.key}`]?.value ?? -1)
          const hiddenByMode = (mode === 'single' && (f.key === 'income' || f.key === 'expense')) || (mode === 'split' && f.key === 'amount')
          mapping[f.key] = hiddenByMode ? -1 : value
        }
        return {
          delimiter: mapState.info.delimiter,
          mapping,
          dateFormat: form.elements.dateFormat.value,
          decimal: form.elements.decimal.value,
        }
      }

      const updateMapCheck = () => {
        const form = slot.querySelector('[data-map]')
        const out = form.querySelector('[data-map-check]')
        const config = currentConfig()
        const problem = mappingError(config.mapping)
        if (problem) {
          out.innerHTML = `<p class="muted">${esc(problem)}</p>`
          return
        }
        try {
          const rows = bank().parse(statementText(pick.file.buffer, bank()), { config })
          const bad = rows.filter((r) => r.error).length
          out.innerHTML = `
            <ul class="map-check">
              ${rows
                .slice(0, 3)
                .map(
                  (r) => `<li class="${r.error ? 'expense' : ''}"><span>${r.date ? esc(formatDate(r.date)) : '—'}</span><span class="map-check__desc">${esc(r.error ?? r.description)}</span><span class="num">${r.error ? '' : amountText(r)}</span></li>`,
                )
                .join('')}
            </ul>
            <p class="muted">${rows.length} ${rows.length === 1 ? 'řádek' : rows.length <= 4 ? 'řádky' : 'řádků'}${bad ? ` · <span class="expense">${bad} s chybou – zkontrolujte formát data a čísla</span>` : ''}</p>`
        } catch (err) {
          out.innerHTML = `<p class="expense">${esc(translateError(err))}</p>`
        }
      }

      const drawMapping = (error = '') => {
        if (!mapState) {
          try {
            const info = analyze(statementText(pick.file.buffer, bank()))
            const template = findTemplate(info.key)
            mapState = {
              info,
              template,
              config: template ? { ...info.config, ...template.config, delimiter: info.delimiter } : info.config,
              name: template?.name ?? pick.file.name.replace(/\.[^.]+$/, '').slice(0, 40),
            }
          } catch (err) {
            return drawPick(translateError(err))
          }
        }
        const { info, config, template } = mapState
        const m = config.mapping
        const mode = m.amount >= 0 || (m.income < 0 && m.expense < 0) ? 'single' : 'split'
        const options = (selected) =>
          `<option value="-1">— nepoužít —</option>${info.header
            .map((h, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${colLetter(i)} · ${esc(h || `Sloupec ${i + 1}`)}</option>`)
            .join('')}`
        const field = (f) => `
          <label class="field" data-map-field="${f.key}" ${(mode === 'single' && (f.key === 'income' || f.key === 'expense')) || (mode === 'split' && f.key === 'amount') ? 'hidden' : ''}>
            <span class="field__label">${esc(f.label)}${f.required || f.key === 'amount' ? '' : ' <span class="muted">(nepovinné)</span>'}</span>
            <select class="select select--sm" name="map-${f.key}">${options(m[f.key])}</select>
          </label>`
        slot.innerHTML = `
          <form class="form" novalidate data-map>
            ${
              template
                ? `<p class="import-notice is-ok">${icon('check', { size: 16 })}<span>Použita uložená šablona „${esc(template.name)}“. Můžete ji upravit.</span></p>`
                : `<p class="muted map-intro">Přiřaďte sloupce z výpisu. Návrh vychází z názvů sloupců.</p>`
            }
            <div class="map-sample" role="region" aria-label="Ukázka prvních řádků souboru" tabindex="0">
              <table>
                <thead><tr>${info.header.map((h, i) => `<th scope="col"><span class="muted">${colLetter(i)}</span> ${esc(h)}</th>`).join('')}</tr></thead>
                <tbody>${info.samples.map((r) => `<tr>${info.header.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
              </table>
            </div>
            <p class="field__hint">Oddělovač „${info.delimiter === '\t' ? 'tabulátor' : esc(info.delimiter)}“ · hlavička na ${info.headerIndex + 1}. řádku · ${info.rowCount} ${info.rowCount === 1 ? 'řádek' : info.rowCount <= 4 ? 'řádky' : 'řádků'} dat</p>

            ${field(FIELDS[0])}
            <div class="segmented" role="group" aria-label="Částka" data-amount-mode>
              <button type="button" data-mode="single" aria-pressed="${mode === 'single'}">Jedna částka (±)</button>
              <button type="button" data-mode="split" aria-pressed="${mode === 'split'}">Příjem a výdaj</button>
            </div>
            ${FIELDS.slice(1).map(field).join('')}

            <div class="grid-2">
              <label class="field">
                <span class="field__label">Formát data</span>
                <select class="select select--sm" name="dateFormat">
                  <option value="dmy" ${config.dateFormat === 'dmy' ? 'selected' : ''}>DD.MM.RRRR</option>
                  <option value="ymd" ${config.dateFormat === 'ymd' ? 'selected' : ''}>RRRR-MM-DD</option>
                </select>
              </label>
              <label class="field">
                <span class="field__label">Desetinná místa</span>
                <select class="select select--sm" name="decimal">
                  <option value="," ${config.decimal === ',' ? 'selected' : ''}>čárka 1 234,50</option>
                  <option value="." ${config.decimal === '.' ? 'selected' : ''}>tečka 1,234.50</option>
                </select>
              </label>
            </div>

            <label class="field">
              <span class="field__label">Název šablony</span>
              <input class="input" name="templateName" maxlength="40" value="${esc(mapState.name)}" autocomplete="off">
              <span class="field__hint">Mapování se uloží v tomto prohlížeči a příště se stejný export namapuje sám.</span>
            </label>

            <div class="field">
              <span class="field__label">Kontrola</span>
              <div data-map-check></div>
            </div>
            <div class="form-error" role="alert">${esc(error)}</div>
            <div class="import-actions">
              <button type="button" class="btn" data-back="pick">${icon('chevron-left', { size: 18 })}Zpět</button>
              <button type="submit" class="btn btn--primary">Pokračovat na náhled</button>
            </div>
          </form>`
        updateMapCheck()
      }

      const submitMapping = () => {
        const form = slot.querySelector('[data-map]')
        const config = currentConfig()
        const problem = mappingError(config.mapping)
        if (problem) {
          form.querySelector('.form-error').textContent = problem
          return
        }
        mapState.config = config
        mapState.name = form.elements.templateName.value.trim() || mapState.name
        saveTemplate({ key: mapState.info.key, name: mapState.name, header: mapState.info.header, config })
        mapState.template = findTemplate(mapState.info.key)
        showPreview()
      }

      // ------------------------------------------------ 2. náhled
      const selectedCount = () => items.filter((it) => it.checked && selectable(it)).length

      const updateSubmit = () => {
        const n = selectedCount()
        const btn = slot.querySelector('[data-run]')
        if (!btn) return
        // už naimportovaný výpis: jde nastavit jen počáteční zůstatek
        const openingOnly = n === 0 && offerAccepted
        btn.disabled = n === 0 && !openingOnly
        btn.querySelector('[data-run-label]').textContent = n ? `Importovat ${n} ${txWord(n)}` : openingOnly ? 'Nastavit zůstatek' : 'Nic k importu'
        updateOffer()
      }

      // výsledný zůstatek se přepočítá podle zaškrtnutých řádků
      const updateOffer = () => {
        const out = slot.querySelector('[data-offer-details]')
        if (!out || !offer) return
        const { transactions, transfers, accounts } = getState()
        const result = projectBalance({
          accountId: pick.accountId,
          offer,
          transactions,
          transfers,
          importing: items.filter((it) => it.checked && selectable(it)).map((it) => ({ date: it.row.date, amount: it.row.amount })),
        })
        out.innerHTML = offerDetails(offer, accounts.find((a) => a.id === pick.accountId), result)
      }

      const updateAllLabel = () => {
        const label = slot.querySelector('[data-all-label]')
        if (!label) return
        label.textContent = items.filter(selectable).every((it) => it.checked) ? 'Odznačit vše' : 'Vybrat vše'
      }

      const drawPreview = () => {
        const dups = items.filter((it) => it.status === 'dup').length
        const errors = items.filter((it) => it.status === 'error').length
        const pending = items.filter((it) => it.status === 'warn').length
        const account = getState().accounts.find((a) => a.id === pick.accountId)
        const period = meta.from && meta.to ? `${formatDate(meta.from)} – ${formatDate(meta.to)}` : ''
        const b = bank()
        const title = b.needsMapping ? (mapState?.name ?? b.name) : b.variants ? `ABO/GPC · ${b.variants.find((v) => v.id === pick.variant)?.label.split(' – ')[0] ?? ''}` : b.name
        slot.innerHTML = `
          <div class="import-summary">
            <div><strong>${esc(title ?? '')}</strong>${period ? ` · ${esc(period)}` : ''}</div>
            <div class="muted">${items.length} ${items.length === 1 ? 'položka' : items.length <= 4 ? 'položky' : 'položek'} → ${esc(account?.name ?? '')}${dups ? ` · ${dups} ${dups === 1 ? 'duplicita' : dups <= 4 ? 'duplicity' : 'duplicit'}` : ''}${pending ? ` · ${pending} nezaúčtováno` : ''}${errors ? ` · ${errors} s chybou` : ''}</div>
            ${balanceHtml(check, b)}
          </div>
          ${offerHtml(offer)}
          ${
            items.filter(selectable).length > 1
              ? `<button type="button" class="btn btn--ghost btn--sm import-all" data-all>${icon('check-check', { size: 16 })}<span data-all-label></span></button>`
              : ''
          }
          <ul class="card card--flush import-list">${items.map(itemHtml).join('')}</ul>
          <div class="import-actions">
            <button type="button" class="btn" data-back="${b.needsMapping ? 'map' : 'pick'}">${icon('chevron-left', { size: 18 })}Zpět</button>
            <button type="button" class="btn btn--primary" data-run><span class="spinner"></span><span data-run-label></span></button>
          </div>`
        updateAllLabel()
        updateSubmit()
      }

      const showPreview = () => {
        try {
          const b = bank()
          const parsed = parseStatement(pick.file.buffer, b, { variant: pick.variant, config: mapState?.config })
          meta = parsed.meta
          check = balanceCheck(parsed.rows, meta)
          items = buildItems(b, parsed.rows, pick.accountId)
          offer = openingOffer(getState().accounts.find((a) => a.id === pick.accountId), meta, parsed.rows)
          offerAccepted = false
          writeLast({ accountId: pick.accountId })
          drawPreview()
          body.scrollTop = 0
        } catch (err) {
          if (bank()?.needsMapping && mapState) drawMapping(translateError(err))
          else drawPick(translateError(err))
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
          if (item.edited || !selectable(item)) return
          const next = suggestCategory(item.row, rules, categories)
          if (next === item.category_id) return
          item.category_id = next
          const select = rowEl(i)?.querySelector('[data-cat]')
          if (select) select.value = next ?? ''
        })
      }

      // ------------------------------------------------ 3. import
      const runImport = async (button) => {
        const chosen = items.filter((it) => it.checked && selectable(it))
        const setOpening = offerAccepted && offer
        if (!chosen.length && !setOpening) return
        const localDups = items.filter((it) => it.status === 'dup').length
        setLoading(button, true)
        let message = ''
        try {
          if (chosen.length) {
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
            message = `Importováno ${inserted}${dups ? `, ${dupText(dups)}` : ''}`
          }
        } catch (err) {
          setLoading(button, false)
          showToast(translateError(err), { duration: 6000 })
          return
        }
        if (setOpening) {
          try {
            await updateRow('accounts', pick.accountId, { opening_balance: offer.amount, opening_balance_date: offer.date })
            message = `${message ? `${message}. ` : ''}Počáteční zůstatek nastaven.`
          } catch (err) {
            // transakce už jsou uložené; bez nich zůstává náhled otevřený a jde to zkusit znovu
            if (!chosen.length) {
              setLoading(button, false)
              showToast(translateError(err), { duration: 6000 })
              return
            }
            message = `${message}. Počáteční zůstatek se nepodařilo uložit: ${translateError(err)}`
          }
        }
        showToast(message, { duration: 6000 })
        close()
      }

      // ------------------------------------------------ události
      slot.addEventListener('change', (e) => {
        const t = e.target
        if (t.matches('[data-file]')) return onFile(t)
        if (t.name === 'bank') {
          pick.bankId = t.value
          pick.variant = pick.bankId === 'gpc' && pick.detectedVariant ? pick.detectedVariant : (bank()?.variants?.[0]?.id ?? null)
          return drawPick()
        }
        if (t.name === 'variant') pick.variant = t.value
        if (t.name === 'account') pick.accountId = t.value
        if (t.matches('[data-offer-check]')) {
          offerAccepted = t.checked
          return updateSubmit()
        }
        if (t.closest('[data-map]')) return updateMapCheck()
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
        if (e.target.matches('[data-map]')) return submitMapping()
        if (!pick.file) return drawPick('Vyberte soubor s výpisem.')
        if (!pick.bankId) return drawPick('Vyberte banku.')
        if (bank().needsMapping) return drawMapping()
        mapState = null
        showPreview()
      })

      slot.addEventListener('click', (e) => {
        const back = e.target.closest('[data-back]')
        if (back) return back.dataset.back === 'map' ? drawMapping() : drawPick()
        const modeBtn = e.target.closest('[data-amount-mode] [data-mode]')
        if (modeBtn) {
          const mode = modeBtn.dataset.mode
          slot.querySelectorAll('[data-amount-mode] [data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === modeBtn)))
          slot.querySelector('[data-map-field="amount"]').hidden = mode !== 'single'
          slot.querySelector('[data-map-field="income"]').hidden = mode !== 'split'
          slot.querySelector('[data-map-field="expense"]').hidden = mode !== 'split'
          return updateMapCheck()
        }
        const run = e.target.closest('[data-run]')
        if (run) return runImport(run)
        if (e.target.closest('[data-all]')) {
          const value = !items.filter(selectable).every((it) => it.checked)
          items.filter(selectable).forEach((it) => (it.checked = value))
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
