# Kalkulačka peněz

Mobile-first webová aplikace (PWA) pro osobní finance: zapisování výdajů, příjmů a spoření. Uživatelé se registrují a přihlašují, data jsou uložená v Supabase a synchronizují se mezi zařízeními. Aplikaci lze nainstalovat na plochu telefonu a offline zobrazí naposledy načtená data.

## Funkce
- Registrace, přihlášení, zapomenuté heslo, změna hesla a jména, smazání účtu včetně dat
- Rychlé přidání transakce tlačítkem **+** (výdaj / příjem / převod mezi účty)
- Přehled: celkový zůstatek, příjmy a výdaje za měsíc, poslední transakce podle dnů
- Úprava a mazání transakcí, na mobilu swipe doleva = smazat (s „Zpět“)
- Kategorie s barvou a emoji – vlastní kategorii jde založit přímo při zadávání transakce (tlačítko „+ Vlastní“), správa v Nastavení s přesunem transakcí při mazání
- Více účtů a převody
- Spořicí cíle s progress barem, vklady a výběry
- Statistiky: donut výdajů podle kategorií, sloupcový graf příjmů a výdajů po měsících, filtr období a kategorie
- Měsíční rozpočty s upozorněním při 80 % a 100 %
- Opakované transakce (týdně / měsíčně), automaticky zapsané při otevření aplikace
- Export a import zálohy (JSON), export transakcí do CSV
- Světlý a tmavý režim (podle systému nebo ručně)

