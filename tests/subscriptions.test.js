// Unit testy detektoru a párování předplatných: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  addInterval,
  amountSpread,
  analyzeSubscription,
  buildSubscriptionData,
  detectInterval,
  detectSubscriptions,
  lastImportDate,
  matchPayments,
  nextPayment,
  normalizeMerchant,
  paymentsLabel,
  prepareExpenses,
  subscriptionAlerts,
  subscriptionCosts,
  subscriptionPeriodLabel,
  withinTolerance,
} from '../src/utils/subscriptions.js'

const NOW = '2026-11-05'
let seq = 0
const exp = (date, amount, note, patch = {}) => ({ id: `t${++seq}`, type: 'expense', date, amount, note, category_id: null, import_hash: null, ...patch })
const monthly = (note, amount = 199, dates = ['2026-08-03', '2026-09-03', '2026-10-03']) => dates.map((d) => exp(d, amount, note))
const sub = (patch = {}) => ({ id: 's1', name: 'Netflix', match_text: 'netflix', amount: 199, amount_tolerance: 10, interval: 'monthly', started_on: '2026-01-01', ended_on: null, status: 'active', ...patch })

// ---------------------------------------------------------------- normalizace

test('normalizace: ze zadání, bez diakritiky a malými písmeny', () => {
  assert.equal(normalizeMerchant('NETFLIX.COM 12345'), 'netflix.com')
  assert.equal(normalizeMerchant('Nájem Žižkov'), 'najem zizkov')
  assert.equal(normalizeMerchant('  SPOTIFY   P1A2B3C4  '), 'spotify')
})

test('normalizace: více čísel a ID na konci, čísla uprostřed zůstanou', () => {
  assert.equal(normalizeMerchant('Apple.com/bill 123 45.67 AB12'), 'apple.com/bill')
  assert.equal(normalizeMerchant('Studio 54 Praha'), 'studio 54 praha')
})

test('normalizace: z popisu importu se bere protistrana', () => {
  assert.equal(normalizeMerchant('Spořilov s.r.o. – nájem 11/2026'), 'sporilov s.r.o')
  assert.equal(normalizeMerchant('Storno – Netflix – vratka'), 'netflix')
})

test('normalizace: jediné slovo s číslicí zůstane', () => {
  assert.equal(normalizeMerchant('O2 776123456'), 'o2')
  assert.equal(normalizeMerchant('O2'), 'o2')
})

test('normalizace: prázdný, obecný a čistě číselný popis se ignoruje', () => {
  for (const note of ['', null, 'Bez popisu', 'Platba kartou', 'Odchozí platba', '123456', 'x']) {
    assert.equal(normalizeMerchant(note), '', String(note))
  }
})

// ---------------------------------------------------------------- intervaly

test('intervaly: týdenní, měsíční, čtvrtletní, roční včetně krajních hodnot', () => {
  assert.equal(detectInterval(['2026-10-01', '2026-10-07', '2026-10-15']), 'weekly') // 6 a 8 dní
  assert.equal(detectInterval(['2026-01-31', '2026-02-26', '2026-04-02']), 'monthly') // 26 a 35 dní
  assert.equal(detectInterval(['2026-01-01', '2026-03-27', '2026-06-30']), 'quarterly') // 85 a 95 dní
  assert.equal(detectInterval(['2024-01-01', '2024-12-16', '2025-12-31']), 'yearly') // 350 a 380 dní
})

test('intervaly: těsně mimo okno ani smíšené odstupy se nepřijmou', () => {
  assert.equal(detectInterval(['2026-10-01', '2026-10-06']), null) // 5 dní
  assert.equal(detectInterval(['2026-10-01', '2026-10-10']), null) // 9 dní
  assert.equal(detectInterval(['2026-01-01', '2026-01-26']), null) // 25 dní
  assert.equal(detectInterval(['2026-01-01', '2026-02-06']), null) // 36 dní
  assert.equal(detectInterval(['2026-01-01', '2026-01-08', '2026-02-08']), null) // týden, pak měsíc
  assert.equal(detectInterval(['2026-01-01']), null)
})

test('detektor: měsíční s kolísáním data a únorem', () => {
  const rows = ['2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30'].map((d) => exp(d, 199, 'NETFLIX.COM 12345'))
  const [found] = detectSubscriptions(rows, [], '2026-05-05')
  assert.equal(found.name, 'Netflix')
  assert.equal(found.matchText, 'netflix.com')
  assert.equal(found.interval, 'monthly')
  assert.equal(found.count, 4)
  assert.equal(found.firstDate, '2026-01-30')
  assert.equal(found.known, true)
})

