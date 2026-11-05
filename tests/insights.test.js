// Unit testy měsíčních postřehů: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildInsights, comparableRanges, hasEnoughHistory } from '../src/utils/insights.js'

const NOW = '2026-11-05'
const CATS = [{ id: 'food', name: 'Jídlo' }, { id: 'fun', name: 'Zábava' }]
let seq = 0
const exp = (date, amount, category_id = 'food', note = '') => ({ id: `t${++seq}`, type: 'expense', date, amount, category_id, note })
const inc = (date, amount) => ({ id: `t${++seq}`, type: 'income', date, amount, category_id: null, note: '' })
// nejstarší transakce, aby bylo dost historie
const OLD = exp('2026-09-15', 10, 'fun')
const build = (rows, extra = {}) => buildInsights({ transactions: [OLD, ...rows], categories: CATS, now: NOW, ...extra })
const pick = (result, id) => result.insights.find((i) => i.id === id)

test('férové srovnání: stejný počet dní minulého měsíce', () => {
  assert.deepEqual(comparableRanges(NOW), {
    current: { from: '2026-11-01', to: NOW },
    previous: { from: '2026-10-01', to: '2026-10-05' },
  })
})

test('férové srovnání: kratší minulý měsíc se ořízne, přelom roku', () => {
  assert.deepEqual(comparableRanges('2026-03-31').previous, { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(comparableRanges('2028-03-31').previous, { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(comparableRanges('2027-01-10').previous, { from: '2026-12-01', to: '2026-12-10' })
})

test('srovnání ignoruje výdaje mimo stejné dny minulého měsíce', () => {
  const rows = [exp('2026-11-03', 1000), exp('2026-10-03', 1000), exp('2026-10-20', 9000)]
  const item = pick(build(rows), 'month-comparison')
  assert.match(item.text, /stejně jako/)
  assert.match(item.text, /1\.–5\. listopadu/)
  assert.match(item.text, /1\.–5\. října/)
})

test('srovnání: procenta a rozdíl se znaménkem, nárůst i pokles', () => {
  const up = pick(build([exp('2026-11-03', 1200), exp('2026-10-03', 1000)]), 'month-comparison')
  assert.match(up.text, /o 20 % víc/)
  assert.match(up.text, /\+200\s*Kč/)
  const down = pick(build([exp('2026-11-03', 800), exp('2026-10-03', 1000)]), 'month-comparison')
  assert.match(down.text, /o 20 % míň/)
  assert.match(down.text, /−200\s*Kč/)
})

test('srovnání chybí, když minule nebyly žádné výdaje', () => {
  assert.equal(pick(build([exp('2026-11-03', 500)]), 'month-comparison'), undefined)
})

test('kategorie: text ze zadání, jen při změně ≥ 15 % a zároveň ≥ 200 Kč', () => {
  const item = pick(build([exp('2026-11-02', 4064), exp('2026-10-02', 3444)]), 'category-change')
  assert.match(item.text, /^Za Jídlo jste utratili o 18 % víc než minule \(\+620\s*Kč\)$/)
  assert.deepEqual(item.filter.categories, ['food'])
})

test('kategorie: přesně na prazích se zobrazí', () => {
  assert.ok(pick(build([exp('2026-11-02', 2300), exp('2026-10-02', 2000)]), 'category-change'))
  assert.ok(pick(build([exp('2026-11-02', 1200), exp('2026-10-02', 1000)]), 'category-change'))
})

test('kategorie: velké procento s malou částkou ani velká částka s malým procentem nestačí', () => {
  assert.equal(pick(build([exp('2026-11-02', 150), exp('2026-10-02', 100)]), 'category-change'), undefined)
  assert.equal(pick(build([exp('2026-11-02', 11000), exp('2026-10-02', 10000)]), 'category-change'), undefined)
})

test('kategorie: vyhrává největší změna v korunách, i pokles', () => {
  const rows = [
    exp('2026-11-02', 1300, 'food'), exp('2026-10-02', 1000, 'food'),
    exp('2026-11-02', 1000, 'fun'), exp('2026-10-02', 2000, 'fun'),
  ]
  const item = pick(build(rows), 'category-change')
  assert.match(item.text, /^Za Zábava jste utratili o 50 % míň/)
})

test('největší výdaj měsíce: filtr míří na tu transakci, budoucí výdaj se nepočítá', () => {
  const rows = [exp('2026-11-02', 500, 'food', 'Lidl'), exp('2026-11-04', 1500, 'food', 'Alza'), exp('2026-11-20', 9000)]
  const item = pick(build(rows), 'largest-expense')
  assert.match(item.text, /Alza/)
  assert.deepEqual(item.filter, { period: 'custom', from: '2026-11-04', to: '2026-11-04', type: 'expense', amountMin: 1500, amountMax: 1500 })
})

test('míra úspor: jen s příjmy v měsíci, záporná bilance má jiný text', () => {
  assert.equal(pick(build([exp('2026-11-02', 100)]), 'savings-rate'), undefined)
  assert.match(pick(build([inc('2026-11-01', 1000), exp('2026-11-02', 770)]), 'savings-rate').text, /^Z příjmů vám zatím zbylo 23 %$/)
  assert.match(pick(build([inc('2026-11-01', 1000), exp('2026-11-02', 1200)]), 'savings-rate').text, /převyšují příjmy o 200/)
})

test('návrhy detektoru: skloňování a odkaz do trackeru', () => {
  const text = (suggestionCount) => pick(build([], { suggestionCount }), 'subscription-suggestions')?.text
  assert.equal(text(0), undefined)
  assert.equal(text(1), 'Našli jsme 1 možné předplatné')
  assert.equal(text(3), 'Našli jsme 3 možná předplatná')
  assert.equal(text(5), 'Našli jsme 5 možných předplatných')
  assert.equal(pick(build([], { suggestionCount: 1 }), 'subscription-suggestions').href, '/stats?tab=subscriptions')
})

test('málo historie: žádná srovnání, ale postřehy z aktuálního měsíce zůstanou', () => {
  const rows = [exp('2026-10-03', 1000), exp('2026-11-03', 1500), inc('2026-11-01', 5000)]
  assert.equal(hasEnoughHistory(rows, NOW), false)
  const result = buildInsights({ transactions: rows, categories: CATS, now: NOW })
  assert.equal(result.enoughHistory, false)
  assert.equal(pick(result, 'month-comparison'), undefined)
  assert.equal(pick(result, 'category-change'), undefined)
  assert.ok(pick(result, 'largest-expense'))
})

test('hranice historie: transakce přesně 1. dne minulého měsíce stačí', () => {
  assert.equal(hasEnoughHistory([exp('2026-10-01', 1)], NOW), true)
  assert.equal(hasEnoughHistory([exp('2026-10-02', 1)], NOW), false)
  assert.equal(hasEnoughHistory([], NOW), false)
})

test('předplatné do 7 dní: hranice okna a nejbližší platba', () => {
  const upcoming = [
    { name: 'Spotify', amount: 169, date: '2026-11-12', matchText: 'spotify' },
    { name: 'Netflix', amount: 199, date: '2026-11-06', matchText: 'netflix' },
    { name: 'Daleko', amount: 99, date: '2026-11-13', matchText: 'daleko' },
  ]
  const item = pick(build([], { upcoming }), 'upcoming-subscription')
  assert.match(item.text, /^Netflix: platba 199\s*Kč zítra/)
  assert.match(item.text, /\(a další 1\)$/)
  assert.deepEqual(item.filter, { q: 'netflix' })
  assert.equal(pick(build([], { upcoming: [upcoming[2]] }), 'upcoming-subscription'), undefined)
})

test('řazení podle důležitosti a nejvýše 4 postřehy', () => {
  const rows = [inc('2026-11-01', 1000), exp('2026-11-02', 3000, 'food', 'Alza'), exp('2026-10-02', 1000)]
  const upcoming = [{ name: 'Netflix', amount: 199, date: NOW, matchText: 'netflix' }]
  const { insights } = build(rows, { upcoming })
  assert.equal(insights.length, 4)
  assert.deepEqual(insights.map((i) => i.id), ['upcoming-subscription', 'savings-rate', 'month-comparison', 'category-change'])
})
