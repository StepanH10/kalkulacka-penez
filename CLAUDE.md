# CLAUDE.md

## Projekt
**Kalkulačka peněz** – webová aplikace postavená na Vite (vanilla JavaScript) se styly v SCSS.
Repozitář: https://github.com/StepanH10/kalkulacka-penez

## Příkazy
- `npm install` – instalace závislostí
- `npm run dev` – vývojový server
- `npm run build` – produkční build do `dist/`
- `npm run preview` – náhled produkčního buildu

## Struktura
- `index.html` – vstupní HTML
- `src/main.js` – vstupní JS, importuje styly
- `src/styles/main.scss` – hlavní SCSS soubor (další partialy dávat do `src/styles/`)
- `public/` – statické soubory (favicon)

## Konvence
- Styly psát **pouze v SCSS** (`.scss`), žádné `.css` soubory.
- Texty v UI a dokumentace jsou **česky**.
- **Po každé změně** přidat záznam do sekce „Deník změn" v `README.md` (datum + co a jak se změnilo).
