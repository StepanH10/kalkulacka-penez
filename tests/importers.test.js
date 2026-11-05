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
  assert.deepEqual(kb.meta(kbText()), { from: '2026-10-01', to: '2026-10-31' })
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
