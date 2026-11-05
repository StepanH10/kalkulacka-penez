// Unit testy filtrů obrazovky Transakce: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyFilter, filterTransactions, foundLabel, hasActiveFilter, NO_CATEGORY, resolvePeriod } from '../src/utils/transactionFilter.js'

const NOW = '2026-11-05'
const tx = (id, patch = {}) => ({ id, type: 'expense', amount: 100, date: NOW, note: '', category_id: 'c1', account_id: 'a1', import_hash: null, created_by: 'u1', ...patch })
const ids = (list) => list.map((t) => t.id)
const run = (rows, patch) => filterTransactions(rows, { ...emptyFilter(), ...patch }, NOW)

test('hledání: bez ohledu na velikost písmen a diakritiku, v obou směrech', () => {
  const rows = [tx('a', { note: 'LIDL Praha' }), tx('b', { note: 'Nákup potravin' }), tx('c', { note: 'Kavárna' })]
  assert.deepEqual(ids(run(rows, { q: 'lidl' })), ['a'])
  assert.deepEqual(ids(run(rows, { q: 'nakup' })), ['b'])
  assert.deepEqual(ids(run(rows, { q: 'KAVÁRNA' })), ['c'])
})

test('hledání: více slov musí sedět všechna, v libovolném pořadí', () => {
  const rows = [tx('a', { note: 'Lidl Praha 4' }), tx('b', { note: 'Lidl Brno' })]
  assert.deepEqual(ids(run(rows, { q: 'praha lidl' })), ['a'])
  assert.deepEqual(ids(run(rows, { q: '   ' })), ['a', 'b'])
})

test('období: měsíce, 30 dní včetně dneška, rok, přelom roku', () => {
  assert.deepEqual(resolvePeriod({ period: 'this' }, NOW), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(resolvePeriod({ period: 'last' }, NOW), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(resolvePeriod({ period: 'last' }, '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(resolvePeriod({ period: '30d' }, NOW), { from: '2026-10-07', to: NOW })
  assert.deepEqual(resolvePeriod({ period: 'year' }, NOW), { from: '2026-01-01', to: '2026-12-31' })
  assert.equal(resolvePeriod({ period: null }, NOW), null)
})

test('vlastní rozsah: otevřený z jedné strany, prohozené datumy se srovnají', () => {
  const rows = [tx('a', { date: '2026-01-10' }), tx('b', { date: '2026-06-10' }), tx('c', { date: '2026-10-10' })]
  assert.deepEqual(ids(run(rows, { period: 'custom', from: '2026-06-01' })), ['b', 'c'])
  assert.deepEqual(ids(run(rows, { period: 'custom', to: '2026-06-30' })), ['a', 'b'])
  assert.deepEqual(ids(run(rows, { period: 'custom', from: '2026-06-30', to: '2026-01-01' })), ['a', 'b'])
})

test('typ, kategorie (více najednou, i bez kategorie), účet, autor', () => {
  const rows = [
    tx('a', { category_id: 'c1' }),
    tx('b', { category_id: 'c2', account_id: 'a2', created_by: 'u2' }),
    tx('c', { category_id: null, type: 'income' }),
  ]
  assert.deepEqual(ids(run(rows, { type: 'income' })), ['c'])
  assert.deepEqual(ids(run(rows, { categories: ['c1', 'c2'] })), ['a', 'b'])
  assert.deepEqual(ids(run(rows, { categories: [NO_CATEGORY] })), ['c'])
  assert.deepEqual(ids(run(rows, { accountId: 'a2' })), ['b'])
  assert.deepEqual(ids(run(rows, { authorId: 'u2' })), ['b'])
})

test('částka od–do včetně hranic, číselně i z textu z databáze', () => {
  const rows = [tx('a', { amount: '99.50' }), tx('b', { amount: '100.00' }), tx('c', { amount: 250 })]
  assert.deepEqual(ids(run(rows, { amountMin: 100 })), ['b', 'c'])
  assert.deepEqual(ids(run(rows, { amountMax: 100 })), ['a', 'b'])
  assert.deepEqual(ids(run(rows, { amountMin: 100, amountMax: 100 })), ['b'])
})

test('nulová hranice částky je platný filtr', () => {
  assert.equal(hasActiveFilter({ ...emptyFilter(), amountMin: 0 }), true)
})

test('původ: ručně zadané / importované', () => {
  const rows = [tx('a'), tx('b', { import_hash: 'kb:1' })]
  assert.deepEqual(ids(run(rows, { origin: 'manual' })), ['a'])
  assert.deepEqual(ids(run(rows, { origin: 'import' })), ['b'])
})

test('filtry se kombinují', () => {
  const rows = [tx('a', { note: 'Lidl', amount: 300 }), tx('b', { note: 'Lidl', amount: 50 }), tx('c', { note: 'Billa', amount: 300 })]
  assert.deepEqual(ids(run(rows, { q: 'lidl', amountMin: 100 })), ['a'])
})

test('prázdný filtr není aktivní, mezery v hledání také ne', () => {
  assert.equal(hasActiveFilter(emptyFilter()), false)
  assert.equal(hasActiveFilter({ ...emptyFilter(), q: '  ' }), false)
  assert.equal(hasActiveFilter({ ...emptyFilter(), q: 'x' }), true)
})

test('foundLabel: české skloňování', () => {
  assert.equal(foundLabel(1), 'Nalezena 1 transakce')
  assert.equal(foundLabel(3), 'Nalezeny 3 transakce')
  assert.equal(foundLabel(23), 'Nalezeno 23 transakcí')
})
