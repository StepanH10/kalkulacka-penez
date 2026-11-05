// Počáteční zůstatek: výpočet zůstatků a nabídka při importu
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { accountBalances, totalBalance, movementsBefore, totals } from '../src/state/selectors.js'
import { openingDate, openingOffer, projectBalance } from '../src/importers/openingBalance.js'
import kb from '../src/importers/kb.js'
import gpc from '../src/importers/gpc.js'
import revolut from '../src/importers/revolut.js'
import { decodeBytes } from '../src/importers/utils.js'

const tx = (account_id, type, amount, date) => ({ account_id, type, amount, date })
const state = (accounts, transactions = [], transfers = []) => ({ accounts, transactions, transfers })

test('zůstatek bez počátečního zůstatku: všechny pohyby jako dřív', () => {
  const s = state([{ id: 'a' }, { id: 'b', opening_balance: null, opening_balance_date: null }], [tx('a', 'income', 100, '2020-01-01'), tx('a', 'expense', 30.5, '2026-10-01')], [{ from_account_id: 'a', to_account_id: 'b', amount: 20, date: '2026-10-02' }])
  const b = accountBalances(s)
  assert.equal(b.get('a'), 49.5)
  assert.equal(b.get('b'), 20)
  assert.equal(totalBalance(s), 69.5)
})

test('zůstatek = počáteční + pohyby od data včetně; převody se počítají; starší ne', () => {
  const a = { id: 'a', opening_balance: 1000, opening_balance_date: '2026-10-01' }
  const s = state(
    [a, { id: 'b' }],
    [tx('a', 'income', 500, '2026-09-30'), tx('a', 'expense', 49.8, '2026-10-01'), tx('a', 'income', 100, '2026-10-05')],
    [
      { from_account_id: 'a', to_account_id: 'b', amount: 200, date: '2026-10-06' },
      { from_account_id: 'b', to_account_id: 'a', amount: 75, date: '2026-09-01' },
    ],
  )
  const b = accountBalances(s)
  assert.equal(b.get('a'), 850.2)
  assert.equal(b.get('b'), 125, 'druhý účet bez data počítá oba převody')
  assert.equal(movementsBefore('a', '2026-10-01', s), 2)
  assert.equal(movementsBefore('a', '', s), 0)
})

test('záporný počáteční zůstatek a nula', () => {
  assert.equal(accountBalances(state([{ id: 'a', opening_balance: '-250.75', opening_balance_date: '2026-01-01' }])).get('a'), -250.75)
  const zero = state([{ id: 'a', opening_balance: 0, opening_balance_date: '2026-10-01' }], [tx('a', 'income', 5, '2026-09-01')])
  assert.equal(accountBalances(zero).get('a'), 0, 'nula je platný zůstatek, starší pohyb se nepočítá')
})

test('počáteční zůstatek není ve statistikách příjmů a výdajů', () => {
  const list = [tx('a', 'income', 100, '2026-10-01'), tx('a', 'expense', 40, '2026-10-02')]
  const t = totals(list)
  assert.equal(t.income, 100)
  assert.equal(t.expense, 40)
})

// ---------------------------------------------------------------- nabídka

const meta = { from: '2026-10-01', to: '2026-10-31', opening: 20000.53, closing: 30000.89 }
const rows = [{ date: '2026-09-30', amount: -27.9 }, { date: '2026-10-05', amount: 10000 }, { date: '2026-01-01', amount: 0, error: 'Neplatné' }]

test('openingDate: starší z začátku výpisu a nejstaršího pohybu, chybné řádky se nepočítají', () => {
  assert.equal(openingDate(meta, rows), '2026-09-30')
  assert.equal(openingDate(meta, [{ date: '2026-10-09', amount: 1 }]), '2026-10-01')
  assert.equal(openingDate({}, [{ date: '2026-10-09', amount: 1 }]), '2026-10-09')
  assert.equal(openingDate({}, []), null)
})

test('openingOffer: účet bez zůstatku → set, starší výpis → overwrite, jinak nic', () => {
  assert.deepEqual(openingOffer({ id: 'a' }, meta, rows), { mode: 'set', amount: 20000.53, date: '2026-09-30', closing: 30000.89, to: '2026-10-31' })
  assert.equal(openingOffer({ id: 'a', opening_balance_date: '2026-11-01' }, meta, rows).mode, 'overwrite')
  assert.equal(openingOffer({ id: 'a', opening_balance_date: '2026-09-30' }, meta, rows), null, 'stejné datum se nepřepisuje')
  assert.equal(openingOffer({ id: 'a', opening_balance_date: '2026-01-01' }, meta, rows), null, 'novější výpis se nenabízí')
  assert.equal(openingOffer({ id: 'a' }, { from: '2026-10-01', to: '2026-10-31' }, rows), null, 'výpis bez zůstatku')
  assert.equal(openingOffer(null, meta, rows), null)
  const zero = openingOffer({ id: 'a' }, { ...meta, opening: 0 }, rows)
  assert.equal(zero.amount, 0, 'nulový zůstatek je platný')
})

test('projectBalance: výsledek, porovnání s konečným zůstatkem, pozdější pohyby, skryté starší', () => {
  const offer = { amount: 1000, date: '2026-10-01', closing: 1500, to: '2026-10-31' }
  const r = projectBalance({
    accountId: 'a',
    offer,
    transactions: [tx('a', 'income', 999, '2026-09-30'), tx('a', 'expense', 100, '2026-10-10'), tx('a', 'expense', 50, '2026-11-02'), tx('jiný', 'income', 7, '2026-10-10')],
    transfers: [{ from_account_id: 'x', to_account_id: 'a', amount: 100, date: '2026-10-11' }],
    importing: [{ date: '2026-10-05', amount: 500 }],
  })
  assert.deepEqual(r, { balance: 1450, atStatementEnd: 1500, later: -50, diff: 0, matches: true, hidden: 1 })
  const miss = projectBalance({ accountId: 'a', offer, importing: [{ date: '2026-10-05', amount: 10.5 }] })
  assert.equal(miss.diff, -489.5)
  assert.equal(miss.matches, false)
  const noClosing = projectBalance({ accountId: 'a', offer: { ...offer, closing: null } })
  assert.equal(noClosing.matches, null)
})

// ---------------------------------------------------------------- skutečné parsery

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url))

test('KB: nabídka a platba provedená před začátkem výpisu zůstane v zůstatku', () => {
  const text = decodeBytes(fixture('kb-sample.csv'), kb.encoding)
  const parsed = kb.parse(text)
  const offer = openingOffer({ id: 'a' }, kb.meta(text), parsed)
  assert.equal(offer.date, '2026-09-30')
  assert.equal(offer.amount, 20000.53)
  const r = projectBalance({ accountId: 'a', offer, importing: parsed })
  assert.equal(r.balance, 22197.83, 'včetně platby z 30. 9.')
})

test('ABO: po importu sedí výsledný zůstatek na konečný zůstatek z hlavičky 074', () => {
  const bytes = fixture('gpc-standard.gpc')
  const text = decodeBytes(bytes, gpc.encoding)
  const parsed = gpc.parse(text, { bytes })
  const offer = openingOffer({ id: 'a' }, gpc.meta(text, { bytes }), parsed)
  const r = projectBalance({ accountId: 'a', offer, importing: parsed })
  assert.equal(r.balance, 21147.63)
  assert.equal(r.matches, true)
})

test('Revolut zůstatek nenabízí', () => {
  const text = fixture('revolut-en.csv').toString('utf8')
  assert.equal(openingOffer({ id: 'a' }, revolut.meta(text), revolut.parse(text)), null)
})
