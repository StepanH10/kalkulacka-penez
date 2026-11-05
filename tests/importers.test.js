// Unit testy importu CSV výpisů: npm test (node --test, bez dalších závislostí)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import kb from '../src/importers/kb.js'
import { BANKS, readStatement, parseStatement, MAX_ROWS } from '../src/importers/index.js'
import { parseCSV, parseCzechNumber, parseCzechDate, normalizeText, decodeBytes, decodeUnknown, importHashes } from '../src/importers/utils.js'
import { suggestCategory, findRule, sameRule, rowType, ruleTextFor } from '../src/importers/categorize.js'

const fixture = readFileSync(new URL('./fixtures/kb-sample.csv', import.meta.url))
const fakeFile = (bytes) => ({ size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
const kbText = () => decodeBytes(fixture, kb.encoding)

// ---------------------------------------------------------------- utility

test('parseCzechNumber: čárka, znaménko, mezery tisíců', () => {
  assert.equal(parseCzechNumber('-49,8'), -49.8)
  assert.equal(parseCzechNumber('1275'), 1275)
  assert.equal(parseCzechNumber('-1 234,50'), -1234.5)
  assert.equal(parseCzechNumber('12 345,6'), 12345.6)
  assert.equal(parseCzechNumber('+10'), 10)
  assert.ok(Number.isNaN(parseCzechNumber('')))
  assert.ok(Number.isNaN(parseCzechNumber('1.234,5')))
  assert.ok(Number.isNaN(parseCzechNumber('abc')))
})

test('parseCzechDate: DD.MM.YYYY → YYYY-MM-DD, neplatné → null', () => {
  assert.equal(parseCzechDate('01.10.2026'), '2026-10-01')
  assert.equal(parseCzechDate('5.3.2026'), '2026-03-05')
  assert.equal(parseCzechDate('31.02.2026'), null)
  assert.equal(parseCzechDate('2026-10-01'), null)
  assert.equal(parseCzechDate(''), null)
})

test('parseCSV: středník, koncový oddělovač, uvozovky, CRLF', () => {
  assert.deepEqual(parseCSV('a;b;\r\nc;"d;e";"f ""g"""\n'), [
    ['a', 'b', ''],
    ['c', 'd;e', 'f "g"'],
  ])
})

test('normalizeText: bez diakritiky a velikosti písmen', () => {
  assert.equal(normalizeText('  Příchozí   ÚHRADA '), 'prichozi uhrada')
  assert.equal(normalizeText('LÍDL'), 'lidl')
})

test('dekódování: windows-1250 i UTF-8 verze téhož výpisu', () => {
  assert.ok(kbText().includes('Mobilní platba'))
  const utf8 = new TextEncoder().encode(kbText())
  assert.ok(decodeBytes(utf8, 'windows-1250').includes('Příchozí úhrada'), 'UTF-8 soubor se pozná i při kódování banky windows-1250')
  assert.ok(decodeUnknown(fixture).includes('Příchozí úhrada'), 'bez banky vybere windows-1250 (UTF-8 by dalo „�“)')
  assert.ok(decodeUnknown(utf8).includes('Příchozí úhrada'))
  assert.ok(!decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), 'utf-8').startsWith('﻿'))
})

// ---------------------------------------------------------------- KB

test('KB detect: hlavička souboru nebo řádek s hlavičkou transakcí', () => {
  assert.equal(kb.detect(kbText()), true)
  assert.equal(kb.detect('﻿KB+, vypis v csv. formatu;;'), true)
  assert.equal(kb.detect('něco\nDatum zauctovani;Datum provedeni;Castka\n'), true)
  assert.equal(kb.detect('Datum;Částka;Popis\n1.1.2026;100;x'), false)
})

test('KB parse: ukázkový výpis', () => {
  const rows = kb.parse(kbText())
  assert.equal(rows.length, 4)
  assert.deepEqual(rows[0], {
    date: '2026-10-01',
    amount: -49.8,
    currency: 'CZK',
    description: 'Lidl dekuje za nakup',
    counterparty: 'Lidl dekuje za nakup',
    variableSymbol: '',
    externalId: '5300000001',
  })
  // datum provedení (30. 9.) má přednost před datem zaúčtování (2. 10.)
  assert.equal(rows[1].date, '2026-09-30')
  assert.equal(rows[1].amount, -27.9)
  assert.deepEqual(
    { ...rows[2] },
    {
      date: '2026-10-02',
      amount: 1275,
      currency: 'CZK',
      description: 'ZAMESTNAVATEL S.R.O. – výplata 9/2026',
      counterparty: 'ZAMESTNAVATEL S.R.O.',
      variableSymbol: '11111111',
      externalId: 'SGWD000000000001',
    },
  )
  assert.equal(rows[3].description, 'Jan Novák')
})

