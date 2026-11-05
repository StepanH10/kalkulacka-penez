import { getState, subscribe } from '../state/store.js'
import { signOut, updatePassword, verifyPassword, deleteAccount } from '../services/auth.js'
import { exportJSON, exportCSV, readBackup, importBackup } from '../services/backup.js'
import { openSheet, confirmDialog } from '../components/sheet.js'
import { showToast } from '../components/toast.js'
import { openUsernameSheet } from '../components/usernameSheet.js'
import { currentGroup, ROLE_LABELS } from '../state/space.js'
import { passwordField, bindPasswordToggles } from './authLayout.js'
import { navigate } from '../router.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { initials, formatTag } from '../utils/format.js'
import { translateError } from '../utils/errors.js'
import { validatePassword, validatePasswordConfirm } from '../utils/validation.js'
import { getThemePreference, setThemePreference } from '../utils/theme.js'

const THEMES = [
  ['system', 'Systém', 'monitor'],
  ['light', 'Světlý', 'sun'],
  ['dark', 'Tmavý', 'moon'],
]

const menuLink = (href, ic, label) =>
  `<a class="menu-row" href="${href}" data-link>${icon(ic)}<span>${label}</span>${icon('chevron-right', { size: 18 })}</a>`

const menuButton = (action, ic, label, danger = false) =>
  `<button type="button" class="menu-row ${danger ? 'menu-row--danger' : ''}" data-action="${action}">${icon(ic)}<span>${label}</span></button>`

