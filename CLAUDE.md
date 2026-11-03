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
- `src/state/space.js` – aktuální prostor (osobní / skupina) a oprávnění: `canEdit`, `canManage`, `canModifyEntry`, `authorName`. Store drží vždy data **jen zvoleného prostoru** (`state.space`: null = osobní, jinak id skupiny). `loadAll` filtruje podle `group_id` a `createRow` doplní `group_id` sám, takže obrazovky prostor neřeší.
- `src/services/invites.js` – pozvánky (tag, odkaz/QR, přijetí, odmítnutí); RPC s limitem pokusů vrací `{ ok, message }`, služba neúspěch převede na chybu
- `src/services/notifications.js` – upozornění: přečtení a Realtime (`watchNotifications` v `main.js`); texty podle typu jsou v `components/notificationPanel.js` → nový typ upozornění = trigger v DB + větev v `describeNotification`
- `src/services/groups.js` – přepnutí prostoru, vytvoření / přejmenování / smazání skupiny, role, odebrání, opuštění, předání vlastnictví
- Nová editační akce v UI = skrýt ji podle `canEdit()` / `canManage()` / `canModifyEntry()` (databáze to hlídá vždy, UI jen nenabízí, co neprojde).
- `src/services/api.js` – `loadAll`, generické `createRow/updateRow/deleteRow/restoreRow` podle klíče stavu (mapování v `TABLES`)
- `src/views/*` – obrazovka = funkce `(el) => cleanup`; vykreslí HTML, přihlásí se k `subscribe` a vrátí odhlášení
- `src/components/sheet.js` – `openSheet` / `confirmDialog` pro všechny formuláře
- `supabase/schema.sql` – kompletní reference aktuálního stavu DB pro nový projekt od nuly (idempotentně: `if not exists`, `create or replace`)
- `supabase/migrations/NNN_nazev.sql` – změny nad existující databází s daty (`001` = původní `schema.sql`)
- Datové řádky patří buď uživateli (`user_id`, `group_id` null), nebo skupině (`group_id`, `user_id` null). Skupinová data hlídají cizí klíče `(x_id, group_id)` a politiky `*_group_*`, přístup přes `is_group_member` / `can_edit_group` / `is_group_owner`. Autora (`created_by`) a rozsah řádku nastavuje databáze triggerem, klient ne.

## Konvence
- Styly psát **pouze v SCSS** (`.scss`), žádné vlastní `.css` soubory. Barvy používat přes CSS proměnné z `styles/_tokens.scss`.
- Texty v UI a dokumentace jsou **česky**, částky přes `formatMoney` (cs-CZ, Kč), data přes `utils/dates.js` (lokální YYYY-MM-DD).
- Uživatelský text vkládaný do HTML šablon vždy escapovat pomocí `esc()`.
- Chyby pro uživatele vždy přes `translateError()`. Vlastní chyby v DB funkcích vyhazovat s `errcode = 'KPxxx'` a českou hláškou v `message` (překlad je pak zbytečný).
- Ikony přes `icon('nazev')` z `utils/icons.js`; novou ikonu Lucide nejdřív přidat do mapy `ICONS`.
- Dotykové cíle min. 44 px, animace 150–200 ms.
- **Po každé změně** přidat záznam do sekce „Deník změn“ v `README.md` (datum + co a jak se změnilo).
- **Změny databáze:** každá další změna = nový soubor `supabase/migrations/NNN_nazev.sql` s dalším pořadovým číslem (002, 003, …) a zároveň stejná úprava v `schema.sql`. Už spuštěné migrace nikdy neupravovat. Migrace musí jít bezpečně spustit nad daty: žádné `drop table`, `truncate` ani `delete`. Případné `drop policy/trigger/function` jen s `if exists` a s komentářem proč. Zabalit do `begin; … commit;`. Nikdy nenavrhovat znovu spustit celé `schema.sql` nad existující databází.
