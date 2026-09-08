/**
 * iou-settle.test — v0.8.31 欠据接线（trySettleGroups）
 * s1 纯 cmd 组落账 ⇒ 不产欠据
 * s2 含人判组落账 ⇒ 登记欠据（组名/文本/未付）
 * s3 落账回执口径：写「人判欠据」+ 支付方式，不再写「挂账」
 * s4 同组重复落账 ⇒ 欠据替换不累积
 * s5 本拍真人签收帧 ⇒ 落账前先付清该组（用户签了字，欠据直接 paid）
 * s6 签收不中的组 ⇒ 欠据仍开
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { trySettleGroups } = await import('../src/tools.js')
const { initMode, onGroupsEdit, openIOU } = await import('../src/mode-state.js')

/** 造一个"请求落账"的最小状态（组+已闭动作+栈闭合） */
function settleState(accept) {
  const r = onGroupsEdit(initMode(), [{ title: 'G', spec: '测试组', accept, verify: 'self', closeRequested: true }])
  assert.equal(r.ok, true, r.error || '')
  return { ...r.state, stage: 'rolling', weightsLocked: true, closed: [{ title: 'A', group: 'G', at: Date.now() }] }
}
const STEPS = [{ title: 'A', status: 'closed' }]
const CMD = 'cmd: node --test D:/dsh/dsh-closedloop-mode/tests/iou-settle.test.mjs'
const HUMAN = '人判: 开发者目测：池核美学与尺度'

test('s1 纯 cmd 组落账 ⇒ 不产欠据', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s1-'))
  const out = await trySettleGroups(settleState([CMD]), STEPS, new Set(), dir)
  assert.notEqual(out.state.groups[0].settled, null, out.notes.join(' / '))
  assert.equal(openIOU(out.state).length, 0, 'cmd 判据有机器读数，不入欠据')
})

test('s2 含人判组落账 ⇒ 登记欠据', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s2-'))
  const out = await trySettleGroups(settleState([CMD, HUMAN]), STEPS, new Set(), dir)
  assert.notEqual(out.state.groups[0].settled, null, out.notes.join(' / '))
  const open = openIOU(out.state)
  assert.equal(open.length, 1)
  assert.deepEqual([open[0].group, open[0].text], ['G', '开发者目测：池核美学与尺度'])
})

test('s3 落账回执口径：人判欠据 + 支付方式，不写挂账', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s3-'))
  const out = await trySettleGroups(settleState([CMD, HUMAN]), STEPS, new Set(), dir)
  const joined = out.notes.join('\n')
  assert.equal(joined.includes('人判欠据'), true, joined)
  assert.equal(joined.includes('签收 G'), true, '必须给出支付方式')
  assert.equal(joined.includes('挂账'), false, '旧口径（挂账=可放行）不得残留：' + joined)
})

test('s4 同组重复落账 ⇒ 欠据替换不累积', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s4-'))
  const s0 = settleState([CMD, HUMAN])
  const first = await trySettleGroups(s0, STEPS, new Set(), dir)
  // 解开 settled 再来一次（模拟重落账）
  const again = { ...first.state, groups: first.state.groups.map((g) => ({ ...g, settled: null })) }
  const second = await trySettleGroups(again, STEPS, new Set(), dir)
  assert.equal(openIOU(second.state).length, 1, '同组未付项被替换，不累积')
})

test('s5 真人签收帧（下一拍）⇒ 付清该组', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s5-'))
  const first = await trySettleGroups(settleState([CMD, HUMAN]), STEPS, new Set(), dir)
  assert.equal(openIOU(first.state).length, 1, '落账时登记欠据')
  // 现实时序：落账回执索取 → 开发者回「签收 G」→ 下一拍（任何落账/终检）先付款
  const second = await trySettleGroups(first.state, STEPS, new Set(['G']), dir)
  assert.equal(openIOU(second.state).length, 0, '签了字就该付清')
  assert.equal(second.state.iou[0].paidAt > 0, true, 'paidAt 落盘可追')
})

test('s6 签收不中的组 ⇒ 欠据仍开', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'iou-s6-'))
  const out = await trySettleGroups(settleState([CMD, HUMAN]), STEPS, new Set(['别的组']), dir)
  assert.equal(openIOU(out.state).length, 1)
})
