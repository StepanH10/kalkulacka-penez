# Kalkulačka peněz

Mobile-first webová aplikace (PWA) pro osobní finance: zapisování výdajů, příjmů a spoření. Uživatelé se registrují a přihlašují, data jsou uložená v Supabase a synchronizují se mezi zařízeními. Aplikaci lze nainstalovat na plochu telefonu a offline zobrazí naposledy načtená data.

## Funkce
- Registrace, přihlášení, zapomenuté heslo, změna hesla, smazání účtu včetně dat
- Přezdívky s náhodným čtyřmístným číslem (tag `jana#0482`) – zobrazují se místo e-mailu, změna max. 1× za 30 dní
- Rychlé přidání transakce tlačítkem **+** (výdaj / příjem / převod mezi účty)
- Přehled: celkový zůstatek, příjmy a výdaje za měsíc, poslední transakce podle dnů
- Úprava a mazání transakcí, na mobilu swipe doleva = smazat (s „Zpět“)
- Kategorie s barvou a emoji – vlastní kategorii jde založit přímo při zadávání transakce (tlačítko „+ Vlastní“), správa v Nastavení s přesunem transakcí při mazání
- Více účtů a převody
- Upozornění v aplikaci (zvonek): pozvánky, nový člen, výdaje ve skupině, změna role, odebrání; v reálném čase přes Supabase Realtime
- Pozvánky do skupin podle tagu nebo jednorázovým odkazem s QR kódem (Sdílet, Kopírovat); čekající pozvánky na Přehledu
- Skupiny (sdílené prostory) s rolemi vlastník / editor / pozorovatel: vlastní účty, transakce, kategorie, rozpočty a cíle; přepínač prostoru nahoře v aplikaci
- Spořicí cíle s progress barem, vklady a výběry
- Statistiky: donut výdajů podle kategorií, sloupcový graf příjmů a výdajů po měsících, filtr období a kategorie
- Měsíční rozpočty s upozorněním při 80 % a 100 %
- Opakované transakce (týdně / měsíčně), automaticky zapsané při otevření aplikace
- Export a import zálohy (JSON), export transakcí do CSV
- Import transakcí z CSV výpisu banky (zatím Komerční banka): náhled, kontrola duplicit, automatické kategorie podle pravidel. Soubor se zpracuje jen v prohlížeči
- Světlý a tmavý režim (podle systému nebo ručně)