test('KB parse: číslo karty, účtu, IBAN ani název účtu se nikam nedostanou', () => {
  const dump = JSON.stringify(kb.parse(kbText())) + JSON.stringify(kb.meta(kbText()))
  for (const secret of ['519211', '******', '999999999', 'CZ2121', 'PETR NOVAK', '123456/0600', '987654321/3030']) {
    assert.ok(!dump.includes(secret), `výstup obsahuje ${secret}`)
  }
})

test('KB meta: období výpisu', () => {
  const { from, to } = kb.meta(kbText())
  assert.deepEqual({ from, to }, { from: '2026-10-01', to: '2026-10-31' })
})

const KB_HEAD = 'Datum zauctovani;Datum provedeni;Protistrana;Nazev protiuctu;Castka;Mena;VS;Identifikace transakce;Typ transakce;Popis pro me;Zprava pro prijemce'

test('KB parse: sloupce podle názvu, ne podle pořadí', () => {
  const text = 'Typ transakce;Castka;Nazev protiuctu;Datum provedeni;Datum zauctovani;Identifikace transakce;Mena\nPlatba kartou;-1 250,00;Albert;03.10.2026;04.10.2026;X1;CZK\n'
  const [r] = kb.parse(text)
  assert.equal(r.amount, -1250)
  assert.equal(r.date, '2026-10-03')
  assert.equal(r.counterparty, 'Albert')
  assert.equal(r.externalId, 'X1')
})

test('KB parse: popis – spojení částí, typ jen když je popis prázdný, prázdné datum provedení', () => {
  const text = `${KB_HEAD}\n02.10.2026;;;;-100;CZK;;A1;Výběr z bankomatu;;\n02.10.2026;01.10.2026;;Nájem;-9000;CZK;;A2;Trvalý příkaz;můj nájem;říjen\n;;;;;;;;;;\n;;;\n`
  const rows = kb.parse(text)
  assert.equal(rows.length, 2, 'prázdné řádky a řádky jen se středníky se ignorují')
  assert.equal(rows[0].description, 'Výběr z bankomatu')
  assert.equal(rows[0].date, '2026-10-02', 'bez data provedení se vezme datum zaúčtování')
  assert.equal(rows[1].description, 'Nájem – říjen – můj nájem')
})

test('KB parse: cizí měna a neplatné řádky', () => {
  const text = `${KB_HEAD}\n02.10.2026;01.10.2026;;Shop;-10,5;EUR;;B1;Platba;;\n02.10.2026;xx;;Shop;-1;CZK;;B2;Platba;;\n02.10.2026;01.10.2026;;Shop;0;CZK;;B3;Platba;;\n`
  const rows = kb.parse(text)
  assert.equal(rows[0].currency, 'EUR')
  assert.equal(rows[0].error, undefined)
  assert.match(rows[1].error, /Neplatné datum/)
  assert.match(rows[2].error, /Nulová částka/)
})

test('KB parse: chybí hlavička → česká chyba', () => {
  assert.throws(() => kb.parse('KB+, vypis v csv. formatu;;\nCislo uctu;1;;\n'), (e) => /chybí hlavička/.test(e.czMessage))
})

// ---------------------------------------------------------------- registr

test('readStatement: pozná KB, chyby pro prázdný a velký soubor', async () => {
  const { bank } = await readStatement(fakeFile(fixture))
  assert.equal(bank, BANKS.find((b) => b.id === 'kb'))
  await assert.rejects(readStatement(fakeFile(new Uint8Array())), (e) => e.czMessage === 'Soubor je prázdný.')
  await assert.rejects(readStatement({ size: 6 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }), (e) => /5 MB/.test(e.czMessage))
  const unknown = await readStatement(fakeFile(new TextEncoder().encode('Datum;Částka\n1.1.2026;5\n')))
  assert.equal(unknown.bank, null)
})

test('parseStatement: neznámý formát, cizí soubor, prázdný výpis, limit řádků', () => {
  assert.throws(() => parseStatement(fixture, null), (e) => /Neznámý formát/.test(e.czMessage))
  assert.throws(() => parseStatement(new TextEncoder().encode('a;b\n1;2\n'), kb), (e) => /nevypadá jako výpis/.test(e.czMessage))
  assert.throws(() => parseStatement(new TextEncoder().encode(`${KB_HEAD}\n;;;\n`), kb), (e) => /žádné transakce/.test(e.czMessage))
  const many = `${KB_HEAD}\n${Array.from({ length: MAX_ROWS + 1 }, (_, i) => `01.10.2026;01.10.2026;;X;-1;CZK;;I${i};P;;`).join('\n')}\n`
  assert.throws(() => parseStatement(new TextEncoder().encode(many), kb), (e) => /nejvýše 2000/.test(e.czMessage))
  const { rows, meta } = parseStatement(fixture, kb)
  assert.equal(rows.length, 4)
  assert.equal(meta.from, '2026-10-01')
})

