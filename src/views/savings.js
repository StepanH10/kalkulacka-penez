import { getState, subscribe } from '../state/store.js'
import { goalSaved } from '../state/selectors.js'
import { canEdit, canManage, canModifyEntry, authorName } from '../state/space.js'
import { createRow, updateRow, deleteRow } from '../services/api.js'
import { openSheet, confirmDialog } from '../components/sheet.js'
import { showToast } from '../components/toast.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { formatMoney, parseAmount, amountToInput } from '../utils/format.js'
import { formatDate, monthsUntil, today } from '../utils/dates.js'
import { translateError } from '../utils/errors.js'
import { validateAmount, validateName } from '../utils/validation.js'

function goalInfo(goal) {
  const saved = goalSaved(goal.id)
  const target = Number(goal.target_amount)
  const ratio = target ? Math.max(0, saved / target) : 0
  const remaining = Math.max(0, target - saved)
  let perMonth = null
  if (goal.deadline && remaining > 0 && goal.deadline >= today()) {
    perMonth = remaining / monthsUntil(goal.deadline)
  }
  return { saved, target, ratio, remaining, perMonth }
}

function goalCard(goal) {
  const { saved, target, ratio, remaining, perMonth } = goalInfo(goal)
  const done = ratio >= 1
  const overdue = goal.deadline && goal.deadline < today() && !done
  return `
    <button type="button" class="card goal" data-goal="${goal.id}">
      <div class="goal__top">
        <h3>${esc(goal.name)}</h3>
        <span class="num"><strong>${formatMoney(saved)}</strong> <span class="muted">z ${formatMoney(target)}</span></span>
      </div>
      <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(ratio * 100))}">
        <div class="progress__bar" style="width:${Math.min(100, ratio * 100)}%"></div>
      </div>
      <div class="goal__meta">
        <span>${done ? `${icon('check', { size: 14 })} Splněno` : `${Math.round(ratio * 100)} % · zbývá ${formatMoney(remaining)}`}</span>
        <span>${
          goal.deadline
            ? `${overdue ? '<span class="expense">Po termínu</span> · ' : ''}do ${formatDate(goal.deadline)}${perMonth ? ` · ${formatMoney(Math.ceil(perMonth))}/měs.` : ''}`
            : ''
        }</span>
      </div>
    </button>`
}

