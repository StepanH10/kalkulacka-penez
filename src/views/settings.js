import { getState, subscribe } from '../state/store.js'
import { updateProfile } from '../services/api.js'
import { signOut, updatePassword, verifyPassword, updateDisplayName, deleteAccount } from '../services/auth.js'
import { exportJSON, exportCSV, readBackup, importBackup } from '../services/backup.js'
import { openSheet, confirmDialog } from '../components/sheet.js'
import { showToast } from '../components/toast.js'
import { passwordField, bindPasswordToggles } from './authLayout.js'
import { navigate } from '../router.js'
import { esc, setLoading, setFieldError, clearErrors } from '../utils/dom.js'
import { icon } from '../utils/icons.js'
import { initials } from '../utils/format.js'
import { translateError } from '../utils/errors.js'
import { validateName, validatePassword, validatePasswordConfirm } from '../utils/validation.js'
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

function openNameForm() {
  const current = getState().profile?.display_name ?? ''
  openSheet({
    title: 'Změnit jméno',
    body: `
      <form class="form" novalidate>
        <label class="field">
          <span class="field__label">Zobrazované jméno</span>
          <input class="input" name="name" maxlength="60" value="${esc(current)}" autocomplete="name" autofocus>
          <span class="field__error" data-error-for="name"></span>
        </label>
        <div class="form-error" role="alert"></div>
        <div class="sheet__actions"><button type="submit" class="btn btn--primary"><span class="spinner"></span>Uložit</button></div>
      </form>`,
    onMount(body, close) {
      const form = body.querySelector('form')
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        clearErrors(form)
        const name = form.elements.name.value.trim()
        const error = validateName(name, 'jméno')
        if (error) return setFieldError(form, 'name', error)
        const button = form.querySelector('[type="submit"]')
        setLoading(button, true)
        try {
          await updateProfile({ display_name: name })
          await updateDisplayName(name)
          showToast('Jméno uloženo')
          close()
        } catch (err) {
          form.querySelector('.form-error').textContent = translateError(err)
          setLoading(button, false)
        }
      })
    },
  })
}

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
    const name = state.profile?.display_name || ''
    const email = state.session?.user?.email ?? ''
    const theme = getThemePreference()
    el.innerHTML = `
      <header class="page-header"><h1>Nastavení</h1></header>

      <section class="card profile-card">
        <div class="avatar">${esc(initials(name || email))}</div>
        <div class="list-row__body">
          <div class="list-row__title">${esc(name || 'Bez jména')}</div>
          <div class="list-row__sub">${esc(email)}</div>
        </div>
        <button type="button" class="icon-btn" data-action="name" aria-label="Změnit jméno">${icon('pencil', { size: 18 })}</button>
      </section>

      <section class="section">
        <h2>Vzhled</h2>
        <div class="segmented" role="group" aria-label="Motiv">
          ${THEMES.map(([key, label]) => `<button type="button" data-theme-choice="${key}" aria-pressed="${theme === key}">${label}</button>`).join('')}
        </div>
      </section>

      <section class="section">
        <h2>Správa</h2>
        <div class="card card--flush">
          ${menuLink('/settings/accounts', 'wallet', 'Účty a převody')}
          ${menuLink('/settings/categories', 'tag', 'Kategorie')}
          ${menuLink('/settings/budgets', 'target', 'Rozpočty')}
          ${menuLink('/settings/recurring', 'repeat', 'Opakované platby')}
        </div>
      </section>

      <section class="section">
        <h2>Data</h2>
        <div class="card card--flush">
          ${menuButton('export-json', 'file-json', 'Exportovat zálohu (JSON)')}
          ${menuButton('import-json', 'upload', 'Importovat zálohu (JSON)')}
          ${menuButton('export-csv', 'file-spreadsheet', 'Exportovat transakce (CSV)')}
        </div>
        <input type="file" accept="application/json,.json" hidden data-import-file>
      </section>

      <section class="section">
        <h2>Účet</h2>
        <div class="card card--flush">
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
      case 'name':
        return openNameForm()
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