// ---------------------------------------------------------------- duplicity

test('importHashes: kb:<id>, bez id hash s pořadím stejných plateb', () => {
  const rows = kb.parse(kbText())
  assert.deepEqual(importHashes('kb', rows), ['kb:5300000001', 'kb:5300000002', 'kb:SGWD000000000001', 'kb:SGWD000000000002'])
  const coffee = { date: '2026-10-01', amount: -55, counterparty: 'Kavárna', description: 'Kavárna' }
  const [a, b, c] = importHashes('kb', [coffee, { ...coffee }, { ...coffee, amount: -60 }])
  assert.match(a, /^kb:h:[0-9a-f]+:1$/)
  assert.equal(b, a.replace(/:1$/, ':2'), 'dvě stejné platby se odliší pořadím')
  assert.notEqual(c.slice(0, -2), a.slice(0, -2))
  assert.deepEqual(importHashes('kb', [coffee, coffee]), [a, b], 'opakovaný import dá stejné otisky')
  assert.equal(importHashes('kb', [{ ...coffee, description: 'KAVÁRNA' }])[0], a, 'velikost písmen a diakritika hash nemění')
})

// ---------------------------------------------------------------- kategorie

const categories = [
  { id: 'food', name: 'Jídlo', type: 'expense' },
  { id: 'shop', name: 'Nákupy', type: 'expense' },
  { id: 'other-e', name: 'Ostatní', type: 'expense' },
  { id: 'salary', name: 'Výplata', type: 'income' },
  { id: 'other-i', name: 'Ostatní', type: 'income' },
]

test('suggestCategory: pravidlo bez ohledu na velikost písmen a diakritiku', () => {
  const rules = [{ id: 'r1', match_text: 'LÍDL', category_id: 'food' }]
  assert.equal(suggestCategory({ amount: -49.8, counterparty: 'Lidl dekuje za nakup', description: '' }, rules, categories), 'food')
})

test('suggestCategory: bez pravidla „Ostatní“ podle znaménka', () => {
  assert.equal(suggestCategory({ amount: -10, counterparty: 'Neznámý', description: '' }, [], categories), 'other-e')
  assert.equal(suggestCategory({ amount: 10, counterparty: 'Neznámý', description: '' }, [], categories), 'other-i')
  assert.equal(rowType({ amount: -1 }), 'expense')
  assert.equal(rowType({ amount: 1 }), 'income')
})

test('findRule: jen pravidla stejného typu, nejdelší shoda vyhrává', () => {
  const rules = [
    { id: 'a', match_text: 'zamestnavatel', category_id: 'salary' },
    { id: 'b', match_text: 'lidl', category_id: 'shop', created_at: '2026-01-01' },
    { id: 'c', match_text: 'lidl dekuje', category_id: 'food', created_at: '2025-01-01' },
  ]
  assert.equal(findRule({ amount: -5, counterparty: 'ZAMESTNAVATEL S.R.O.' }, rules, categories), null, 'příjmové pravidlo se na výdaj nepoužije')
  assert.equal(findRule({ amount: 1275, counterparty: 'ZAMESTNAVATEL S.R.O.' }, rules, categories).id, 'a')
  assert.equal(findRule({ amount: -5, counterparty: 'Lidl dekuje za nakup' }, rules, categories).id, 'c')
  assert.equal(findRule({ amount: -5, counterparty: '', description: 'platba LIDL' }, rules, categories).id, 'b', 'hledá i v popisu')
})

test('sameRule a ruleTextFor', () => {
  const rules = [{ id: 'a', match_text: 'Lidl', category_id: 'food' }]
  assert.equal(sameRule('LÍDL', 'expense', rules, categories)?.id, 'a')
  assert.equal(sameRule('lidl', 'income', rules, categories), null)
  assert.equal(ruleTextFor({ counterparty: '', description: 'x'.repeat(80) }).length, 60)
})

// ---------------------------------------------------------------- obecné utility (univerzální import, Revolut)

test('parseNumber: běžné zápisy čísel', async () => {
  const { parseNumber } = await import('../src/importers/utils.js')
  const cases = [
    ['-1 234,50', 'auto', -1234.5],
    ['1.234,50', 'auto', 1234.5],
    ['1,234.50', 'auto', 1234.5],
    ['-49.80', '.', -49.8],
    ['123,45-', 'auto', -123.45],
    ['1 234,50-', ',', -1234.5],
    ['(12,50)', 'auto', -12.5],
    ['−5', 'auto', -5],
    ['1 275 Kč', 'auto', 1275],
    ['-1,25 CZK', 'auto', -1.25],
    ['+10', ',', 10],
  ]
  for (const [input, dec, expected] of cases) assert.equal(parseNumber(input, dec), expected, input)
  for (const bad of ['', 'abc', '1,5,6', '12.34.5', '1.23,4.5']) assert.ok(Number.isNaN(parseNumber(bad)), bad)
})