test('detektor: týdenní a čtvrtletní', () => {
  const weekly = ['2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'].map((d) => exp(d, 500, 'Tenis Kurty'))
  assert.equal(detectSubscriptions(weekly, [], NOW)[0].interval, 'weekly')
  const quarterly = ['2026-02-01', '2026-05-01', '2026-08-01'].map((d) => exp(d, 900, 'Pojistovna'))
  assert.equal(detectSubscriptions(quarterly, [], NOW)[0].interval, 'quarterly')
})

test('detektor: roční stačí 2 platby, měsíčním 2 nestačí', () => {
  const yearly = [exp('2025-10-10', 1200, 'Domena Hosting'), exp('2026-10-10', 1200, 'Domena Hosting')]
  assert.equal(detectSubscriptions(yearly, [], NOW)[0].interval, 'yearly')
  const two = monthly('Netflix', 199, ['2026-09-03', '2026-10-03'])
  assert.deepEqual(detectSubscriptions(two, [], NOW), [])
})

test('detektor: funguje bez seznamu známých služeb (nájem)', () => {
  const [found] = detectSubscriptions(monthly('Pan Novák – nájem', 15000), [], NOW)
  assert.equal(found.name, 'Pan Novák')
  assert.equal(found.known, false)
  assert.equal(found.amount, 15000)
})

test('detektor: nepravidelné platby se NEDETEKUJÍ', () => {
  const rows = ['2026-08-03', '2026-08-20', '2026-09-30', '2026-10-05', '2026-10-30'].map((d) => exp(d, 300, 'Lidl Praha'))
  assert.deepEqual(detectSubscriptions(rows, [], NOW), [])
})

test('detektor: vynechaný měsíc není pravidelný odstup', () => {
  assert.deepEqual(detectSubscriptions(monthly('Netflix', 199, ['2026-07-03', '2026-08-03', '2026-10-03']), [], NOW), [])
})

test('mezera: od 4 plateb se toleruje jedna o dvojnásobném intervalu', () => {
  assert.equal(detectInterval(['2026-06-03', '2026-07-03', '2026-09-03', '2026-10-03']), 'monthly')
  assert.equal(detectInterval(['2026-08-01', '2026-08-08', '2026-08-22', '2026-08-29']), 'weekly')
  assert.equal(detectInterval(['2025-01-01', '2025-04-01', '2025-10-01', '2026-01-01']), 'quarterly')
  assert.equal(detectInterval(['2021-01-01', '2022-01-01', '2024-01-01', '2025-01-01']), 'yearly')
})

test('mezera: hranice dvojnásobku u měsíčního intervalu (52–70 dní)', () => {
  const dates = (gap) => ['2026-01-01', '2026-02-01', addDays('2026-02-01', gap), addDays('2026-02-01', gap + 30)]
  assert.equal(detectInterval(dates(52)), 'monthly')
  assert.equal(detectInterval(dates(70)), 'monthly')
  assert.equal(detectInterval(dates(51)), null)
  assert.equal(detectInterval(dates(71)), null)
})

test('mezera: dvě mezery ani jiný než dvojnásobný odstup neprojdou', () => {
  assert.equal(detectInterval(['2026-01-03', '2026-03-03', '2026-05-03', '2026-06-03', '2026-07-03']), null)
  assert.equal(detectInterval(['2026-01-03', '2026-02-03', '2026-05-03', '2026-06-03']), null) // trojnásobek
})

test('mezera: detektor navrhne předplatné s vynechanou platbou, počítají se skutečné platby', () => {
  const rows = ['2026-06-03', '2026-07-03', '2026-09-03', '2026-10-03'].map((d) => exp(d, 199, 'Netflix'))
  const [found] = detectSubscriptions(rows, [], NOW)
  assert.equal(found.interval, 'monthly')
  assert.equal(found.count, 4)
})

test('detektor: příjmy, obecné popisy a dávno ukončené platby se nenabízí', () => {
  const income = monthly('Výplata', 30000).map((t) => ({ ...t, type: 'income' }))
  assert.deepEqual(detectSubscriptions(income, [], NOW), [])
  assert.deepEqual(detectSubscriptions(monthly('Platba kartou'), [], NOW), [])
  assert.deepEqual(detectSubscriptions(monthly('Netflix', 199, ['2024-01-03', '2024-02-03', '2024-03-03']), [], NOW), [])
})

