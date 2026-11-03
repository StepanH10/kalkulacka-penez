import { getState } from '../state/store.js'
import { currentGroup, canEdit, ROLE_LABELS } from '../state/space.js'
import { switchSpace, createGroup } from '../services/groups.js'
import { openSheet } from './sheet.js'
import { showToast } from './toast.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { translateError } from '../utils/errors.js'

const MAX_GROUPS = 5

/** Lišta nad obsahem: aktuální prostor + štítek pro pozorovatele. */
export function renderSpaceBar(state = getState()) {
  const group = currentGroup(state)
  return `
    <button type="button" class="space-switch" data-space-switch aria-haspopup="dialog">
      ${icon(group ? 'users' : 'user', { size: 18 })}
      <span class="space-switch__name">${esc(group ? group.name : 'Osobní')}</span>
      ${icon('chevron-down', { size: 16 })}
    </button>
    ${canEdit(state) ? '' : `<span class="badge">${icon('eye', { size: 14 })}Pouze pro čtení</span>`}`
}

function openCreateGroup() {
  openSheet({
    title: 'Vytvořit skupinu',
    body: `
      <form class="form" novalidate>
        <p class="muted">Skupina je sdílený prostor s vlastními účty, transakcemi, kategoriemi, rozpočty a cíli. Vaše osobní data zůstávají soukromá.</p>
        <label class="field">
          <span class="field__label">Název skupiny</span>
          <input class="input" name="name" maxlength="40" placeholder="Např. Domácnost" autocomplete="off" autofocus>
          <span class="field__error" data-error-for="name"></span>
        </label>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Vytvořit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        if (!name) return setFieldError(form, 'name', 'Zadejte název skupiny.')
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          const group = await createGroup(name)
          showToast(`Skupina „${group.name}“ vytvořena`)
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

/** Výběr prostoru: Osobní, moje skupiny, Vytvořit skupinu. */
export function openSpacePicker() {
  const { space, groups } = getState()
  const row = (id, ic, title, sub) => `
    <button type="button" class="list-row" data-space="${id ?? ''}" aria-pressed="${(space ?? null) === id}">
      <div class="list-row__icon">${icon(ic, { size: 18 })}</div>
      <div class="list-row__body">
        <div class="list-row__title">${esc(title)}</div>
        ${sub ? `<div class="list-row__sub">${esc(sub)}</div>` : ''}
      </div>
      ${(space ?? null) === id ? `<span class="list-row__check">${icon('check', { size: 18 })}</span>` : ''}
    </button>`

  openSheet({
    title: 'Prostor',
    body: `
      <div class="card card--flush list space-list">
        ${row(null, 'user', 'Osobní', 'Jen vaše data')}
        ${groups.map((g) => row(g.id, 'users', g.name, ROLE_LABELS[g.role])).join('')}
      </div>
      ${
        groups.length < MAX_GROUPS
          ? `<button type="button" class="btn btn--block" data-create-group style="margin-top:16px">${icon('plus', { size: 18 })}Vytvořit skupinu</button>`
          : `<p class="muted" style="margin-top:16px;font-size:.875rem">Můžete být nejvýše v ${MAX_GROUPS} skupinách.</p>`
      }`,
    onMount(body, close) {
      body.addEventListener('click', async (e) => {
        if (e.target.closest('[data-create-group]')) {
          close()
          return openCreateGroup()
        }
        const btn = e.target.closest('[data-space]')
        if (!btn) return
        const id = btn.dataset.space || null
        close()
        if (id === (getState().space ?? null)) return
        try {
          await switchSpace(id)
        } catch (err) {
          showToast(translateError(err))
        }
      })
    },
  })
}