test('parseDate / detectDateFormat / detectDecimal', async () => {
  const { parseDate, detectDateFormat, detectDecimal } = await import('../src/importers/utils.js')
  assert.equal(parseDate('1.10.2026'), '2026-10-01')
  assert.equal(parseDate('01.10.2026 12:30'), '2026-10-01')
  assert.equal(parseDate('2026-10-01 08:15:59'), '2026-10-01')
  assert.equal(parseDate('2026-10-01T08:15:59Z'), '2026-10-01')
  assert.equal(parseDate('31.02.2026'), null)
  assert.equal(parseDate('2026-10-01', 'dmy'), null)
  assert.equal(detectDateFormat(['2026-10-01', '2026-10-02 10:00']), 'ymd')
  assert.equal(detectDateFormat(['1.10.2026', '15.10.2026']), 'dmy')
  assert.equal(detectDateFormat(['abc']), null)
  assert.equal(detectDecimal(['-49.80', '1275', '12.5']), '.')
  assert.equal(detectDecimal(['-49,80', '1 275']), ',')
})

test('KB meta: počáteční a konečný zůstatek', () => {
  const meta = kb.meta(kbText())
  assert.equal(meta.opening, 20000.53)
  assert.equal(meta.closing, 30000.89)
})

// ---------------------------------------------------------------- ABO / GPC

const gpcFile = (name) => readFileSync(new URL(`./fixtures/${name}.gpc`, import.meta.url))
const gpcParse = async (name, options = {}) => {
  const { default: gpc } = await import('../src/importers/gpc.js')
  const bytes = gpcFile(name)
  const text = decodeBytes(bytes, gpc.encoding)
  return { gpc, text, bytes, rows: gpc.parse(text, { bytes, ...options }), meta: gpc.meta(text, { bytes }) }
}

test('GPC detect: ABO soubor ano (i s hlavičkou UHL1), CSV ne', async () => {
  const { default: gpc } = await import('../src/importers/gpc.js')
  for (const f of ['gpc-standard', 'gpc-cs', 'gpc-fio']) assert.equal(gpc.detect(decodeBytes(gpcFile(f), 'windows-1250')), true, f)
  assert.equal(gpc.detect(kbText()), false)
  assert.equal(gpc.detect('075 krátký řádek'), false)
})

test('GPC standard: částky v haléřích, kódy 1/2/4/5 včetně storen, 076/078/079', async () => {
  const { gpc, text, bytes, rows } = await gpcParse('gpc-standard')
  assert.equal(gpc.detectVariant(text, { bytes }), 'standard')
  assert.deepEqual(rows.map((r) => r.amount), [-49.8, 1275, 49.8, -100, -27.9])
  assert.deepEqual(rows.map((r) => r.date), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])
  assert.ok(rows.every((r) => r.currency === 'CZK' && !r.error))
  assert.equal(rows[0].description, 'LIDL DEKUJE ZA NAKUP')
  assert.equal(rows[1].counterparty, 'Zaměstnavatel s.r.o.', 'název z 076, diakritika z windows-1250')
  assert.equal(rows[1].description, 'Zaměstnavatel s.r.o. – výplata 9/2026 Loučení s létem druhá část zprávy')
  assert.equal(rows[1].variableSymbol, '11111111')
  assert.match(rows[2].description, /^Storno – /, 'storno debetu = peníze zpět')
  assert.equal(rows[3].description, 'STORNO PRIJMU', 'popis se slovem storno bez zdvojení')
})

test('GPC: otisk = účet + datum + částka + číslo dokladu, bez dokladu hash', async () => {
  const { rows } = await gpcParse('gpc-standard')
  assert.equal(rows[0].externalId, '123456789:2026-10-01:-4980:101')
  assert.equal(rows[4].externalId, '', 'doklad 0 → společný hash z data, částky a popisu')
  const hashes = importHashes('gpc', rows)
  assert.equal(hashes[0], 'gpc:123456789:2026-10-01:-4980:101')
  assert.match(hashes[4], /^gpc:h:/)
})

test('GPC meta: zůstatky z hlavičky 074 a kontrola pohybů', async () => {
  const { balanceCheck } = await import('../src/importers/index.js')
  const { rows, meta } = await gpcParse('gpc-standard')
  assert.equal(meta.opening, 20000.53)
  assert.equal(meta.closing, 21147.63)
  assert.equal(meta.from, '2026-10-01')
  assert.equal(meta.to, '2026-10-31')
  assert.deepEqual(balanceCheck(rows, meta), { opening: 20000.53, closing: 21147.63, sum: 1147.1, diff: 0, ok: true })
})