function openGoalForm(goal = null) {
  openSheet({
    title: goal ? 'Upravit cíl' : 'Nový spořicí cíl',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Název</span>
          <input class="input" name="name" maxlength="60" placeholder="Např. Dovolená" value="${esc(goal?.name ?? '')}" autofocus>
          <span class="field__error" data-error-for="name"></span>
        </label>
        <label class="field">
          <span class="field__label">Cílová částka (Kč)</span>
          <input class="input num" name="target" inputmode="decimal" value="${esc(amountToInput(goal?.target_amount))}">
          <span class="field__error" data-error-for="target"></span>
        </label>
        <label class="field">
          <span class="field__label">Termín (nepovinné)</span>
          <input class="input" type="date" name="deadline" value="${esc(goal?.deadline ?? '')}">
        </label>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        const rawTarget = form.elements.target.value.trim()
        const target = parseAmount(rawTarget)
        const errors = { name: validateName(name, 'název'), target: validateAmount(rawTarget === '' ? '' : target) }
        Object.entries(errors).forEach(([k, v]) => setFieldError(form, k, v))
        if (errors.name || errors.target) return
        const row = { name, target_amount: target, deadline: form.elements.deadline.value || null }
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (goal) await updateRow('goals', goal.id, row)
          else await createRow('goals', row)
          showToast(goal ? 'Cíl upraven' : 'Cíl vytvořen')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

function openGoalDetail(goalId) {
  let mode = 'deposit'
  openSheet({
    title: getState().goals.find((g) => g.id === goalId)?.name ?? 'Cíl',
    body: '<div data-detail></div>',
    onMount(body, close) {
      const slot = body.querySelector('[data-detail]')

      const draw = () => {
        const goal = getState().goals.find((g) => g.id === goalId)
        if (!goal) return close()
        const { saved, target, ratio } = goalInfo(goal)
        const entries = getState()
          .entries.filter((e) => e.goal_id === goalId)
          .sort((a, b) => b.date.localeCompare(a.date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        slot.innerHTML = `
          <div class="stack">
            <div class="stat">
              <span class="stat__label">Naspořeno</span>
              <span class="balance">${formatMoney(saved)}</span>
              <span class="muted num">z ${formatMoney(target)} · ${Math.round(ratio * 100)} %</span>
            </div>
            <div class="progress"><div class="progress__bar" style="width:${Math.min(100, ratio * 100)}%"></div></div>

            ${canEdit() ? `<form class="form" novalidate style="margin-top:12px">
              <div class="segmented" role="group" aria-label="Typ pohybu">
                <button type="button" data-entry-mode="deposit" aria-pressed="${mode === 'deposit'}">Vklad</button>
                <button type="button" data-entry-mode="withdraw" aria-pressed="${mode === 'withdraw'}">Výběr</button>
              </div>
              <div class="grid-2">
                <label class="field">
                  <span class="field__label">Částka (Kč)</span>
                  <input class="input num" name="amount" inputmode="decimal" placeholder="0">
                </label>
                <label class="field">
                  <span class="field__label">Datum</span>
                  <input class="input" type="date" name="date" value="${today()}">
                </label>
              </div>
              <span class="field__error" data-error-for="amount"></span>
              <button type="submit" class="btn btn--primary"><span class="spinner"></span>${mode === 'deposit' ? 'Vložit' : 'Vybrat'}</button>
            </form>` : ''}

            <section class="section" style="margin-top:20px">
              <h3 style="margin-bottom:8px">Historie</h3>
              ${
                entries.length
                  ? `<div class="card card--flush list">${entries
                      .map(
                        (en) => `
                      <div class="list-row">
                        <div class="list-row__body">
                          <div class="list-row__title">${Number(en.amount) > 0 ? 'Vklad' : 'Výběr'}</div>
                          <div class="list-row__sub">${[formatDate(en.date), getState().space ? authorName(en.created_by) : ''].filter(Boolean).map(esc).join(' · ')}</div>
                        </div>
                        <div class="list-row__end ${Number(en.amount) > 0 ? 'income' : 'expense'}">${formatMoney(en.amount, { sign: true })}</div>
                        ${canModifyEntry(en) ? `<button type="button" class="icon-btn" data-delete-entry="${en.id}" aria-label="Smazat pohyb">${icon('trash', { size: 18 })}</button>` : ''}
                      </div>`,
                      )
                      .join('')}</div>`
                  : '<p class="muted">Zatím žádné vklady.</p>'
              }
            </section>

            ${
              canEdit()
                ? `<div class="sheet__actions">
                    ${canManage() ? '<button type="button" class="btn btn--danger" data-delete-goal>Smazat cíl</button>' : ''}
                    <button type="button" class="btn" data-edit-goal>${icon('pencil', { size: 16 })}Upravit</button>
                  </div>`
                : ''
            }
          </div>`
      }
      draw()
      const unsub = subscribe(draw)

      slot.addEventListener('click', async (e) => {
        const modeBtn = e.target.closest('[data-entry-mode]')
        if (modeBtn) {
          mode = modeBtn.dataset.entryMode
          draw()
          return
        }
        const delEntry = e.target.closest('[data-delete-entry]')
        if (delEntry) {
          try {
            await deleteRow('entries', delEntry.dataset.deleteEntry)
            showToast('Pohyb smazán')
          } catch (err) {
            showToast(translateError(err))
          }
          return
        }
        if (e.target.closest('[data-edit-goal]')) {
          const goal = getState().goals.find((g) => g.id === goalId)
          close()
          openGoalForm(goal)
          return
        }
        if (e.target.closest('[data-delete-goal]')) {
          const ok = await confirmDialog({
            title: 'Smazat cíl?',
            message: 'Smaže se cíl i celá historie vkladů. Tuto akci nelze vrátit.',
            confirmLabel: 'Smazat',
            danger: true,
          })
          if (!ok) return
          try {
            await deleteRow('goals', goalId)
            showToast('Cíl smazán')
          } catch (err) {
            showToast(translateError(err))
          }
        }
      })

      slot.addEventListener('submit', async (e) => {
        e.preventDefault()
        const form = e.target
        clearErrors(form)
        const raw = form.elements.amount.value.trim()
        const amount = parseAmount(raw)
        let error = validateAmount(raw === '' ? '' : amount)
        if (!error && mode === 'withdraw' && amount > goalSaved(goalId)) {
          error = `Nelze vybrat víc, než je naspořeno (${formatMoney(goalSaved(goalId))}).`
        }
        if (error) return setFieldError(form, 'amount', error)
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          await createRow('entries', {
            goal_id: goalId,
            amount: mode === 'deposit' ? amount : -amount,
            date: form.elements.date.value || today(),
          })
          showToast(mode === 'deposit' ? 'Vklad uložen' : 'Výběr uložen')
        } catch (err) {
          setFieldError(form, 'amount', translateError(err))
          setLoading(button, false)
        }
      })

      return unsub
    },
  })
}

export default function savingsView(el) {
  const draw = () => {
    const state = getState()
    const total = state.goals.reduce((s, g) => s + goalSaved(g.id, state), 0)
    el.innerHTML = `
      <header class="page-header">
        <h1>Spoření</h1>
        ${canEdit(state) ? `<button type="button" class="btn btn--sm btn--primary" data-new-goal>${icon('plus', { size: 16 })}Nový cíl</button>` : ''}
      </header>
      ${
        state.goals.length
          ? `<div class="card stat" style="margin-bottom:24px">
              <span class="stat__label">${icon('piggy-bank', { size: 16 })}Celkem naspořeno</span>
              <span class="balance">${formatMoney(total)}</span>
            </div>
            <div class="stack">${state.goals.map(goalCard).join('')}</div>`
          : `<div class="empty">${icon('target', { size: 24 })}<p>Zatím nemáte žádný spořicí cíl.<br>Vytvořte si první – třeba na dovolenou.</p></div>`
      }`
  }

  const onClick = (e) => {
    if (e.target.closest('[data-new-goal]')) return openGoalForm()
    const card = e.target.closest('[data-goal]')
    if (card) openGoalDetail(card.dataset.goal)
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
