import '@fontsource-variable/inter'
import './styles/main.scss'
import { registerSW } from 'virtual:pwa-register'
import { injectSpeedInsights } from '@vercel/speed-insights'

import { supabase, isConfigured } from './lib/supabase.js'
import { getState, setState, resetData } from './state/store.js'
import { loadAll, processRecurring } from './services/api.js'
import { startRouter, navigate } from './router.js'
import { showToast } from './components/toast.js'
import { watchMissingUsername } from './components/usernameSheet.js'
import { initTheme } from './utils/theme.js'
import { translateError } from './utils/errors.js'
import { formatTag } from './utils/format.js'

const app = document.querySelector('#app')

initTheme()
registerSW({ immediate: true })
injectSpeedInsights()

/** Načte data a vytvoří splatné opakované transakce. */
async function loadData() {
  await loadAll()
  showNewTag()
  try {
    const created = await processRecurring()
    if (created > 0) showToast(`Zapsáno opakovaných transakcí: ${created}`)
  } catch (err) {
    showToast(translateError(err))
  }
}

/** Po registraci ukáže přidělený tag (číslo generuje databáze). */
function showNewTag() {
  try {
    const tag = formatTag(getState().profile)
    if (!tag || !localStorage.getItem('kp-show-tag')) return
    localStorage.removeItem('kp-show-tag')
    showToast(`Vítejte! Váš tag je ${tag}`, { duration: 8000 })
  } catch {
    /* nedostupné úložiště */
  }
}

function renderConfigMissing() {
  app.innerHTML = `
    <div class="config-missing">
      <h1>Chybí nastavení Supabase</h1>
      <p class="muted" style="margin:12px 0 20px">Aplikace potřebuje připojení k databázi.</p>
      <ol>
        <li>Zkopírujte <code>.env.example</code> do <code>.env</code></li>
        <li>Doplňte <code>VITE_SUPABASE_URL</code> a <code>VITE_SUPABASE_ANON_KEY</code></li>
        <li>Restartujte <code>npm run dev</code></li>
      </ol>
      <p class="muted">Podrobný postup je v README.md.</p>
    </div>`
}

async function start() {
  if (!isConfigured) return renderConfigMissing()

  const { data } = await supabase.auth.getSession()
  setState({ session: data.session })

  supabase.auth.onAuthStateChange((event, session) => {
    const prev = getState().session
    setState({ session })

    // Supabase doporučuje v callbacku nevolat další dotazy synchronně
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') return navigate('/reset-password', { replace: true })
      if (event === 'SIGNED_OUT') {
        resetData()
        return navigate('/login', { replace: true })
      }
      if (event === 'SIGNED_IN' && prev?.user?.id !== session?.user?.id) {
        resetData()
        if (location.pathname !== '/reset-password') navigate('/', { replace: true })
      }
    }, 0)
  })

  startRouter(app, { loadData })
  watchMissingUsername()

  // Synchronizace mezi zařízeními: obnovit data při návratu do aplikace
  let lastSync = Date.now()
  const sync = () => {
    if (!getState().session || !getState().loaded || !navigator.onLine) return
    if (Date.now() - lastSync < 15_000) return
    lastSync = Date.now()
    loadData().catch(() => {})
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync()
  })
  window.addEventListener('online', () => {
    lastSync = 0
    sync()
  })
  window.addEventListener('focus', sync)
}

start().catch((err) => {
  console.error(err)
  app.innerHTML = `<div class="boot">${translateError(err)}</div>`
})