test('GPC Česká spořitelna: kódy 3 = storno debetu, 4 = storno kreditu', async () => {
  const { gpc, text, bytes, rows, meta } = await gpcParse('gpc-cs')
  assert.equal(gpc.detectVariant(text, { bytes }), 'cs', 'kód 3 používá jen ČS')
  assert.deepEqual(rows.map((r) => r.amount), [-500, 2000, 500, -300])
  assert.equal(rows[1].counterparty, 'Šťastný Účetní a.s.')
  assert.ok(rows.every((r) => r.currency === 'CZK'), 'v bajtech 118–122 má ČS jiná pole → CZK')
  const { balanceCheck } = await import('../src/importers/index.js')
  assert.equal(balanceCheck(rows, meta).ok, true)
})

test('GPC: stejný soubor ve špatném dialektu nesedí na zůstatky', async () => {
  const { balanceCheck } = await import('../src/importers/index.js')
  const { rows, meta } = await gpcParse('gpc-cs', { variant: 'standard' })
  assert.match(rows[2].error, /Neznámý kód zaúčtování „3“/)
  assert.equal(rows[3].amount, 300, 'kód 4 by standard četl jako storno debetu')
  assert.equal(balanceCheck(rows, meta).ok, false)
})

test('GPC: ČS bez kódu 3 – dialekt rozhodne kontrola zůstatků', async () => {
  const { gpc, text, bytes } = await gpcParse('gpc-cs-bez-storna-debetu')
  assert.equal(gpc.detectVariant(text, { bytes }), 'cs')
  const { rows } = await gpcParse('gpc-cs-bez-storna-debetu', { variant: 'cs' })
  assert.deepEqual(rows.map((r) => r.amount), [-500, 2000, -300])
})

test('GPC Fio/ČSOB: kód měny v bajtech 118–122', async () => {
  const { gpc, text, bytes, rows } = await gpcParse('gpc-fio')
  assert.equal(gpc.detectVariant(text, { bytes }), 'currency')
  assert.deepEqual(rows.map((r) => r.currency), ['EUR', 'CZK'])
  const std = gpc.parse(text, { bytes, variant: 'standard' })
  assert.deepEqual(std.map((r) => r.currency), ['CZK', 'CZK'], 'bez dialektu s měnou se pole ignoruje')
})

test('GPC: soubor uložený jako UTF-8 – pozice polí sedí (čte se po bajtech)', async () => {
  const { default: gpc } = await import('../src/importers/gpc.js')
  const utf8 = new TextEncoder().encode(decodeBytes(gpcFile('gpc-cs'), 'windows-1250'))
  const text = decodeBytes(utf8, 'windows-1250')
  const rows = gpc.parse(text, { bytes: utf8 })
  assert.equal(rows[1].counterparty, 'Šťastný Účetní a.s.')
  assert.deepEqual(rows.map((r) => r.amount), [-500, 2000, 500, -300])
})

test('GPC přes registr: readStatement pozná formát i dialekt', async () => {
  const { readStatement, parseStatement } = await import('../src/importers/index.js')
  const { bank, variant, buffer } = await readStatement(fakeFile(gpcFile('gpc-cs')))
  assert.equal(bank.id, 'gpc')
  assert.equal(variant, 'cs')
  const { rows, meta } = parseStatement(buffer, bank, { variant })
  assert.equal(rows.length, 4)
  assert.equal(meta.closing, 2700)
})

// ---------------------------------------------------------------- Revolut

const textFixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

test('Revolut detect: anglická i česká hlavička, byznys export ne', async () => {
  const { default: revolut } = await import('../src/importers/revolut.js')
  assert.equal(revolut.detect(textFixture('revolut-en.csv')), true)
  assert.equal(revolut.detect(textFixture('revolut-cs.csv')), true)
  const business = 'Date started (UTC),Date completed (UTC),ID,Type,State,Description,Reference,Payer,Card number,Orig currency,Orig amount,Payment currency,Amount,Fee,Balance,Account,Beneficiary account number\n'
  assert.equal(revolut.detect(business), false)
  assert.equal(revolut.detect('Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance,ID\n'), false, 'sloupec navíc = jiný export')
  assert.equal(revolut.detect(kbText()), false)
})

test('Revolut EN: datum dokončení, stavy, poplatek jako zvláštní výdaj, typ jen bez popisu', async () => {
  const { default: revolut } = await import('../src/importers/revolut.js')
  const rows = revolut.parse(textFixture('revolut-en.csv'))
  const summary = rows.map((r) => [r.date, r.amount, r.description, r.warning ?? '', r.error ?? ''])
  assert.deepEqual(summary, [
    ['2026-10-01', 500, 'Top-up by *1111', '', ''],
    ['2026-10-03', -149.9, 'Lidl', '', ''],
    ['2026-10-04', -89, 'Bolt', 'Stav „PENDING“ – není zaúčtováno', ''],
    ['2026-10-05', -100, 'TRANSFER', '', ''],
    ['2026-10-06', -200, 'Exchanged to EUR', '', ''],
    ['2026-10-06', -1.25, 'Poplatek Revolut – Exchanged to EUR', '', ''],
    ['2026-10-07', -9.9, 'Poplatek Revolut – Premium plan fee', '', ''],
    ['2026-10-08', -149.9, 'Lidl', 'Stav „REVERTED“ – není zaúčtováno', ''],
  ])
  assert.ok(rows.every((r) => r.currency === 'CZK'))
})

