/**
 * iou-ledger.test — v0.8.31 欠据账（纯函数层）
 * i1 登记：人判项入欠据（组名/文本/未付态）
 * i2 空项/空组名不添键（round-trip 键纪律）
 * i3 同组重登：旧未付项被替换，已付项保留为史
 * i4 payIOU 组名精确支付：只付该组
 * i5 payIOU「全部」：全付且幂等（已付 paidAt 不被刷新）
 * i6 无欠据/空签收：返回原状态（同一引用）
 * i7 往返：serialize→deserialize 保留 iou（未付+已付）；空欠据不出键
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { initMode, recordIOU, payIOU, openIOU, serializeState, deserializeState } = await import('../src/mode-state.js')

test('i1 登记：人判项入欠据', () => {
  const s = recordIOU(initMode(), 'G1', ['开发者目测：池核美学', '真机试听：嗡鸣'])
  assert.equal(s.iou.length, 2)
  assert.deepEqual(s.iou.map((e) => [e.group, e.text, e.paidAt]), [['G1', '开发者目测：池核美学', null], ['G1', '真机试听：嗡鸣', null]])
  assert.equal(openIOU(s).length, 2)
})

test('i2 空项/空组名不添键', () => {
  const s0 = initMode()
  assert.equal('iou' in s0, false, '初始态无 iou 键')
  assert.equal(recordIOU(s0, 'G1', []), s0, '空项=原状态')
  assert.equal(recordIOU(s0, '', ['x']), s0, '空组名=原状态')
  assert.equal(recordIOU(s0, 'G1', ['   ']), s0, '全空白项=原状态')
})

test('i3 同组重登：旧未付项被替换，已付项保留', () => {
  let s = recordIOU(initMode(), 'G1', ['旧项A', '旧项B'])
  s = payIOU(s, new Set(['G1']))
  s = recordIOU(s, 'G1', ['新项C'])
  const texts = s.iou.map((e) => e.text)
  assert.deepEqual(texts.sort(), ['新项C', '旧项A', '旧项B'].sort(), '已付项留史，未付项被替换')
  assert.equal(openIOU(s).length, 1)
  assert.equal(openIOU(s)[0].text, '新项C')
})

test('i4 payIOU 组名精确支付：只付该组', () => {
  let s = recordIOU(initMode(), 'G1', ['a'])
  s = recordIOU(s, 'G2', ['b'])
  s = payIOU(s, new Set(['G1']))
  assert.deepEqual(openIOU(s).map((e) => e.group), ['G2'])
})

test('i5 payIOU「全部」：全付且幂等', () => {
  let s = recordIOU(initMode(), 'G1', ['a'])
  s = recordIOU(s, 'G2', ['b'])
  const paid = payIOU(s, new Set(['全部']))
  assert.equal(openIOU(paid).length, 0)
  const again = payIOU(paid, new Set(['全部']))
  assert.equal(again, paid, '已付无可变=同一引用（幂等）')
  assert.equal(again.iou[0].paidAt, paid.iou[0].paidAt, 'paidAt 不被刷新')
})

test('i6 无欠据/空签收：返回原状态', () => {
  const s0 = initMode()
  assert.equal(payIOU(s0, new Set(['全部'])), s0)
  const s1 = recordIOU(s0, 'G1', ['a'])
  assert.equal(payIOU(s1, new Set()), s1, '空签收=原状态')
  assert.equal(payIOU(s1, new Set(['不存在的组'])), s1, '不中=原状态')
})

test('i7 往返：serialize→deserialize 保留 iou；空欠据不出键', () => {
  let s = recordIOU(initMode(), 'G1', ['a', 'b'])
  s = payIOU(s, new Set(['G1']))
  const round = deserializeState(JSON.parse(JSON.stringify(serializeState(s))))
  assert.equal(round.iou.length, 2)
  assert.equal(round.iou.every((e) => typeof e.paidAt === 'number'), true, '已付态跨盘保留')
  const empty = JSON.parse(JSON.stringify(serializeState(initMode())))
  assert.equal('iou' in empty, false, '空欠据落盘不出键（JSON round-trip 严格等值）')
  const junk = deserializeState({ v: 3, stage: 'rolling', iou: [{ group: '', text: 'x' }, { group: 'G', text: '' }, { group: 'G', text: 'ok' }] })
  assert.deepEqual(junk.iou.map((e) => e.text), ['ok'], '坏条目被剔除，不留空壳')
})