test('tolerance detektoru: rozdíl přesně 15 % projde, větší ne', () => {
  assert.equal(detectSubscriptions([exp('2026-08-03', 100, 'Sluzba'), exp('2026-09-03', 110, 'Sluzba'), exp('2026-10-03', 115, 'Sluzba')], [], NOW).length, 1)
  assert.deepEqual(detectSubscriptions([exp('2026-08-03', 100, 'Sluzba'), exp('2026-09-03', 110, 'Sluzba'), exp('2026-10-03', 116, 'Sluzba')], [], NOW), [])
  assert.ok(Math.abs(amountSpread([100, 115]) - 0.15) < 1e-9)
})

test('detektor: jednorázový nákup u obchodníka předplatné nezkazí', () => {
  const rows = [...monthly('Apple.com/bill', 79), exp('2026-09-15', 25000, 'Apple.com/bill')]
  const [found] = detectSubscriptions(rows, [], NOW)
  assert.equal(found.amount, 79)
  assert.equal(found.count, 3)
})

test('detektor: známé služby první, sledované i zamítnuté se nenabízí', () => {
  const rows = [...monthly('Pan Novák', 15000), ...monthly('Spotify', 169)]
  assert.deepEqual(detectSubscriptions(rows, [], NOW).map((s) => s.name), ['Spotify', 'Pan Novák'])
  assert.deepEqual(detectSubscriptions(rows, [sub({ match_text: 'spotify', status: 'ignored' })], NOW).map((s) => s.name), ['Pan Novák'])
  assert.deepEqual(detectSubscriptions(monthly('NETFLIX.COM'), [sub({ status: 'cancelled' })], NOW), [])
})

test('detektor: navrhne nejčastější kategorii', () => {
  const rows = monthly('Spotify', 169).map((t, i) => ({ ...t, category_id: i ? 'zabava' : 'jine' }))
  assert.equal(detectSubscriptions(rows, [], NOW)[0].categoryId, 'zabava')
})

test('detektor nemění vstupní transakce', () => {
  const rows = monthly('Spotify', 169)
  const before = JSON.stringify(rows)
  detectSubscriptions(rows, [], NOW)
  assert.equal(JSON.stringify(rows), before)
})

// ---------------------------------------------------------------- párování

test('tolerance párování: hranice včetně', () => {
  assert.equal(withinTolerance(110, 100, 10), true)
  assert.equal(withinTolerance(90, 100, 10), true)
  assert.equal(withinTolerance(110.02, 100, 10), false)
  assert.equal(withinTolerance(89.9, 100, 10), false)
  assert.equal(withinTolerance(100, 100, 0), true)
})

test('párování: výdaj, text kdekoliv v poznámce, částka v toleranci, od začátku předplatného', () => {
  const rows = [
    exp('2026-09-03', 199, 'Platba NETFLIX.COM 123'),
    exp('2026-09-04', 199, 'Spotify'),
    exp('2026-09-05', 199, 'Netflix', { type: 'income' }),
    exp('2025-12-03', 199, 'Netflix'),
  ]
  assert.deepEqual(matchPayments(sub(), prepareExpenses(rows)).map((p) => p.date), ['2026-09-03'])
})

test('párování: stejný obchodník s jinou částkou mimo termín se nespáruje', () => {
  const rows = [exp('2026-09-03', 199, 'Netflix'), exp('2026-09-15', 5000, 'Netflix dárková karta')]
  assert.equal(matchPayments(sub(), prepareExpenses(rows)).length, 1)
})

test('párování: zdražení v termínu se spáruje a nové ceny se drží dál', () => {
  const rows = [exp('2026-08-03', 199, 'Netflix'), exp('2026-09-03', 259, 'Netflix'), exp('2026-10-20', 259, 'Netflix')]
  assert.deepEqual(matchPayments(sub(), prepareExpenses(rows)).map((p) => p.amount), [199, 259, 259])
})