function openPasswordForm() {
  openSheet({
    title: 'Změnit heslo',
    body: `
      <form class="form" novalidate>
        ${passwordField({ name: 'current', label: 'Současné heslo' })}
        ${passwordField({ name: 'password', label: 'Nové heslo (alespoň 8 znaků)', autocomplete: 'new-password' })}
        ${passwordField({ name: 'confirm', label: 'Potvrzení nového hesla', autocomplete: 'new-password' })}
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions"><button type="submit" class="btn btn--primary"><span class="spinner"></span>Změnit heslo</button></div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      const off = bindPasswordToggles(body)
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const current = form.elements.current.value
        const password = form.elements.password.value
        const errors = {
          current: current ? '' : 'Zadejte současné heslo.',
          password: validatePassword(password),
          confirm: validatePasswordConfirm(password, form.elements.confirm.value),
        }
        Object.entries(errors).forEach(([k, v]) => setFieldError(form, k, v))
        if (Object.values(errors).some(Boolean)) return
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          await verifyPassword(current)
          await updatePassword(password)
          showToast('Heslo bylo změněno')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
      return off
    },
  })
}

async function handleImport(file) {
  try {
    const { payload, count } = await readBackup(file)
    const ok = await confirmDialog({
      title: 'Obnovit data ze zálohy?',
      message: `Záloha obsahuje ${count} položek. Položky se stejným ID se přepíšou, ostatní se přidají.`,
      confirmLabel: 'Importovat',
    })
    if (!ok) return
    showToast('Importuji…')
    await importBackup(payload)
    showToast('Data byla importována')
  } catch (err) {
    showToast(translateError(err), { duration: 6000 })
  }
}

export default function settingsView(el) {
  const draw = () => {
    const state = getState()
    const name = state.profile?.username ?? ''
    const tag = formatTag(state.profile)
    const email = state.session?.user?.email ?? ''
    const group = currentGroup(state)
    const theme = getThemePreference()
    el.innerHTML = `
      <header class="page-header"><h1>Nastavení</h1></header>

      <section class="card profile-card">
        <div class="avatar">${esc(initials(name || '?'))}</div>
        <div class="list-row__body">
          <div class="list-row__title">${esc(name || 'Bez přezdívky')}</div>
          ${tag ? `<div class="list-row__sub tag">${esc(tag)}</div>` : ''}
        </div>
        ${tag ? `<button type="button" class="icon-btn" data-action="copy-tag" aria-label="Kopírovat tag ${esc(tag)}">${icon('copy', { size: 18 })}</button>` : ''}
        <button type="button" class="icon-btn" data-action="username" aria-label="Změnit přezdívku">${icon('pencil', { size: 18 })}</button>
      </section>

      ${
        group
          ? `<section class="section">
              <h2>Skupina</h2>
              <div class="card card--flush">
                <a class="menu-row" href="/settings/group" data-link>${icon('users')}<span class="menu-row__text"><span>${esc(group.name)}</span><small class="muted">${ROLE_LABELS[group.role]} · ${state.members.length} ${state.members.length === 1 ? 'člen' : state.members.length < 5 ? 'členové' : 'členů'}</small></span>${icon('chevron-right', { size: 18 })}</a>
              </div>
            </section>`
          : ''
      }

      <section class="section">
        <h2>Vzhled</h2>
        <div class="segmented" role="group" aria-label="Motiv">
          ${THEMES.map(([key, label]) => `<button type="button" data-theme-choice="${key}" aria-pressed="${theme === key}">${label}</button>`).join('')}
        </div>
      </section>

      <section class="section">
        <h2>${group ? `Správa skupiny „${esc(group.name)}“` : 'Správa'}</h2>
        <div class="card card--flush">
          ${menuLink('/settings/accounts', 'wallet', 'Účty a převody')}
          ${menuLink('/settings/categories', 'tag', 'Kategorie')}
          ${menuLink('/settings/budgets', 'target', 'Rozpočty')}
          ${menuLink('/settings/recurring', 'repeat', 'Opakované platby')}
          ${menuLink('/settings/rules', 'wand-sparkles', 'Pravidla importu')}
        </div>
      </section>

      <section class="section">
        <h2>Data</h2>
        <div class="card card--flush">
          ${menuButton('export-json', 'file-json', 'Exportovat zálohu (JSON)')}
          ${group ? '' : menuButton('import-json', 'upload', 'Importovat zálohu (JSON)')}
          ${menuButton('export-csv', 'file-spreadsheet', 'Exportovat transakce (CSV)')}
        </div>
        <input type="file" accept="application/json,.json" hidden data-import-file>
      </section>

      <section class="section">
        <h2>Účet</h2>
        <div class="card card--flush">
          <div class="menu-row menu-row--static">${icon('at-sign')}<span class="menu-row__text"><small class="muted">Přihlašovací e-mail (vidíte jen vy)</small><span class="menu-row__value">${esc(email)}</span></span></div>
          ${menuButton('password', 'key-round', 'Změnit heslo')}
          ${menuButton('logout', 'log-out', 'Odhlásit se')}
          ${menuButton('delete', 'trash', 'Smazat účet a všechna data', true)}
        </div>
      </section>`
  }

  const onClick = async (e) => {
    const themeBtn = e.target.closest('[data-theme-choice]')
    if (themeBtn) {
      setThemePreference(themeBtn.dataset.themeChoice)
      draw()
      return
    }
    const action = e.target.closest('[data-action]')?.dataset.action
    if (!action) return
    switch (action) {
      case 'username':
        return openUsernameSheet()
      case 'copy-tag': {
        const tag = formatTag(getState().profile)
        try {
          await navigator.clipboard.writeText(tag)
          return showToast(`Tag ${tag} zkopírován`)
        } catch {
          return showToast('Kopírování se nepodařilo. Tag si opište ručně.')
        }
      }
      case 'password':
        return openPasswordForm()
      case 'export-json':
        exportJSON()
        return showToast('Záloha stažena')
      case 'export-csv':
        exportCSV()
        return showToast('CSV staženo')
      case 'import-json':
        return el.querySelector('[data-import-file]').click()
      case 'logout':
        try {
          await signOut()
        } catch {
          /* lokální odhlášení proběhlo i bez sítě */
        }
        return navigate('/login', { replace: true })
      case 'delete': {
        const ok = await confirmDialog({
          title: 'Smazat účet?',
          message: 'Trvale smažeme váš účet a všechny transakce, účty, kategorie, cíle i rozpočty. Tuto akci nelze vrátit.',
          confirmLabel: 'Smazat účet',
          danger: true,
          requireText: 'SMAZAT',
        })
        if (!ok) return
        try {
          await deleteAccount()
          sessionStorage.setItem('kp-auth-notice', 'Váš účet byl smazán.')
          navigate('/login', { replace: true })
        } catch (err) {
          showToast(translateError(err))
        }
      }
    }
  }

  const onChange = (e) => {
    if (!e.target.matches('[data-import-file]')) return
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) handleImport(file)
  }

  draw()
  const unsub = subscribe(draw)
  el.addEventListener('click', onClick)
  el.addEventListener('change', onChange)
  return () => {
    unsub()
    el.removeEventListener('click', onClick)
    el.removeEventListener('change', onChange)
  }
}
