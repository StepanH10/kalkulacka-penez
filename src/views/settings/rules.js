// Nastavení → Pravidla importu: text v popisu / protistraně → kategorie.
// Pravidla patří do aktuálního prostoru (osobní / skupina) stejně jako kategorie.
import { getState, subscribe } from '../../state/store.js'
import { categoriesByType, categoryMap } from '../../state/selectors.js'
import { createRow, updateRow, deleteRow } from '../../services/api.js'
import { sameRule } from '../../importers/categorize.js'
import { openSheet, confirmDialog } from '../../components/sheet.js'
import { showToast } from '../../components/toast.js'
import { subHeader, addButton } from './common.js'
import { canEdit } from '../../state/space.js'
import { esc, setLoading, setFieldError, clearErrors } from '../../utils/dom.js'
import { icon } from '../../utils/icons.js'
import { translateError } from '../../utils/errors.js'

const TYPE_LABEL = { expense: 'Výdaje', income: 'Příjmy' }

function categorySelect(selected) {
  return ['expense', 'income']
    .map(
      (type) => `
      <optgroup label="${TYPE_LABEL[type]}">
        ${categoriesByType(type)
          .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`)
          .join('')}
      </optgroup>`,
    )
    .join('')
}

function openRuleForm(rule = null) {
  if (!getState().categories.length) return showToast('Nejdřív si vytvořte kategorii.')
  openSheet({
    title: rule ? 'Upravit pravidlo' : 'Nové pravidlo',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Když popis nebo protistrana obsahuje</span>
          <input class="input" name="text" maxlength="60" placeholder="Např. lidl" autocomplete="off" value="${esc(rule?.match_text ?? '')}" autofocus>
          <span class="field__hint">Nezáleží na velikosti písmen ani diakritice.</span>
          <span class="field__error" data-error-for="text"></span>
        </label>
        <label class="field">
          <span class="field__label">Kategorie</span>
          <select class="select" name="category">${categorySelect(rule?.category_id)}</select>
        </label>
        <p class="muted" style="font-size:.8125rem">Výdajové kategorie se použijí jen u plateb, příjmové jen u příchozích částek.</p>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions">
          ${rule ? '<button type="button" class="btn btn--danger" data-delete>Smazat</button>' : ''}
          <button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button>
        </div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      form.elements.text.addEventListener('input', () => setFieldError(form, 'text', ''))

      body.querySelector('[data-delete]')?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'Smazat pravidlo?',
          message: 'Už importované transakce zůstanou beze změny.',
          confirmLabel: 'Smazat',
          danger: true,
        })
        if (!ok) return
        try {
          await deleteRow('rules', rule.id)
          showToast('Pravidlo smazáno')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
        }
      })

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const match_text = form.elements.text.value.trim()
        const category_id = form.elements.category.value
        if (match_text.length < 2) return setFieldError(form, 'text', 'Zadejte alespoň 2 znaky.')
        const { rules, categories } = getState()
        const type = categoryMap().get(category_id)?.type
        const clash = sameRule(match_text, type, rules, categories)
        if (clash && clash.id !== rule?.id) {
          return setFieldError(form, 'text', `Pro „${clash.match_text}“ už pravidlo (${TYPE_LABEL[type].toLowerCase()}) existuje.`)
        }
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          if (rule) await updateRow('rules', rule.id, { match_text, category_id })
          else await createRow('rules', { match_text, category_id })
          showToast(rule ? 'Pravidlo upraveno' : 'Pravidlo uloženo')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

export default function rulesView(el) {
  const draw = () => {
    const state = getState()
    const cats = categoryMap(state)
    const rules = [...state.rules]
      .filter((r) => cats.has(r.category_id))
      .sort((a, b) => a.match_text.localeCompare(b.match_text, 'cs'))
    const editable = canEdit(state)
    el.innerHTML = `
      ${subHeader('Pravidla importu', addButton('Nové'))}
      <p class="muted" style="margin:-12px 0 20px;font-size:.875rem">Při importu výpisu z banky dostane transakce kategorii podle textu v popisu nebo u protistrany.</p>
      ${
        rules.length
          ? `<div class="card card--flush list">
              ${rules
                .map((r) => {
                  const c = cats.get(r.category_id)
                  const inner = `
                    <div class="list-row__icon" style="--row-color:${esc(c.color)}">${esc(c.icon)}</div>
                    <div class="list-row__body">
                      <div class="list-row__title">„${esc(r.match_text)}“</div>
                      <div class="list-row__sub">${esc(c.name)} · ${TYPE_LABEL[c.type]}</div>
                    </div>`
                  return editable
                    ? `<button type="button" class="list-row" data-rule="${r.id}">${inner}${icon('chevron-right', { size: 18 })}</button>`
                    : `<div class="list-row">${inner}</div>`
                })
                .join('')}
            </div>`
          : `<div class="empty">${icon('wand-sparkles', { size: 24 })}<p>${
              editable
                ? 'Zatím žádná pravidla. Vytvoříte je tady, nebo při importu po ruční změně kategorie.'
                : 'Zatím žádná pravidla importu.'
            }</p></div>`
      }`
  }

  const onClick = (e) => {
    if (!canEdit()) return
    if (e.target.closest('[data-add]')) return openRuleForm()
    const row = e.target.closest('[data-rule]')
    if (row) openRuleForm(getState().rules.find((r) => r.id === row.dataset.rule))
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
  }
}
