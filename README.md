# Kalkulačka peněz

Webová aplikace pro výpočty s penězi. Projekt je zatím ve fázi základní kostry.

## Technologie
- [Vite](https://vite.dev/) – build nástroj a vývojový server
- Vanilla JavaScript
- [SCSS (Sass)](https://sass-lang.com/) – styly

## Spuštění
```bash
npm install
npm run dev       # vývojový server
npm run build     # produkční build do dist/
npm run preview   # náhled buildu
```

## Struktura projektu
```
index.html              vstupní HTML
src/main.js             vstupní JavaScript
src/styles/main.scss    hlavní styly (SCSS)
public/                 statické soubory
```

## Deník změn

### 2026-11-01 – Založení projektu
- Vytvořen prázdný Vite projekt (šablona vanilla JS).
- CSS nahrazeno SCSS: nainstalován `sass`, styly v `src/styles/main.scss`.
- Odstraněn demo obsah ze šablony Vite.
- Přidány `CLAUDE.md` a `README.md`.
- Založen veřejný GitHub repozitář `kalkulacka-penez`.