## Technologie
- [Vite](https://vite.dev/) + vanilla JavaScript (ES moduly)
- [SCSS (Sass)](https://sass-lang.com/) – barvy jako CSS proměnné na `:root`
- [Supabase](https://supabase.com/) – Auth + PostgreSQL s Row Level Security
- [Chart.js](https://www.chartjs.org/) – grafy
- [Lucide](https://lucide.dev/) – ikony, písmo [Inter](https://rsms.me/inter/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) – manifest a service worker
- [Vercel Speed Insights](https://vercel.com/docs/speed-insights) – měření výkonu (Core Web Vitals) na Vercelu

## Aplikace

Aplikace běží na **[kalkulacka-penez.vercel.app](https://kalkulacka-penez.vercel.app/)**.

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
  importers/               import CSV výpisů: jedna banka = jeden soubor (kb.js), registr, utility, kategorie
  state/
    store.js               globální stav + offline cache
    selectors.js           výpočty (zůstatky, součty, rozpočty)
  components/              shell (navigace), sheet, toast, feed, formulář transakce, grafy
  views/                   obrazovky (přihlášení, přehled, statistiky, spoření, nastavení…)
  utils/                   formátování, data, ikony, validace, překlad chyb, motiv
  styles/                  SCSS: tokeny, základ, layout, komponenty, obrazovky
tests/                     unit testy (npm test), fixtures/ s anonymizovanými výpisy
```

## Jak přidat další banku
Import výpisů je v [src/importers/](src/importers/). Každá banka je jeden soubor se stejným rozhraním a soubor nikam neodchází, vše běží v prohlížeči.

1. Vytvořte `src/importers/<banka>.js` podle vzoru [kb.js](src/importers/kb.js):
   ```js
   import { importError, parseCSV, isBlankRow, parseCzechNumber, parseCzechDate } from './utils.js'

   export default {
     id: 'fio',                 // krátké id, je i prefixem otisku duplicit („fio:<id transakce>“)
     name: 'Fio banka',         // název v nabídce bank
     encoding: 'utf-8',         // kódování CSV z banky (TextDecoder)
     detect(text) { … },        // true, když text vypadá jako výpis této banky
     parse(text) { … },         // pole { date, amount, currency, description, counterparty, variableSymbol, externalId }
     meta(text) { … },          // volitelné: { from, to } – období výpisu do náhledu
   }
   ```
   - `date` je `YYYY-MM-DD` (`parseCzechDate`). `amount` je číslo, záporné pro výdaj a kladné pro příjem (`parseCzechNumber`). `currency` je kód měny.
   - `description` se ukládá jako poznámka transakce (max. 200 znaků). `externalId` je jedinečné ID transakce z banky a slouží ke kontrole duplicit. Když ho banka nemá, nechte ho prázdné a otisk se spočítá z data, částky, protistrany a popisu.
   - Sloupce hledejte podle názvu v hlavičce, ne podle pořadí. Prázdné řádky přeskočte (`isBlankRow`).
   - Řádek, který nejde přečíst, vraťte s `error: 'Neplatné datum …'`. V náhledu se ukáže jako „přeskočí se“.
   - Chybějící hlavičku nebo jiný nečitelný formát hlaste přes `throw importError('…česky…')`.
   - Čísla karet, čísla účtů ani IBAN nevracejte.
2. Přidejte banku do pole `BANKS` v [src/importers/index.js](src/importers/index.js).
3. Uložte anonymizovanou ukázku výpisu do `tests/fixtures/<banka>-sample.csv` ve stejném kódování, jaké používá banka. Do `tests/importers.test.js` přidejte testy `detect`, `parse` a toho, že se citlivé údaje nikam nedostanou. Spusťte `npm test`.

Limity (5 MB, 2000 řádků), dekódování, duplicity, náhled i pravidla kategorií jsou společné, nová banka je nepotřebuje řešit.

## Deník změn

### 2026-11-05 – Import transakcí z CSV výpisu banky
- Ve formuláři **+** je nahoře tlačítko „Importovat z banky (CSV)“. Průběh: soubor → banka (předvybraná podle formátu) → účet z aktuálního prostoru → náhled → „Importovat X transakcí“ → toast „Importováno X, přeskočeno Y duplicit“. Soubor se zpracuje jen v prohlížeči. Pozorovatel ve skupině import nevidí.
- Náhled ukazuje u každého řádku datum, popis, částku, navrženou kategorii a stav: Nová / Duplicita – přeskočí se / Cizí měna – zkontrolujte / chyba řádku. Kategorii jde změnit a řádek odškrtnout. Po ruční změně kategorie aplikace nabídne „Zapamatovat pravidlo“ s upravitelným textem a nové pravidlo se hned použije na další řádky.
- Parser Komerční banky (`src/importers/kb.js`):
  - Kódování windows-1250, a pokud je soubor platné UTF-8, použije se UTF-8.
  - Sloupce hledá podle názvu. Datum bere z „Datum provedeni“, a když chybí, z „Datum zauctovani“.
  - Poznámka se skládá z názvu protiúčtu, zprávy pro příjemce a vlastního popisu. Typ transakce se použije, jen když je popis prázdný.
  - Číslo karty, číslo účtu, IBAN ani název účtu se nečtou.
- Registr bank (`src/importers/index.js`) s limity 5 MB a 2000 řádků a srozumitelnými chybami (neznámý formát, prázdný soubor, chybí hlavička). Společné utility jsou v `src/importers/utils.js`, návrh kategorií v `src/importers/categorize.js`.
- Duplicity:
  - Otisk řádku je `kb:<Identifikace transakce>`, bez ní hash z data, částky, protistrany a popisu s pořadím stejných plateb.
  - Náhled označí duplicity z dřívějších importů do stejného účtu i duplicity uvnitř souboru.
  - Vkládá se přes `upsert` s `ignoreDuplicates` (`on conflict (account_id, import_hash) do nothing`), takže se nic nezdvojí ani při souběhu.
- Automatické kategorie: hledá se text v popisu nebo protistraně bez ohledu na velikost písmen a diakritiku. Pravidla se použijí jen u transakcí stejného typu (výdaj / příjem) a při více shodách vyhrává nejdelší. Bez pravidla se použije „Ostatní“ příslušného typu.
- Nastavení → **Pravidla importu**: seznam, přidání, úprava a mazání. Pravidla patří do aktuálního prostoru (osobní / skupina) a jsou i v JSON záloze.
- Unit testy (`npm test`, vestavěný `node --test`): `tests/importers.test.js` s anonymizovanou ukázkou `tests/fixtures/kb-sample.csv` (windows-1250).
- V README je nový návod „Jak přidat další banku“.

### 2026-11-05 – Migrace 008: import z CSV (databáze)
- Nová migrace `supabase/migrations/008_csv_import.sql`, stejná úprava je v `schema.sql`.
- `transactions.import_hash` je otisk importovaného řádku výpisu. Unikátní `(account_id, import_hash)` brání tomu, aby se stejná transakce dostala do stejného účtu dvakrát. Ručně zadané transakce mají `import_hash` null a omezení se jich netýká.
- Nová tabulka `import_rules` (text → kategorie) je osobní nebo skupinová stejně jako ostatní data. Rozsah hlídají stávající triggery `set_row_scope`/`keep_row_scope`. Osobní pravidla vidí jen vlastník, skupinová čtou všichni členové a měnit je smí vlastník a editoři. Smazáním kategorie se smažou i její pravidla.
- `notify_group_expense`: importované výdaje ve skupině neposílají upozornění po jednom.

### 2026-11-04 – Migrace 007: triggerové funkce bez práva EXECUTE
- Na hlášení Supabase Security Advisoru nová migrace `supabase/migrations/007_revoke_trigger_functions.sql`. U triggerových funkcí `enforce_group_limits`, `handle_new_user`, `handle_user_deleting`, `notify_group_expense`, `notify_invite_events` a `notify_member_events` odebírá EXECUTE pro `public`, `anon` a `authenticated`, takže je nejde zavolat přes RPC.
- Triggery fungují dál, protože Postgres právo na funkci kontroluje jen při vytvoření triggeru. Pomocné funkce RLS (`is_group_member`, `can_edit_group`, `is_group_owner`) ani RPC funkce aplikace se nemění.
- Stejné `revoke` je doplněné v `schema.sql` u každého triggeru. V `CLAUDE.md` přibylo pravidlo, že každá nová triggerová funkce musí mít `revoke execute`.

### 2026-11-04 – README: odkaz na aplikaci
- Sekce „Zprovoznění“ (Supabase, `.env`, přesměrování, spuštění, nasazení) nahrazena odkazem na nasazenou aplikaci https://kalkulacka-penez.vercel.app/.

### 2026-11-03 – .gitignore
- Do `.gitignore` přidány `.claude/` a `skills-lock.json` (lokální nastavení nástrojů, nepatří do repozitáře).

### 2026-11-03 – Upozornění: UI (fáze 5)
- Zvonek vpravo v liště nad obsahem s počtem nepřečtených (9+). Panel se seznamem posledních 50 upozornění, nepřečtená jsou zvýrazněná tečkou, u každého je relativní čas („před 5 minutami“).
- „Označit vše jako přečtené“ (`update read_at … where read_at is null`). Klik na upozornění ho označí jako přečtené a otevře příslušnou skupinu: výdaj vede na Transakce, nový člen na Nastavení skupiny.
- Pozvánky mají v panelu přímo tlačítka Přijmout / Odmítnout, dokud pozvánka čeká.
- Načítání při otevření a návratu do aplikace (`loadAll`). Nová upozornění chodí přes Supabase Realtime (`postgres_changes`, INSERT, filtr na přihlášeného) s krátkým toastem. Podle typu se dočte, co se změnilo: pozvánky, skupiny a role, nebo data zvolené skupiny při novém výdaji.
- Nové soubory: `src/services/notifications.js` (označení přečtení, Realtime) a `src/components/notificationPanel.js` (texty podle typu, zvonek, panel).

### 2026-11-03 – Migrace 006: upozornění (fáze 5 – databáze)
- Tabulka `notifications` (user_id, type, data jsonb, read_at). RLS: každý vidí jen svá upozornění a smí u nich měnit jen `read_at`. Vytvářejí je výhradně triggery.
- Typy a triggery:
  - `invite_received`: nová pozvánka podle tagu.
  - `invite_accepted`: přijetí mé pozvánky, tagem i odkazem, s tagem toho, kdo se připojil.
  - `group_expense`: nový výdaj ve skupině všem ostatním členům, kromě výdajů z opakovaných plateb.
  - `role_changed`: změna mé role (kromě vlastní změny při předání vlastnictví).
  - `member_removed`: odebrání ze skupiny (ne při vlastním odchodu ani při smazání celé skupiny).
- Odmítnutí a vypršení pozvánky se odesílateli neoznamují.
- `data` obsahuje název skupiny a přezdívky v okamžiku události, nikdy e-maily.
- Tabulka se přidá do publikace `supabase_realtime`, nová upozornění tak mohou chodit hned.
- Ověřeno v PGlite: migrace 002 → 006 (006 dvakrát) a 26 kontrol.

### 2026-11-03 – Pozvánky: UI (fáze 4)
- Přehled: banner s čekajícími pozvánkami („bara#2479 vás zve jako editora“) s tlačítky Přijmout / Odmítnout. Po přijetí toast s akcí „Přepnout“ do skupiny.
- Nastavení → Skupina (vlastník):
  - Pozvání podle celého tagu s volbou role. Chybné hlášky jdou z databáze, např. „Uživatel nenalezen.“
  - „Pozvat odkazem nebo QR kódem“: volba role, QR kód (tmavý na bílém i v tmavém režimu), Sdílet (Web Share API, je-li k dispozici) a Kopírovat odkaz.
  - Přehled pozvánek: čekající lze zneplatnit, u ostatních stav a kdo odkaz použil.
- Stránka `/join/<token>`: název skupiny a role, „Připojit se“ (pak přepne do skupiny). Neplatný, použitý i prošlý odkaz má stejnou hlášku.
- Nepřihlášený uživatel s odkazem `/join/…` se po přihlášení (i po potvrzení e-mailu v nové záložce) vrátí zpět na pozvánku (`kp-return` v localStorage, platnost 1 h).
- Nová služba `src/services/invites.js`. RPC s výsledkem `{ ok, message }` převádí neúspěch na chybu s hláškou z databáze.
- Knihovna `qrcode` se načítá až při vytvoření odkazu (samostatný chunk), ne při startu aplikace.

### 2026-11-03 – Migrace 005: pozvánky do skupin (fáze 4 – databáze)
- Tabulka `group_invites`: pozvánka podle tagu (`invited_user_id`), nebo jednorázovým odkazem (`token_hash`). Stavy pending / accepted / declined / expired / revoked, `accepted_by`, `used_at`. Klient do ní nezapisuje, čte jen vlastník skupiny a pozvaný (RLS).
- Odkaz: token má 64 hex znaků (2× `gen_random_uuid`, kryptograficky bezpečný generátor) a ukládá se jen jeho SHA-256. Platí 24 h, po prvním použití zanikne a vlastník ho může zneplatnit.
- RPC: `invite_by_tag` (jen přesná shoda přezdívka + číslo, jinak „Uživatel nenalezen.“, platnost 7 dní), `create_invite_link`, `revoke_invite`, `preview_invite_token`, `accept_invite_token`, `accept_invite`, `decline_invite`, `get_my_invites`, `get_group_invites`.
- Limity v databázi: pozvání podle tagu 10/h, odkazy 10/h, pokusy o token (náhled + přijetí) 20/h. Funkce s limitem vrací při neúspěchu `{ ok: false, message }` místo chyby, aby se pokus nevrátil zpět a limit fungoval i proti hádání.
- Limity skupiny (10 členů, 5 skupin) při přijetí vrací českou hlášku.
- Ověřeno v PGlite: nový projekt, migrace 002 → 005 (005 dvakrát) a 35 kontrol se 5 uživateli.

### 2026-11-03 – Skupiny: UI (fáze 3)
- Přepínač prostoru nad obsahem každé obrazovky: „Osobní“, moje skupiny s rolí a „Vytvořit skupinu“ (max. 5). Zvolený prostor se pamatuje v localStorage (`kp-space-<uživatel>`). Když uživatele ze skupiny odeberou, aplikace se sama vrátí do osobního prostoru.
- Store drží data jen zvoleného prostoru: `loadAll` načítá podle `group_id` a ve skupině i členy (`get_group_members`). `createRow` doplní `group_id`. Offline cache je zvlášť pro každý prostor. Přehled, transakce, statistiky, spoření, kategorie, rozpočty i formulář transakce tak pracují s aktuálním prostorem bez dalších úprav.
- Oprávnění v `src/state/space.js`. Pozorovatel nevidí tlačítko +, přidávání ani úpravy a v liště má štítek „Pouze pro čtení“. Editor upravuje a maže jen vlastní transakce, převody a vklady. Mazat účty, kategorie, rozpočty, cíle a opakované platby může jen vlastník.
- Ve skupině je u transakcí, převodů a vkladů přezdívka autora. Kdo už není členem, zobrazí se jako „Bývalý člen“.
- Statistiky skupiny mají navíc sekci „Výdaje podle členů“ (částka, podíl, pruh).
- Nastavení → Skupina (`/settings/group`). Vlastník: přejmenování, členové s volbou role Editor / Pozorovatel, předání vlastnictví, odebrání člena, smazání skupiny s potvrzením přepsáním názvu. Ostatní: seznam členů a „Opustit skupinu“. Import zálohy je ve skupině skrytý.
- `confirmDialog({ requireText })` porovnává text bez ohledu na velikost písmen (kvůli názvu skupiny).
- Bez změny databáze, používá migraci 004.

### 2026-11-03 – Migrace 004: skupiny (fáze 2 – databáze a RLS)
- Nové tabulky `groups` a `group_members` (role owner / editor / viewer, právě jeden owner na skupinu).
- Datové tabulky dostaly `group_id`. Řádek patří buď uživateli (`user_id`), nebo skupině (`group_id`, `user_id` null). Hlídá to kontrola `*_scope_check`. Stávající osobní data, cizí klíče i RLS politiky se nemění.
- Paralelní cizí klíče `(x_id, group_id)`: skupinová transakce smí odkazovat jen na účet a kategorii téže skupiny a osobní záznam jen na vlastní.
- `created_by` u transakcí, převodů a vkladů do spoření (osobní = `user_id`, ve skupině = přihlášený uživatel). Nastavuje ho trigger a nejde přepsat. Stávající řádky dostaly `created_by = user_id`.
- Triggery `set_row_scope` / `keep_row_scope`: skupinový řádek nemá `user_id` a záznam nejde přesunout mezi osobními daty a skupinou.
- RLS politiky `*_group_*`: čtou všichni členové, zapisují owner a editor, transakce upravuje autor nebo owner, účty, kategorie, rozpočty, cíle a opakované platby maže jen owner. Viewer nezapisuje nic.
- Funkce `is_group_member`, `can_edit_group`, `is_group_owner`. RPC `create_group` (skupina, owner, „Společný účet“, výchozí kategorie, limit 5 za den), `transfer_ownership` a `get_group_members` (přezdívky bez e-mailů).
- Limity triggerem: max. 10 členů ve skupině, max. 5 skupin na uživatele.
- Smazání účtu vlastníka předá skupinu dalšímu členovi (trigger `on_auth_user_deleting`). Skupina bez dalších členů se smaže i s daty.
- `process_recurring` zpracuje i skupinové opakované platby (editor / owner).
- Index `categories_user_type_name_key` nahradily částečné indexy `categories_personal_name_key` a `categories_group_name_key`.
- Ověřeno v PGlite (PostgreSQL ve WASM): nový projekt, migrace 002 → 004 nad daty, opakované spuštění a 49 kontrol oprávnění se třemi uživateli.

### 2026-11-03 – Migrace 003: unikátní názvy kategorií
- `supabase/migrations/003_categories_unique.sql` doplní do existující databáze index `categories_user_type_name_key` na `(user_id, type, lower(name))`. V `schema.sql` už byl, do živé databáze se ale nedostal.
- Migrace nejdřív zkontroluje duplicity. Pokud nějaké najde, skončí chybou a nic nezmění. Duplicity je nutné vyřešit ručně (přejmenovat, nebo sloučit), automaticky se nic nemaže.

### 2026-11-03 – Migrace místo opakovaného spouštění schématu
- Změny fáze 1 jsou v samostatné migraci `supabase/migrations/002_nicknames.sql` (v transakci, bez `drop`, `truncate` a `delete`). Kontroly formátu se přidávají přes `pg_constraint` místo `drop constraint`.
- `check_rate_limit` už staré záznamy nemaže, jen počítá pokusy v daném časovém okně.
- `schema.sql` zůstává kompletní referencí pro nový projekt. Konvence pro migrace je v `CLAUDE.md`.

### 2026-11-03 – Přezdívky (fáze 1 sdílených prostorů)
- `profiles`: nové sloupce `username` (3–20 znaků: písmena bez diakritiky, číslice, `_`, `.`), `discriminator` (4 číslice jako text) a `username_changed_at`. Unikátní index `profiles_tag_key` na `(lower(username), discriminator)`, kontroly formátu a rezervovaných jmen přímo v tabulce.
- Klient smí v profilu měnit už jen `display_name` (column-level `grant`). Přezdívku a číslo nastavuje výhradně databáze:
  - `handle_new_user` vezme přezdívku z registrace a přidělí náhodné číslo. Neplatná nebo obsazená přezdívka registraci neshodí, uživatel ji pak doplní v okně.
  - RPC `set_username(p_username)` ověří formát a rezervovaná jména. Při změně ponechá číslo, pokud je kombinace volná, jinak vybere nové náhodné (`pick_discriminator`, nikdy pořadově, při souběhu zkusí znovu). První nastavení se do limitu nepočítá.
- Rate limit: tabulka `rate_limits` (bez přístupu pro klienta) a funkce `check_rate_limit(action, max, interval)`. Změna přezdívky max. 1× za 30 dní, při překročení „Příliš mnoho pokusů, zkuste to později.“
- Chyby z vlastních DB funkcí mají kód `KPxxx` a českou hlášku. `translateError` ji zobrazí beze změny.
- Registrace: pole „Přezdívka“ místo „Zobrazované jméno“, s živým náhledem `jmeno#????`. Přidělený tag se ukáže v toastu po prvním načtení dat.
- Uživatel bez přezdívky dostane po přihlášení okno, které nejde zavřít (jen „Odhlásit se“). `openSheet` má novou volbu `dismissible: false`.
- Nastavení: tag s tlačítkem Kopírovat, změna přezdívky (při zámku ukáže datum další možné změny). Vlastní e-mail je jen v sekci Účet jako „vidíte jen vy“. Pozdrav na Přehledu používá přezdívku.
- Nová komponenta `src/components/usernameSheet.js`. Odstraněna změna zobrazovaného jména (`updateProfile`, `updateDisplayName`).

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