test('Revolut: otisk z času zahájení, částky, popisu a měny; poplatek vlastní otisk', async () => {
  const { default: revolut } = await import('../src/importers/revolut.js')
  const rows = revolut.parse(textFixture('revolut-en.csv'))
  const hashes = importHashes('revolut', rows)
  assert.equal(new Set(hashes).size, hashes.length, 'každý řádek má jiný otisk (i dva nákupy v Lidlu)')
  assert.ok(hashes.every((h) => h.startsWith('revolut:')))
  assert.equal(hashes[5], `${hashes[4]}:fee`)
  assert.deepEqual(importHashes('revolut', revolut.parse(textFixture('revolut-en.csv'))), hashes, 'opakovaný import = stejné otisky')
})

test('Revolut CZ: české názvy sloupců, DOKONČENO, cizí měna', async () => {
  const { default: revolut } = await import('../src/importers/revolut.js')
  const rows = revolut.parse(textFixture('revolut-cs.csv'))
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.currency, r.counterparty, r.warning ?? '']), [
    ['2026-10-03', -4.5, 'EUR', 'Kavárna Šťastná', ''],
    ['2026-10-01', 100, 'EUR', 'Dobití z karty *1111', ''],
    ['2026-10-04', -12, 'EUR', 'Uber', 'Stav „ČEKAJÍCÍ“ – není zaúčtováno'],
  ])
  const { from, to } = revolut.meta(textFixture('revolut-cs.csv'))
  assert.deepEqual([from, to], ['2026-10-01', '2026-10-04'])
})

test('Revolut přes registr', async () => {
  const { readStatement, parseStatement } = await import('../src/importers/index.js')
  const file = fakeFile(new TextEncoder().encode(textFixture('revolut-en.csv')))
  const { bank, buffer } = await readStatement(file)
  assert.equal(bank.id, 'revolut')
  assert.equal(parseStatement(buffer, bank).rows.length, 8)
})

// ---------------------------------------------------------------- univerzální import (mapování sloupců)

const universalOf = async (bytesOrName) => {
  const u = await import('../src/importers/universal.js')
  const bytes = typeof bytesOrName === 'string' ? readFileSync(new URL(`./fixtures/${bytesOrName}`, import.meta.url)) : bytesOrName
  const text = decodeBytes(bytes, 'auto')
  return { u, text, info: u.analyze(text) }
}

test('univerzální: středník, windows-1250, metadata nad hlavičkou, mínus na konci', async () => {
  const { u, text, info } = await universalOf('csv-strednik-cp1250.csv')
  assert.equal(info.delimiter, ';')
  assert.equal(info.headerIndex, 4, 'úvodní metadata se přeskočí')
  assert.equal(info.header[2], 'Název protiúčtu', 'diakritika z windows-1250')
  assert.equal(info.samples.length, 4)
  const m = info.config.mapping
  assert.deepEqual(
    Object.fromEntries(Object.entries(m).map(([k, i]) => [k, info.header[i] ?? null])),
    {
      date: 'Datum provedení',
      amount: 'Částka',
      income: null,
      expense: null,
      vs: 'Variabilní symbol',
      id: 'Identifikace transakce',
      counterparty: 'Název protiúčtu',
      message: 'Zpráva pro příjemce',
    },
  )
  assert.equal(info.config.dateFormat, 'dmy')
  assert.equal(info.config.decimal, ',')
  const rows = u.default.parse(text, { config: info.config })
  assert.equal(rows.length, 3, 'prázdný řádek a zápatí „Celkem“ bez data se přeskočí')
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.description, r.variableSymbol, r.externalId]), [
    ['2026-10-01', -1234.5, 'Lidl Česká republika – nákup potravin', '', 'ID-0001'],
    ['2026-10-03', 25000, 'Zaměstnavatel s.r.o. – výplata 9/2026', '11111111', 'ID-0002'],
    ['2026-10-04', -250, 'Kavárna Šťastná', '', 'ID-0003'],
  ])
  assert.deepEqual(importHashes('csv', rows).slice(0, 1), ['csv:ID-0001'])
})