## Technologie
- [Vite](https://vite.dev/) + vanilla JavaScript (ES moduly)
- [SCSS (Sass)](https://sass-lang.com/) – barvy jako CSS proměnné na `:root`
- [Supabase](https://supabase.com/) – Auth + PostgreSQL s Row Level Security
- [Chart.js](https://www.chartjs.org/) – grafy
- [Lucide](https://lucide.dev/) – ikony, písmo [Inter](https://rsms.me/inter/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) – manifest a service worker
- [Vercel Speed Insights](https://vercel.com/docs/speed-insights) – měření výkonu (Core Web Vitals) na Vercelu

## Zprovoznění

### 1. Založení projektu v Supabase
1. Zaregistrujte se na [supabase.com](https://supabase.com/) a vytvořte nový projekt (region např. *Central EU (Frankfurt)*).
2. Počkejte, než se projekt připraví.

### 2. Spuštění databázového schématu
1. V Supabase otevřete **SQL Editor** → **New query**.
2. Vložte celý obsah souboru [supabase/schema.sql](supabase/schema.sql) a klikněte na **Run**.
3. Skript vytvoří tabulky, indexy, RLS politiky, trigger pro výchozí data nového uživatele (účet „Hotovost“ a kategorie) a funkce `process_recurring` a `delete_user`. Spustit ho jde i opakovaně.

### 3. Nastavení `.env`
1. V Supabase otevřete **Project Settings → API** (nebo **Connect**).
2. Zkopírujte `.env.example` do `.env`:
   ```bash
   cp .env.example .env
   ```
3. Doplňte hodnoty:
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=váš-anon-public-klíč
   ```
   Soubor `.env` je v `.gitignore` a do repozitáře se nenahrává. Anon klíč je veřejný; data chrání RLS politiky.

### 4. URL pro přesměrování (potvrzení e-mailu a reset hesla)
V Supabase otevřete **Authentication → URL Configuration**:
- **Site URL**: adresa aplikace, lokálně `http://localhost:5173`, v produkci např. `https://kalkulacka-penez.netlify.app`
- **Redirect URLs** – přidejte:
  - `http://localhost:5173/**`
  - `http://localhost:4173/**` (pro `npm run preview`)
  - produkční adresu, např. `https://kalkulacka-penez.netlify.app/**`

Odkaz pro obnovení hesla vede na `/reset-password`, potvrzení registrace na `/`.

Volitelně v **Authentication → Providers → Email** můžete vypnout *Confirm email*. Uživatel je pak po registraci rovnou přihlášen.

### 5. Spuštění aplikace
```bash
npm install
npm run dev       # vývojový server na http://localhost:5173
npm run build     # produkční build do dist/
npm run preview   # náhled buildu na http://localhost:4173 (včetně service workeru)
```

Na telefonu ve stejné Wi-Fi spusťte `npm run dev -- --host` a otevřete adresu, kterou Vite vypíše. Instalace PWA na plochu vyžaduje HTTPS (v produkci) nebo `localhost`.

### Nasazení
Aplikace je statická (složka `dist/`). Hosting musí přesměrovat všechny cesty na `index.html` (SPA fallback):
- **Netlify**: soubor `public/_redirects` s řádkem `/*  /index.html  200`
- **Vercel**: `vercel.json` s `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}`

Proměnné `VITE_SUPABASE_URL` a `VITE_SUPABASE_ANON_KEY` nastavte v administraci hostingu.

## Struktura projektu
```
index.html                 vstupní HTML (meta pro PWA, motiv před vykreslením)
vite.config.js             Vite + PWA manifest
supabase/schema.sql        tabulky, indexy, RLS, trigger a funkce
public/                    favicon a ikony PWA
src/
  main.js                  start aplikace, session, synchronizace
  router.js                router (History API) s guardem
  lib/supabase.js          Supabase klient
  services/
    auth.js                registrace, přihlášení, hesla, smazání účtu
    api.js                 načítání dat, CRUD, opakované platby
    backup.js              export/import JSON, export CSV
  state/
    store.js               globální stav + offline cache
    selectors.js           výpočty (zůstatky, součty, rozpočty)
  components/              shell (navigace), sheet, toast, feed, formulář transakce, grafy
  views/                   obrazovky (přihlášení, přehled, statistiky, spoření, nastavení…)
  utils/                   formátování, data, ikony, validace, překlad chyb, motiv
  styles/                  SCSS: tokeny, základ, layout, komponenty, obrazovky
```

## Deník změn

### 2026-11-03 – Vercel Speed Insights
- Nainstalován balíček `@vercel/speed-insights`. V `src/main.js` se volá `injectSpeedInsights()`. Projekt je Vite + vanilla JS, proto se nepoužívá komponenta pro Next.js.
- Data se sbírají jen na nasazení ve Vercelu, kde je potřeba v projektu zapnout **Speed Insights**. Lokálně skript běží v debug režimu a nic neodesílá.

### 2026-11-01 – Vlastní kategorie přímo při zadávání transakce
- V bottom sheetu transakce je na konci kategorií tlačítko „+ Vlastní“ (čárkovaný okraj, akcentová barva). Otevře malý formulář přímo v sheetu: název (max. 30 znaků), mřížka 24 emoji, 8 tlumených barev, „Zrušit“ / „Uložit“.
- Typ kategorie se bere z přepínače Výdaj / Příjem. Po uložení se kategorie zapíše do Supabase, objeví se v seznamu a rovnou se vybere. Rozepsaná částka, datum a poznámka zůstanou.
- Validace česky: prázdný název, duplicitní název v rámci typu (bez ohledu na velikost písmen). Při chybě uložení se ukáže toast a formulář zůstane otevřený.
- Nová sdílená komponenta `src/components/categoryFields.js` (pole, výběr emoji/barvy, validace). Používá ji sheet transakce i Nastavení → Kategorie.
- Nastavení → Kategorie (záložky Výdaje / Příjmy): úprava hlídá duplicity. Při mazání kategorie s transakcemi se aplikace zeptá, kam je přesunout (výchozí „Ostatní“). Přesouvají se i opakované platby. Nová funkce `reassignCategory` v `services/api.js`.
- `supabase/schema.sql`: unikátní index `categories_user_type_name_key` na `(user_id, type, lower(name))`. Ve stávajícím projektu stačí skript spustit znovu.
- Styly: mřížka emoji 6 sloupců (8 od 460 px), barvy 4 sloupce (8 od 460 px), všechny cíle 44×44 px. Vybraná barva má zvýrazněný kroužek.

### 2026-11-01 – Aplikace pro osobní finance (PWA)
- Databáze: `supabase/schema.sql` s 9 tabulkami, RLS na všech tabulkách (jen vlastní řádky), indexy na `user_id` a `date`. Cizí klíče jsou složené s `user_id`, takže nelze odkázat na data jiného uživatele.
- Trigger `handle_new_user` po registraci vytvoří profil, účet „Hotovost“ a výchozí kategorie.
- Funkce `process_recurring` zapisuje splatné opakované platby se zamykáním řádků (bez duplicit při více zařízeních). Funkce `delete_user` smaže účet včetně dat.
- Autentizace: registrace s validací, přihlášení se zobrazením hesla, reset hesla e-mailem, překlad chyb Supabase do češtiny. Session přetrvává a router chrání obrazovky.
- MVP: bottom sheet pro přidání transakce (předvybraná naposledy použitá kategorie a účet), přehled, seznam podle dnů, úprava, swipe pro smazání se „Zpět“.
- Spoření, statistiky (Chart.js), rozpočty, opakované platby, účty a převody, export/import, tmavý režim, nastavení profilu.
- PWA: manifest, ikony, service worker (vite-plugin-pwa), offline cache dat v localStorage.
- Design systém v SCSS: paleta pro světlý a tmavý režim, Inter, ikony Lucide, mobilní tab bar a desktopový sidebar.

### 2026-11-01 – Založení projektu
- Vytvořen prázdný Vite projekt (šablona vanilla JS).
- CSS nahrazeno SCSS: nainstalován `sass`, styly v `src/styles/main.scss`.
- Odstraněn demo obsah ze šablony Vite.
- Přidány `CLAUDE.md` a `README.md`.
- Založen veřejný GitHub repozitář `kalkulacka-penez`.