test('aktualizace ceny: platby za starou cenu zůstanou spárované a součet se nezmění', () => {
  const rows = [exp('2026-08-20', 199, 'Netflix'), exp('2026-09-20', 199, 'Netflix'), exp('2026-10-20', 259, 'Netflix')]
  const expenses = prepareExpenses(rows)
  const before = analyzeSubscription(sub(), expenses, '', NOW)
  const after = analyzeSubscription(sub({ amount: 259 }), expenses, '', NOW)
  assert.deepEqual(before.alerts.map((a) => a.type), ['price'])
  assert.deepEqual(after.payments.map((p) => p.amount), [199, 199, 259])
  assert.equal(after.total, before.total)
  assert.deepEqual(after.alerts, [])
})

test('párování zpětně: jiná částka mimo termín před první platbou v toleranci se nepřidá', () => {
  const rows = [exp('2026-09-15', 5000, 'Netflix dárková karta'), exp('2026-10-03', 259, 'Netflix')]
  assert.deepEqual(matchPayments(sub({ amount: 259 }), prepareExpenses(rows)).map((p) => p.amount), [259])
})

test('párování: bez platby v toleranci k očekávané částce nic', () => {
  assert.deepEqual(matchPayments(sub({ amount: 5000 }), prepareExpenses([exp('2026-09-03', 199, 'Netflix')])), [])
})

// ---------------------------------------------------------------- příští platba

test('přičtení intervalu: konec měsíce se ořízne a neposouvá', () => {
  assert.equal(addInterval('2026-01-31', 'monthly'), '2026-02-28')
  assert.equal(addInterval('2026-01-31', 'monthly', 2), '2026-03-31')
  assert.equal(addInterval('2024-02-29', 'yearly'), '2025-02-28')
  assert.equal(addInterval('2026-11-30', 'quarterly'), '2027-02-28')
  assert.equal(addInterval('2026-12-28', 'weekly'), '2027-01-04')
})

test('příští platba: poslední spárovaná + interval', () => {
  const pay = [{ date: '2026-10-20', amount: 199 }]
  assert.deepEqual(nextPayment(sub(), pay, NOW), { date: '2026-11-20', overdueSince: null })
  assert.deepEqual(nextPayment(sub({ interval: 'weekly' }), [{ date: '2026-11-01' }], NOW), { date: '2026-11-08', overdueSince: null })
  assert.deepEqual(nextPayment(sub({ interval: 'yearly' }), pay, NOW), { date: '2027-10-20', overdueSince: null })
  assert.deepEqual(nextPayment(sub({ interval: 'quarterly' }), pay, NOW), { date: '2027-01-20', overdueSince: null })
})

test('příští platba: termín dnes není zpoždění', () => {
  assert.deepEqual(nextPayment(sub(), [{ date: '2026-10-05' }], NOW), { date: NOW, overdueSince: null })
})

test('příští platba: propásnutý termín se posune a zůstane v overdueSince', () => {
  assert.deepEqual(nextPayment(sub(), [{ date: '2026-08-03' }], NOW), { date: '2026-12-03', overdueSince: '2026-09-03' })
})

test('příští platba: bez spárovaných plateb podle začátku a bez zpoždění', () => {
  assert.deepEqual(nextPayment(sub({ started_on: '2026-11-20' }), [], NOW), { date: '2026-11-20', overdueSince: null })
  assert.deepEqual(nextPayment(sub({ started_on: '2024-03-10' }), [], NOW), { date: '2026-11-10', overdueSince: null })
})

// ---------------------------------------------------------------- upozornění

const alertTypes = (subscription, rows, now = NOW) => {
  const expenses = prepareExpenses(rows)
  return analyzeSubscription(subscription, expenses, lastImportDate(rows), now).alerts.map((a) => a.type)
}

test('zdražení: neutrální text, jen nad toleranci a jen při růstu', () => {
  const rows = [exp('2026-09-20', 199, 'Netflix'), exp('2026-10-20', 259, 'Netflix')]
  const { alerts } = analyzeSubscription(sub(), prepareExpenses(rows), '', NOW)
  assert.match(alerts[0].text, /^Cena Netflix vzrostla z 199\s*Kč na 259\s*Kč$/)
  assert.equal(alerts[0].latestAmount, 259)
  assert.deepEqual(alertTypes(sub(), [exp('2026-09-20', 199, 'Netflix'), exp('2026-10-20', 215, 'Netflix')]), [])
  assert.deepEqual(alertTypes(sub({ amount: 259 }), [exp('2026-09-20', 259, 'Netflix'), exp('2026-10-20', 199, 'Netflix')]), [])
})

