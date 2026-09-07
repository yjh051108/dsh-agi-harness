/**
 * v04-core.test — 基数V与借据回归（THEORY-v0.4 §3.2/§3.5【修1/2】）
 * 8 例：zOf bool/zOf ratio 截断/zOf count 无 target/V 计算/V 全绿=0/借据到期变红/借据赎回/爆预算拒
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { clamp01, zOf, vCompute, initIouBook, registerIou, tickIOU, redeemIOU, effectiveMeasures, vWithIOU } = await import('../src/v04-core.js')

const m = (id, w, kind = 'bool', target = null) => ({ id, w, kind, target, cmd: 'x' })

/* ---------- zOf ---------- */
test('c1 zOf bool：exit=0→z=1；exit≠0→z=0', () => {
  assert.equal(zOf(m('a', 1), { exit: 0 }), 1)
  assert.equal(zOf(m('a', 1), { exit: 1 }), 0)
})

test('c2 zOf ratio：分数→[0,1]截断', () => {
  assert.equal(clamp01(0.5), 0.5)
  assert.equal(clamp01(-1), 0)
  assert.equal(clamp01(2), 1)
  assert.equal(zOf(m('a', 1, 'ratio', 10), { value: 5 }), 0.5)
  assert.equal(zOf(m('a', 1, 'ratio', 10), { value: 15 }), 1, '超 target 截 1')
})

test('c3 zOf count：无 target 时 value 直接截断', () => {
  assert.equal(zOf(m('a', 1, 'count'), { value: 0.7 }), 0.7)
  assert.equal(zOf(m('a', 1, 'count'), { value: 3 }), 1)
  assert.equal(zOf(m('a', 1, 'count'), { value: -1 }), 0)
})

/* ---------- V 计算 ---------- */
test('c4 vCompute：Σw(1−z) 正确', () => {
  const ms = [m('a', 2), m('b', 3)]
  const { V, rows } = vCompute(ms, { a: 1, b: 0 })
  assert.equal(V, 3, '2(1-1)+3(1-0)=0+3=3')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].z, 1)
  assert.equal(rows[1].z, 0)
})

test('c5 vCompute：全绿=V=0', () => {
  assert.equal(vCompute([m('a', 2), m('b', 3)], { a: 1, b: 1 }).V, 0)
})

/* ---------- 借据生命周期 ---------- */
test('c6 借据到期变红：register→tick(expired)→effectiveMeasures 含抵押→V 自动涨', () => {
  let book = initIouBook({ budget: 5 })
  const r = registerIou(book, { id: 'iou1', collateral: m('placeholder', 2), dueStep: 3, reason: '铺垫步' }, 1)
  assert.equal(r.ok, true)
  book = r.book
  assert.equal(vWithIOU([m('a', 1)], book, { a: 1 }).V, 0, '未到期不计入')
  const { book: book2, expired } = tickIOU(book, 3)
  assert.deepEqual(expired, ['iou1'])
  assert.equal(book2.humanReviewRequired, true)
  assert.ok(effectiveMeasures([m('a', 1)], book2).some((x) => x.id === 'placeholder'))
  assert.equal(vWithIOU([m('a', 1)], book2, { a: 1 }).V, 2, '到期变红 V+2')
})

test('c7 借据赎回：redeem→effectiveMeasures 不含→V 不涨', () => {
  let book = initIouBook({ budget: 5 })
  book = registerIou(book, { id: 'iou2', collateral: m('ph2', 1), dueStep: 5 }, 2).book
  const { book: book3 } = redeemIOU(book, 'iou2')
  assert.equal(vWithIOU([m('a', 1)], book3, { a: 1 }).V, 0)
})

test('c8 爆预算：在途权重超 budget → ok=false budgetFull', () => {
  let book = initIouBook({ budget: 3 })
  book = registerIou(book, { id: 'iou3', collateral: m('p3', 2), dueStep: 5 }, 1).book
  const r = registerIou(book, { id: 'iou4', collateral: m('p4', 2), dueStep: 5 }, 1)
  assert.equal(r.ok, false)
  assert.equal(r.budgetFull, true)
  assert.match(r.error, /预算耗尽/)
})