test('univerzální: čárka, uvozovky, ISO datum, sloupce Příjem / Výdaj, desetinná tečka', async () => {
  const { u, text, info } = await universalOf('csv-carka-prijem-vydaj.csv')
  assert.equal(info.delimiter, ',')
  assert.equal(info.headerIndex, 0)
  const m = info.config.mapping
  assert.equal(m.amount, -1)
  assert.equal(info.header[m.income], 'Příjem')
  assert.equal(info.header[m.expense], 'Výdaj')
  assert.equal(info.header[m.counterparty], 'Popis', 'bez protistrany jde popis do hlavního pole')
  assert.equal(m.message, -1)
  assert.equal(info.config.dateFormat, 'ymd')
  assert.equal(info.config.decimal, '.')
  const rows = u.default.parse(text, { config: info.config })
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.description, r.variableSymbol]), [
    ['2026-10-01', -12500, 'Nájem, říjen', '2026001'],
    ['2026-10-02', 1000.5, 'Vrácení přeplatku', ''],
    ['2026-10-05', -189, 'Kino', ''],
  ])
  const hashes = importHashes('csv', rows)
  assert.ok(hashes.every((h) => h.startsWith('csv:h:')), 'bez ID transakce hash z data, částky a popisu')
})

test('univerzální: tabulátor, ruční přepnutí formátu, chyby mapování', async () => {
  const { u } = await universalOf(new TextEncoder().encode('Datum\tČástka\tPopis\n01/10/2026\t1.234,5\tA\n02/10/2026\t-10\tB\n'))
  const text = 'Datum\tČástka\tPopis\n01/10/2026\t1.234,5\tA\n02/10/2026\t-10\tB\n'
  const info = u.analyze(text)
  assert.equal(info.delimiter, '\t')
  assert.deepEqual(u.default.parse(text, { config: info.config }).map((r) => r.amount), [1234.5, -10])
  const asDot = u.default.parse(text, { config: { ...info.config, decimal: '.' } })
  assert.match(asDot[0].error, /Neplatná částka/, 'ruční přepnutí na desetinnou tečku')
  assert.equal(u.mappingError({ date: -1, amount: 1 }), 'Přiřaďte sloupec s datem.')
  assert.match(u.mappingError({ date: 0, amount: -1, income: -1, expense: -1 }), /částkou/)
  assert.equal(u.mappingError({ date: 0, amount: -1, income: 2, expense: -1 }), '')
  assert.throws(() => u.default.parse(text, { config: { ...info.config, mapping: { date: -1 } } }), (e) => /datem/.test(e.czMessage))
  assert.throws(() => u.analyze('jen text bez tabulky\na další řádek'), (e) => /hlavičku/.test(e.czMessage))
})

test('univerzální: otisk hlavičky pro šablonu nezávisí na diakritice a velikosti', async () => {
  const { headerKey } = await import('../src/importers/universal.js')
  assert.equal(headerKey(['Datum', 'Částka']), headerKey(['DATUM', 'Castka']))
  assert.notEqual(headerKey(['Datum', 'Částka']), headerKey(['Datum', 'Částka', 'Popis']))
})

test('registr: neznámé CSV → univerzální import, KB/Revolut/GPC se nepletou', async () => {
  const { readStatement, parseStatement, bankById, UNIVERSAL_ID } = await import('../src/importers/index.js')
  const file = fakeFile(readFileSync(new URL('./fixtures/csv-strednik-cp1250.csv', import.meta.url)))
  const { bank, buffer, text } = await readStatement(file)
  assert.equal(bank, null)
  assert.ok(text.includes('Název protiúčtu'), 'neznámý soubor se dekóduje jako windows-1250')
  const u = bankById(UNIVERSAL_ID)
  const { analyze } = await import('../src/importers/universal.js')
  const { config } = analyze(text)
  const { rows } = parseStatement(buffer, u, { config })
  assert.equal(rows.length, 3)
  for (const [name, id] of [['kb-sample.csv', 'kb'], ['gpc-standard.gpc', 'gpc'], ['revolut-cs.csv', 'revolut']]) {
    const r = await readStatement(fakeFile(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))))
    assert.equal(r.bank?.id, id, name)
  }
})

// ---------------------------------------------------------------- stejné ID v jednom souboru

const { duplicateFlags } = await import('../src/importers/utils.js')
const REPEAT_HEAD = 'Datum zauctovani;Datum provedeni;Protistrana;Nazev protiuctu;Castka;Mena;VS;Identifikace transakce;Typ transakce;Popis pro me;Zprava pro prijemce'
const repeatFile = [
  REPEAT_HEAD,
  '02.10.2026;02.10.2026;;Vyrovnani;-100,50;CZK;;FTAAA1;Vyrovnávací úhrada;;',
  '02.10.2026;02.10.2026;;Vyrovnani;-200,25;CZK;;FTAAA1;Vyrovnávací úhrada;;',
  '03.10.2026;03.10.2026;;Lidl;-49,80;CZK;;ID-UNIQUE;Mobilní platba;;',
  '',
].join('\n')
// co by po importu leželo v databázi
const asStored = (rows, hashes) =>
  rows.map((r, i) => ({ import_hash: hashes[i], date: r.date, amount: Math.abs(r.amount), type: r.amount < 0 ? 'expense' : 'income' }))