test('platba chybí: jen když je výpis naimportovaný za termín + 5 dní', () => {
  const paid = exp('2026-09-03', 199, 'Netflix', { import_hash: 'kb:1' })
  // termín 3. 10., konec lhůty 8. 10.
  assert.deepEqual(alertTypes(sub(), [paid, exp('2026-10-07', 50, 'Lidl', { import_hash: 'kb:2' })]), [])
  assert.deepEqual(alertTypes(sub(), [paid, exp('2026-10-08', 50, 'Lidl', { import_hash: 'kb:2' })]), ['missing'])
})

test('platba chybí: bez importu ani uvnitř lhůty žádný falešný poplach', () => {
  assert.deepEqual(alertTypes(sub(), [exp('2026-09-03', 199, 'Netflix'), exp('2026-11-01', 50, 'Lidl')]), [])
  const rows = [exp('2026-10-01', 199, 'Netflix', { import_hash: 'kb:1' }), exp('2026-11-05', 50, 'Lidl', { import_hash: 'kb:2' })]
  assert.deepEqual(alertTypes(sub(), rows, '2026-11-06'), [])
})

test('platba chybí: bez spárované platby se nehlásí', () => {
  assert.deepEqual(alertTypes(sub({ started_on: '2026-08-01' }), [exp('2026-11-01', 50, 'Lidl', { import_hash: 'kb:2' })]), [])
})

test('platíte i po zrušení: platba po ended_on ano, v den zrušení ne', () => {
  const cancelled = sub({ status: 'cancelled', ended_on: '2026-10-03' })
  assert.deepEqual(alertTypes(cancelled, [exp('2026-10-03', 199, 'Netflix')]), [])
  assert.deepEqual(alertTypes(cancelled, [exp('2026-10-03', 199, 'Netflix'), exp('2026-11-03', 199, 'Netflix')]), ['after-cancel'])
})

test('zrušené předplatné nehlásí chybějící platbu ani zdražení', () => {
  const alerts = subscriptionAlerts(sub({ status: 'cancelled', ended_on: '2026-11-01' }), [{ date: '2026-08-03', amount: 100 }, { date: '2026-09-03', amount: 200 }], null, NOW, NOW)
  assert.deepEqual(alerts, [])
})

// ---------------------------------------------------------------- souhrn

test('souhrn: přepočet na měsíc a rok', () => {
  assert.deepEqual(subscriptionCosts([sub({ amount: 100 }), sub({ amount: 1200, interval: 'yearly' }), sub({ amount: 300, interval: 'quarterly' }), sub({ amount: 10, interval: 'weekly' })]), {
    monthly: Math.round((1200 + 1200 + 1200 + 520) / 12),
    yearly: 4120,
  })
  assert.deepEqual(subscriptionCosts([]), { monthly: 0, yearly: 0 })
})

test('přehled: aktivní podle příští platby, zamítnuté nikde, celkem zaplaceno', () => {
  const rows = [exp('2026-10-20', 199, 'Netflix'), exp('2026-09-20', 199, 'Netflix'), exp('2026-10-10', 169, 'Spotify')]
  const data = buildSubscriptionData({
    subscriptions: [
      sub(),
      sub({ id: 's2', name: 'Spotify', match_text: 'spotify', amount: 169 }),
      sub({ id: 's3', name: 'Lidl', match_text: 'lidl', status: 'ignored' }),
      sub({ id: 's4', name: 'HBO', match_text: 'hbo', status: 'cancelled', ended_on: '2026-02-01' }),
    ],
    transactions: rows,
    now: NOW,
  })
  assert.deepEqual(data.active.map((a) => a.subscription.id), ['s2', 's1'])
  assert.equal(data.active[1].total, 398)
  assert.deepEqual(data.cancelled.map((a) => a.subscription.id), ['s4'])
  assert.equal(data.costs.monthly, 368)
  assert.deepEqual(data.upcoming.map((u) => u.date), ['2026-11-10', '2026-11-20'])
})

test('popisky: období a počet plateb', () => {
  assert.equal(subscriptionPeriodLabel(sub({ started_on: '2024-03-15' })), 'Od 03/2024')
  assert.equal(subscriptionPeriodLabel(sub({ started_on: '2024-03-15', ended_on: '2026-08-01' })), '03/2024 – 08/2026')
  assert.equal(paymentsLabel(1), '1 platba')
  assert.equal(paymentsLabel(3), '3 platby')
  assert.equal(paymentsLabel(12), '12 plateb')
})
