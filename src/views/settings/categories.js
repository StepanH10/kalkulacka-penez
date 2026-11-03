import { getState, subscribe } from '../../state/store.js'
import { categoriesByType } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow, reassignCategory } from '../../services/api.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { showToast } from '../../components/toast.js'
import { categoryFields, bindCategoryPickers, categoryNameError } from '../../components/categoryFields.js'
import { subHeader, addButton } from './common.js'
import { canEdit, canManage } from '../../state/space.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { translateError } from '../../utils/errors.js'

function plural(n, one, few, many) {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many
}

/** Zeptá se, kam přesunout transakce mazané kategorie. Vrací Promise<id | '' (bez kategorie) | null (zrušeno)>. */
function askReassignTarget(category, count) {
  const others = categoriesByType(category.type).filter((c) => c.id !== category.id)
  const fallback = others.find((c) => c.name.trim().toLocaleLowerCase('cs') === 'ostatní') ?? others[0]
  return new Promise((resolve) => {
    let result = null
    openSheet({
      title: `Smazat kategorii „${category.name}“?`,
      body: `
        <form class="form" novalidate>
          <p class="muted">Kategorie má ${count} ${plural(count, 'transakci', 'transakce', 'transakcí')}. Do které kategorie je přesunout?</p>
          <label class="field">
            <span class="field__label">Přesunout do</span>
            <select class="select" name="target">
              ${others.map((c) => `<option value="${c.id}" ${c === fallback ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}
              <option value="">Bez kategorie</option>
            </select>
          </label>
          <p class="muted" style="font-size:.875rem">Opakované platby se přesunou také. Rozpočet mazané kategorie se smaže.</p>
          <div class="sheet__actions">
            <button type="button" class="btn" data-cancel>Zrušit</button>
            <button type="submit" class="btn btn--danger">Přesunout a smazat</button>
          </div>
        </form>`,
      onMount(body, close) {
        const form = body.querySelector('form')
        body.querySelector('[data-cancel]').addEventListener('click', close)
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          result = form.elements.target.value
          close()
        })
      },
      onClose: () => resolve(result),
    })
  })
}

async function deleteCategory(category) {
  const state = getState()
  const count = state.transactions.filter((t) => t.category_id === category.id).length
  let target = null
  if (count) {
    target = await askReassignTarget(category, count)
    if (target === null) return false
  } else {
    const ok = await confirmDialog({
      title: `Smazat kategorii „${category.name}“?`,
      message: 'Kategorie nemá žádné transakce. Její rozpočet se smaže.',
      confirmLabel: 'Smazat',
      danger: true,
    })
    if (!ok) return false
  }
  await reassignCategory(category.id, target || null)
  await deleteRow('categories', category.id)
  return true
}

function openCategoryForm(category = null, defaultType = 'expense') {
  let type = category?.type ?? defaultType

  openSheet({
    title: category ? 'Upravit kategorii' : 'Nová kategorie',
    body: `
      <form class="form" novalidate>
        ${
          category
            ? ''
            : `<div class="segmented" role="group" aria-label="Typ">
                <button type="button" data-type="expense" aria-pressed="${type === 'expense'}">Výdaj</button>
                <button type="button" data-type="income" aria-pressed="${type === 'income'}">Příjem</button>
              </div>`
        }
        ${categoryFields({ name: category?.name, icon: category?.icon, color: category?.color, autofocus: true })}
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${category && canManage() ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      const pickers = bindCategoryPickers(body, category ?? {})

      body.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-type]')
        if (t) {
          type = t.dataset.type
          body.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b === t)))
          return
        }
        if (e.target.closest('[data-delete]')) {
          try {
            if (await deleteCategory(category)) {
              showToast('Kategorie smazána')
              close()
            }
          } catch (err) {
            form.querySelector('.form-error').textContent = translateError(err)
          }
        }
      })

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        const error = categoryNameError(name, type, category?.id)
        if (error) return setFieldError(form, 'name', error)
        const row = { name, color: pickers.color, icon: pickers.icon }
        if (!category) row.type = type
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (category) await updateRow('categories', category.id, row)
          else await createRow('categories', row)
          showToast(category ? 'Kategorie upravena' : 'Kategorie vytvořena')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })

      return pickers.destroy
    },
  })
}

export default function categoriesView(el) {
  let type = 'expense'

  const draw = () => {
    const cats = categoriesByType(type)
    el.innerHTML = `
      ${subHeader('Kategorie', addButton('Nová'))}
      <div class="segmented" role="group" aria-label="Typ" style="margin-bottom:20px">
        <button type="button" data-tab="expense" aria-pressed="${type === 'expense'}">Výdaje</button>
        <button type="button" data-tab="income" aria-pressed="${type === 'income'}">Příjmy</button>
      </div>
      ${
        cats.length
          ? `<div class="card card--flush list">
              ${cats
                .map(
                  (c) => `
                <button type="button" class="list-row" data-category="${c.id}">
                  <div class="list-row__icon" style="--row-color:${esc(c.color)}">${esc(c.icon)}</div>
                  <div class="list-row__body"><div class="list-row__title">${esc(c.name)}</div></div>
                  ${icon('chevron-right', { size: 18 })}
                </button>`,
                )
                .join('')}
            </div>`
          : `<div class="empty"><p>Žádné kategorie tohoto typu.</p></div>`
      }`
  }

  const onClick = (e) => {
    const tab = e.target.closest('[data-tab]')
    if (tab) {
      type = tab.dataset.tab
      return draw()
    }
    if (!canEdit()) return
    if (e.target.closest('[data-add]')) return openCategoryForm(null, type)
    const row = e.target.closest('[data-category]')
    if (row) openCategoryForm(getState().categories.find((c) => c.id === row.dataset.category))
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