test('stejné ID u dvou různých řádků: oba se importují, druhý import = oba duplicity', () => {
  const rows = kb.parse(repeatFile)
  const hashes = importHashes('kb', rows)
  assert.equal(new Set(hashes).size, 3, 'každý řádek má vlastní otisk')
  assert.equal(hashes[2], 'kb:ID-UNIQUE', 'ID bez opakování má dál původní tvar')
  assert.deepEqual(duplicateFlags('kb', rows, hashes, []), [false, false, false], 'prázdný účet: žádná duplicita')
  assert.deepEqual(importHashes('kb', kb.parse(repeatFile)), hashes, 'deterministické')
  assert.deepEqual(duplicateFlags('kb', rows, hashes, asStored(rows, hashes)), [true, true, true], 'druhý import')
})

test('stejné ID, datum, částka i protistrana: rozliší je pořadí', () => {
  const same = { date: '2026-10-02', amount: -5, counterparty: 'X', description: 'X', externalId: 'A' }
  const hashes = importHashes('kb', [same, { ...same }])
  assert.notEqual(hashes[0], hashes[1])
  assert.match(hashes[0], /:1$/)
  assert.match(hashes[1], /:2$/)
  assert.deepEqual(duplicateFlags('kb', [same, same], hashes, []), [false, false])
})

test('dřívější import se starým otiskem: chybějící řádek se doplní, nic se nezdvojí', () => {
  const rows = kb.parse(repeatFile)
  const hashes = importHashes('kb', rows)
  // dříve se uložil jen první řádek dvojice jako „kb:<ID>“
  const old = [
    { import_hash: 'kb:FTAAA1', date: '2026-10-02', amount: 100.5, type: 'expense' },
    { import_hash: 'kb:ID-UNIQUE', date: '2026-10-03', amount: 49.8, type: 'expense' },
  ]
  const flags = duplicateFlags('kb', rows, hashes, old)
  assert.deepEqual(flags, [true, false, true])
  // po doplnění: stále všechno duplicita
  const after = [...old, ...asStored(rows, hashes).filter((_, i) => !flags[i])]
  assert.deepEqual(duplicateFlags('kb', rows, hashes, after), [true, true, true])
})

test('kratší výpis se stejným řádkem jako dřívější soubor s opakovaným ID = duplicita', () => {
  const rows = kb.parse(repeatFile)
  const stored = asStored(rows, importHashes('kb', rows))
  const short = kb.parse([REPEAT_HEAD, '02.10.2026;02.10.2026;;Vyrovnani;-100,50;CZK;;FTAAA1;Vyrovnávací úhrada;;', ''].join('\n'))
  const shortHashes = importHashes('kb', short)
  assert.equal(shortHashes[0], 'kb:FTAAA1')
  assert.deepEqual(duplicateFlags('kb', short, shortHashes, stored), [true])
  const other = kb.parse([REPEAT_HEAD, '02.10.2026;02.10.2026;;Vyrovnani;-999,00;CZK;;FTAAA1;Vyrovnávací úhrada;;', ''].join('\n'))
  assert.deepEqual(duplicateFlags('kb', other, importHashes('kb', other), stored), [false], 'jiná částka není duplicita')
})

test('opakované ID platí i pro ABO, univerzální import a Revolut', async () => {
  const row = (id, amount) => ({ date: '2026-10-02', amount, counterparty: 'X', description: 'X', externalId: id })
  for (const bank of ['gpc', 'csv', 'revolut']) {
    const rows = [row('A', -1), row('A', -2)]
    const hashes = importHashes(bank, rows)
    assert.equal(new Set(hashes).size, 2, bank)
    assert.deepEqual(duplicateFlags(bank, rows, hashes, []), [false, false], bank)
    assert.deepEqual(duplicateFlags(bank, rows, hashes, asStored(rows, hashes)), [true, true], bank)
  }
  const { default: universal, analyze } = await import('../src/importers/universal.js')
  const csv = 'Datum;Částka;Popis;ID\n01.10.2026;-10;A;X1\n01.10.2026;-20;A;X1\n'
  const rows = universal.parse(csv, { config: analyze(csv).config })
  assert.equal(new Set(importHashes('csv', rows)).size, 2)
})

test('otisk se vejde do limitu databáze (200 znaků) i s dlouhým ID', () => {
  const long = { date: '2026-10-02', amount: -1234567.89, counterparty: 'X', description: 'X', externalId: 'I'.repeat(300) }
  for (const h of importHashes('kb', [long, { ...long }])) assert.ok(h.length <= 200, String(h.length))
})
