// Bottom sheet s filtry obrazovky Transakce + popisky aktivních filtrů (chipy).
import { getState } from '../state/store.js'
import { categoriesByType, categoryMap, accountMap } from '../state/selectors.js'
import { authorName } from '../state/space.js'
import { emptyFilter, NO_CATEGORY, PERIOD_LABELS } from '../utils/transactionFilter.js'
import { openSheet } from './sheet.js'
import { esc, setFieldError, clearErrors } from '../utils/dom.js'
import { amountToInput, formatMoney, parseAmount } from '../utils/format.js'
import { formatDate, today } from '../utils/dates.js'

const TYPE_LABELS = { expense: 'Výdaje', income: 'Příjmy' }
const ORIGIN_LABELS = { manual: 'Ručně zadané', import: 'Importované' }

function periodLabel(filter) {
  if (filter.period !== 'custom') return PERIOD_LABELS[filter.period]
  if (filter.from && filter.to) return `${formatDate(filter.from)} – ${formatDate(filter.to)}`
  return filter.from ? `Od ${formatDate(filter.from)}` : `Do ${formatDate(filter.to)}`
}

function amountLabel({ amountMin: min, amountMax: max }) {
  if (min !== null && max !== null) return min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`
  return min !== null ? `Od ${formatMoney(min)}` : `Do ${formatMoney(max)}`
}

/** Aktivní filtry (bez hledaného textu) jako [{ id, label }]; id je pro removeFilterChip. */
export function filterChips(filter, state = getState()) {
  const chips = []
  if (filter.period) chips.push({ id: 'period', label: periodLabel(filter) })
  if (filter.type) chips.push({ id: 'type', label: TYPE_LABELS[filter.type] })
  const cats = categoryMap(state)
  for (const id of filter.categories) {
    const cat = cats.get(id)
    chips.push({ id: `category:${id}`, label: cat ? `${cat.icon} ${cat.name}` : 'Bez kategorie' })
  }
  if (filter.accountId) chips.push({ id: 'account', label: accountMap(state).get(filter.accountId)?.name ?? 'Účet' })
  if (filter.amountMin !== null || filter.amountMax !== null) chips.push({ id: 'amount', label: amountLabel(filter) })
  if (filter.origin) chips.push({ id: 'origin', label: ORIGIN_LABELS[filter.origin] })
  if (filter.authorId) chips.push({ id: 'author', label: authorName(filter.authorId, state) })
  return chips
}

/** Filtr bez jednoho chipu. */
export function removeFilterChip(filter, id) {
  if (id === 'period') return { ...filter, period: null, from: '', to: '' }
  if (id === 'type') return { ...filter, type: '' }
  if (id === 'account') return { ...filter, accountId: '' }
  if (id === 'amount') return { ...filter, amountMin: null, amountMax: null }
  if (id === 'origin') return { ...filter, origin: '' }
  if (id === 'author') return { ...filter, authorId: '' }
  if (id.startsWith('category:')) {
    const categoryId = id.slice('category:'.length)
    return { ...filter, categories: filter.categories.filter((c) => c !== categoryId) }
  }
  return filter
}

/** Filtr bez odkazů na kategorie a účty, které už v prostoru nejsou. */
export function pruneFilter(filter, state = getState()) {
  const cats = categoryMap(state)
  const categories = filter.categories.filter((id) => id === NO_CATEGORY || cats.has(id))
  const accountId = accountMap(state).has(filter.accountId) ? filter.accountId : ''
  if (categories.length === filter.categories.length && accountId === filter.accountId) return filter
  return { ...filter, categories, accountId }
}

const segment = (name, options, value) => `
  <div class="segmented" role="group" data-segment="${name}">
    ${options.map(([key, label]) => `<button type="button" data-value="${key}" aria-pressed="${value === key}">${label}</button>`).join('')}
  </div>`

function categoryChip(id, emoji, name, color, selected) {
  return `<button type="button" class="chip" data-category="${esc(id)}" ${color ? `style="--chip-color:${esc(color)}"` : ''}
    aria-pressed="${selected.includes(id)}"><span class="chip__emoji">${esc(emoji)}</span>${esc(name)}</button>`
}

function categoryGroup(type, selected) {
  const cats = categoriesByType(type)
  if (!cats.length) return ''
  return `
    <div class="filter-sheet__cats" data-cat-type="${type}">
      <span class="field__label">${TYPE_LABELS[type]}</span>
      <div class="chips">${cats.map((c) => categoryChip(c.id, c.icon, c.name, c.color, selected)).join('')}</div>
    </div>`
}

/** Otevře filtry; onApply dostane nový filtr (hledaný text zůstává). */
export function openTransactionFilterSheet(filter, onApply) {
  const state = getState()
  const periods = [['', 'Celá historie'], ...Object.entries(PERIOD_LABELS)]
  const members = state.space ? state.members : []

  openSheet({
    title: 'Filtry',
    body: `
      <form class="form" novalidate>
        <div class="field">
          <span class="field__label">Období</span>
          <div class="pills pills--wrap" role="group" data-segment="period">
            ${periods.map(([key, label]) => `<button type="button" class="pill" data-value="${key}" aria-pressed="${(filter.period ?? '') === key}">${label}</button>`).join('')}
          </div>
          <div class="period-custom" data-custom ${filter.period === 'custom' ? '' : 'hidden'}>
            <label class="field"><span class="field__label">Od</span><input class="input" type="date" name="from" value="${esc(filter.from)}" max="9999-12-31"></label>
            <label class="field"><span class="field__label">Do</span><input class="input" type="date" name="to" value="${esc(filter.to || (filter.from ? '' : today()))}" max="9999-12-31"></label>
          </div>
          <span class="field__error" data-error-for="from"></span>
        </div>

        <div class="field">
          <span class="field__label">Typ</span>
          ${segment('type', [['', 'Vše'], ['expense', 'Výdaje'], ['income', 'Příjmy']], filter.type)}
        </div>

        <div class="field filter-sheet__categories">
          <span class="field__label filter-sheet__heading">Kategorie (i více najednou)</span>
          ${categoryGroup('expense', filter.categories)}
          ${categoryGroup('income', filter.categories)}
          <div class="chips">${categoryChip(NO_CATEGORY, '📦', 'Bez kategorie', '', filter.categories)}</div>
        </div>

        ${
          state.accounts.length > 1
            ? `<label class="field"><span class="field__label">Účet</span>
                <select class="select" name="account">
                  <option value="">Všechny účty</option>
                  ${state.accounts.map((a) => `<option value="${a.id}" ${a.id === filter.accountId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
                </select></label>`
            : ''
        }

        <div class="field">
          <div class="grid-2">
            <label class="field"><span class="field__label">Částka od</span>
              <input class="input" name="amountMin" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(amountToInput(filter.amountMin))}"></label>
            <label class="field"><span class="field__label">Částka do</span>
              <input class="input" name="amountMax" inputmode="decimal" autocomplete="off" placeholder="Bez limitu" value="${esc(amountToInput(filter.amountMax))}"></label>
          </div>
          <span class="field__error" data-error-for="amountMin"></span>
        </div>

        <div class="field">
          <span class="field__label">Původ</span>
          ${segment('origin', [['', 'Vše'], ['manual', 'Ručně'], ['import', 'Import']], filter.origin)}
        </div>

        ${
          members.length
            ? `<label class="field"><span class="field__label">Autor</span>
                <select class="select" name="author">
                  <option value="">Všichni členové</option>
                  ${members.map((m) => `<option value="${esc(m.user_id)}" ${m.user_id === filter.authorId ? 'selected' : ''}>${esc(m.username)}</option>`).join('')}
                </select></label>`
            : ''
        }

        <div class="sheet__actions">
          <button type="button" class="btn" data-reset>Vymazat</button>
          <button type="submit" class="btn btn--primary">Použít</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      const segmentValue = (name) => body.querySelector(`[data-segment="${name}"] [aria-pressed="true"]`)?.dataset.value ?? ''

      const syncVisibility = () => {
        const type = segmentValue('type')
        body.querySelectorAll('[data-cat-type]').forEach((g) => (g.hidden = Boolean(type) && g.dataset.catType !== type))
        body.querySelector('[data-custom]').hidden = segmentValue('period') !== 'custom'
      }

      const selectSegment = (group, value) => {
        group.querySelectorAll('[data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === value)))
        syncVisibility()
      }

      const onClick = (e) => {
        const option = e.target.closest('[data-segment] [data-value]')
        if (option) return selectSegment(option.closest('[data-segment]'), option.dataset.value)
        const chip = e.target.closest('[data-category]')
        if (chip) chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'))
      }
      body.addEventListener('click', onClick)
      syncVisibility()

      body.querySelector('[data-reset]').addEventListener('click', () => {
        close()
        onApply({ ...emptyFilter(), q: filter.q })
      })

      const parseOptional = (name) => {
        const raw = form.elements[name].value.trim()
        return raw ? parseAmount(raw) : null
      }

      form.addEventListener('submit', (e) => {
        e.preventDefault()
        clearErrors(form)
        const amountMin = parseOptional('amountMin')
        const amountMax = parseOptional('amountMax')
        const badAmount = [amountMin, amountMax].some((v) => v !== null && (Number.isNaN(v) || v < 0))
        if (badAmount) return setFieldError(form, 'amountMin', 'Zadejte platné částky.')
        if (amountMin !== null && amountMax !== null && amountMin > amountMax) {
          return setFieldError(form, 'amountMin', 'Částka od musí být nejvýše stejná jako částka do.')
        }
        const period = segmentValue('period') || null
        const from = period === 'custom' ? form.elements.from.value : ''
        const to = period === 'custom' ? form.elements.to.value : ''
        if (period === 'custom' && !from && !to) return setFieldError(form, 'from', 'Zadejte alespoň jedno datum.')

        const type = segmentValue('type')
        const hidden = new Set(
          [...body.querySelectorAll('[data-cat-type][hidden] [data-category]')].map((c) => c.dataset.category),
        )
        const categories = [...body.querySelectorAll('[data-category][aria-pressed="true"]')]
          .map((c) => c.dataset.category)
          .filter((id) => !hidden.has(id))

        close()
        onApply({
          ...filter,
          period,
          from,
          to,
          type,
          categories,
          accountId: form.elements.account?.value ?? '',
          amountMin,
          amountMax,
          origin: segmentValue('origin'),
          authorId: form.elements.author?.value ?? '',
        })
      })

      return () => body.removeEventListener('click', onClick)
    },
  })
}
