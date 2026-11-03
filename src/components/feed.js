import { getState, setState } from '../state/store.js'
import { categoryMap, accountMap } from '../state/selectors.js'
import { canEdit, canModifyEntry, authorName } from '../state/space.js'
import { deleteRow, restoreRow } from '../services/api.js'
import { openTransactionSheet } from './transactionSheet.js'
import { showToast } from './toast.js'
import { esc } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney } from '../utils/format.js'
import { formatDayLabel } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'

function row(item, cats, accs, author) {
  if (item.kind === 'transfer') {
    const from = accs.get(item.from_account_id)?.name ?? '?'
    const to = accs.get(item.to_account_id)?.name ?? '?'
    const sub = [`${from} → ${to}`, author, item.note].filter(Boolean).join(' · ')
    return `
      <div class="list-row__icon">${icon('arrow-left-right', { size: 18 })}</div>
      <div class="list-row__body">
        <div class="list-row__title">Převod</div>
        <div class="list-row__sub">${esc(sub)}</div>
      </div>
      <div class="list-row__end muted">${formatMoney(item.amount)}</div>`
  }
  const cat = cats.get(item.category_id)
  const isIncome = item.type === 'income'
  const sub = [author, accs.size > 1 ? accs.get(item.account_id)?.name : '', item.note].filter(Boolean).join(' · ')
  return `
    <div class="list-row__icon" style="--row-color:${esc(cat?.color ?? '#8A8A8A')}">${esc(cat?.icon ?? '📦')}</div>
    <div class="list-row__body">
      <div class="list-row__title">${esc(cat?.name ?? 'Bez kategorie')}</div>
      ${sub ? `<div class="list-row__sub">${esc(sub)}</div>` : ''}
    </div>
    <div class="list-row__end ${isIncome ? 'income' : ''}">${formatMoney(isIncome ? item.amount : -item.amount, { sign: true })}</div>`
}

/** Seznam transakcí a převodů seskupený podle dne. */
export function renderFeed(items, emptyText = 'Zatím žádné transakce. Přidejte první tlačítkem +.') {
  if (!items.length) {
    return `<div class="empty">${icon('list', { size: 24 })}<p>${esc(emptyText)}</p></div>`
  }
  const state = getState()
  const cats = categoryMap(state)
  const accs = accountMap(state)
  // ve skupině je u každého záznamu přezdívka autora
  const author = (item) => (state.space ? authorName(item.created_by, state) : '')
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.date)) groups.set(item.date, [])
    groups.get(item.date).push(item)
  }
  return [...groups]
    .map(([date, list]) => {
      const net = list
        .filter((i) => i.kind === 'transaction')
        .reduce((s, i) => s + (i.type === 'income' ? 1 : -1) * Number(i.amount), 0)
      return `
        <section class="day-group">
          <div class="day-group__head"><span>${esc(formatDayLabel(date))}</span><span class="num">${net ? formatMoney(net, { sign: true }) : ''}</span></div>
          <div class="card card--flush list">
            ${list
              .map(
                (item) => `
                <div class="swipe" data-kind="${item.kind}" data-id="${item.id}">
                  <div class="swipe__action">${icon('trash', { size: 18 })}Smazat</div>
                  <button type="button" class="list-row" data-edit>${row(item, cats, accs, author(item))}</button>
                </div>`,
              )
              .join('')}
          </div>
        </section>`
    })
    .join('')
}

function findItem(kind, id) {
  const state = getState()
  const list = kind === 'transfer' ? state.transfers : state.transactions
  const found = list.find((r) => r.id === id)
  return found ? { kind, ...found } : null
}

/** Smaže položku a nabídne „Zpět“. */
export async function deleteWithUndo(item) {
  const key = item.kind === 'transfer' ? 'transfers' : 'transactions'
  const { kind: _kind, ...original } = item
  try {
    await deleteRow(key, item.id)
    showToast(item.kind === 'transfer' ? 'Převod smazán' : 'Transakce smazána', {
      actionLabel: 'Zpět',
      onAction: async () => {
        try {
          await restoreRow(key, original)
        } catch (err) {
          showToast(translateError(err))
        }
      },
    })
  } catch (err) {
    setState({}) // vrátí do seznamu řádek skrytý animací
    showToast(translateError(err))
  }
}

/** Kliknutí = úprava, swipe doleva = smazání. Vrací funkci pro odpojení. */
export function bindFeed(root) {
  let drag = null
  let suppressClick = false

  const onClick = (e) => {
    const btn = e.target.closest('.swipe [data-edit]')
    if (!btn || !root.contains(btn)) return
    if (suppressClick) {
      suppressClick = false
      return
    }
    const wrap = btn.closest('.swipe')
    const item = findItem(wrap.dataset.kind, wrap.dataset.id)
    if (!item || !canEdit()) return
    if (!canModifyEntry(item)) return showToast('Upravit může jen autor záznamu nebo vlastník skupiny.')
    openTransactionSheet({ item })
  }

  const onDown = (e) => {
    if (e.pointerType === 'mouse') return
    const rowEl = e.target.closest('.swipe .list-row')
    if (!rowEl || !root.contains(rowEl)) return
    const wrapEl = rowEl.closest('.swipe')
    if (!canModifyEntry(findItem(wrapEl.dataset.kind, wrapEl.dataset.id))) return
    drag = { rowEl, wrap: rowEl.closest('.swipe'), startX: e.clientX, startY: e.clientY, dx: 0, active: false, id: e.pointerId }
  }

  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (!drag.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        drag = null
        return
      }
      if (dx < -10 && Math.abs(dx) > Math.abs(dy)) {
        drag.active = true
        drag.rowEl.style.transition = 'none'
        try {
          drag.rowEl.setPointerCapture(e.pointerId)
        } catch {
          /* ukazatel už nemusí být aktivní */
        }
      } else return
    }
    drag.dx = Math.min(0, dx)
    drag.rowEl.style.transform = `translateX(${drag.dx}px)`
  }

  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const { rowEl, wrap, dx, active } = drag
    drag = null
    if (!active) return
    suppressClick = true
    setTimeout(() => (suppressClick = false), 300)
    rowEl.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)'
    const threshold = Math.min(120, rowEl.offsetWidth * 0.35)
    if (e.type !== 'pointercancel' && -dx > threshold) {
      const item = findItem(wrap.dataset.kind, wrap.dataset.id)
      rowEl.style.transform = 'translateX(-100%)'
      wrap.style.maxHeight = `${wrap.offsetHeight}px`
      setTimeout(() => wrap.classList.add('is-removing'), 160)
      if (item) setTimeout(() => deleteWithUndo(item), 340)
    } else {
      rowEl.style.transform = ''
    }
  }

  root.addEventListener('click', onClick)
  root.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
  return () => {
    root.removeEventListener('click', onClick)
    root.removeEventListener('pointerdown', onDown)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
}
