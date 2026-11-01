# CLAUDE.md

## Projekt
**Kalkulačka peněz** – mobile-first PWA pro osobní finance (výdaje, příjmy, spoření) na Vite + vanilla JS, styly v SCSS, backend Supabase (Auth + PostgreSQL).
Repozitář: https://github.com/StepanH10/kalkulacka-penez

## Příkazy
- `npm install` – instalace závislostí
- `npm run dev` – vývojový server (http://localhost:5173)
- `npm run build` – produkční build do `dist/` (generuje i service worker)
- `npm run preview` – náhled produkčního buildu

Bez `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) aplikace zobrazí jen hlášku o chybějícím nastavení.

## Architektura
- `src/main.js` – start: motiv, session, `onAuthStateChange`, router, synchronizace při návratu do aplikace
- `src/router.js` – History API router; trasy mají `auth` (jen přihlášení) nebo `guest` (jen nepřihlášení). Chráněné obrazovky se vykreslují do shellu (`components/shell.js`).
- `src/state/store.js` – globální stav (`getState`, `setState`, `subscribe`) + offline cache v localStorage
- `src/state/selectors.js` – odvozené výpočty (zůstatky, součty, rozpočty, feed)
- `src/services/api.js` – `loadAll`, generické `createRow/updateRow/deleteRow/restoreRow` podle klíče stavu (mapování v `TABLES`)
- `src/views/*` – obrazovka = funkce `(el) => cleanup`; vykreslí HTML, přihlásí se k `subscribe` a vrátí odhlášení
- `src/components/sheet.js` – `openSheet` / `confirmDialog` pro všechny formuláře
- `supabase/schema.sql` – jediný zdroj pravdy pro DB; změny schématu psát idempotentně (`if not exists`, `create or replace`)

## Konvence
- Styly psát **pouze v SCSS** (`.scss`), žádné vlastní `.css` soubory. Barvy používat přes CSS proměnné z `styles/_tokens.scss`.
- Texty v UI a dokumentace jsou **česky**, částky přes `formatMoney` (cs-CZ, Kč), data přes `utils/dates.js` (lokální YYYY-MM-DD).
- Uživatelský text vkládaný do HTML šablon vždy escapovat pomocí `esc()`.
- Chyby pro uživatele vždy přes `translateError()`.
- Ikony přes `icon('nazev')` z `utils/icons.js`; novou ikonu Lucide nejdřív přidat do mapy `ICONS`.
- Dotykové cíle min. 44 px, animace 150–200 ms.
- **Po každé změně** přidat záznam do sekce „Deník změn“ v `README.md` (datum + co a jak se změnilo).
