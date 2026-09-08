/**
 * delivery-guard.test — v0.8.34 交付门（b90dee61 案底回归）
 *
 * 案底：合同 8 组只落账 3 组、terminal_check 未归零，模型仍写「交付完成」+ 自跑 8/8 表格。
 * g1 未闭环 + 交付声明 ⇒ 判脱离（列出未落账组）
 * g2 已全部落账 ⇒ 不判脱离
 * g3 无交付声明 ⇒ 不判脱离
 * g4 非 rolling/final 阶段 ⇒ 不判脱离
 * g5 阻断提示文本：含组名 + 指路 terminal_check + 明说别写「交付完成」
 * g6 交付声明识别：中英文常见终语命中，普通叙述不误伤
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { detectDetachedDelivery, deliveryWarningText, hasDeliveryClaim, unsettledGroups } = await import('../src/delivery-guard.js')

const state = (titles, settledIdx = []) => ({
  stage: 'rolling',
  groups: titles.map((t, i) => ({ title: t, settled: settledIdx.includes(i) ? { at: 1, verdict: 'pass' } : null })),
})

test('g1 未闭环 + 交付声明 ⇒ 判脱离', () => {
  const s = state(['内核', 'CFOP', '渲染', '拖拽', '演示', '单文件', '端到端'], [0, 1, 2])
  const r = detectDetachedDelivery(s, { text: '交付完成。以下是实测证据……', stage: 'rolling' })
  assert.equal(r.detached, true)
  assert.deepEqual(r.groups, ['拖拽', '演示', '单文件', '端到端'])
  assert.match(r.reason, /4 组未落账/)
})

test('g2 已全部落账 ⇒ 不判脱离', () => {
  const s = state(['A', 'B'], [0, 1])
  assert.equal(detectDetachedDelivery(s, { text: '交付完成', stage: 'rolling' }).detached, false)
})

test('g3 无交付声明 ⇒ 不判脱离', () => {
  const s = state(['A', 'B'], [0])
  const r = detectDetachedDelivery(s, { text: '正在检查第 3 组判据……', stage: 'rolling' })
  assert.equal(r.detached, false)
  assert.equal(r.reason, '本回合无交付声明')
  assert.deepEqual(unsettledGroups(s), ['B'])
})

test('g4 非 rolling/final 阶段 ⇒ 不判脱离', () => {
  const s = { ...state(['A'], []), stage: 'brainstorm' }
  assert.equal(detectDetachedDelivery(s, { text: '交付完成', stage: 'brainstorm' }).detached, false)
})

test('g5 阻断提示：含组名 + 指路 + 明说别写交付完成', () => {
  const t = deliveryWarningText(['拖拽', '演示', '单文件', '端到端', '第六组'])
  assert.match(t, /交付门/)
  assert.match(t, /5 组未落账/)
  assert.match(t, /拖拽/)
  assert.match(t, /optimal_converge/)
  assert.match(t, /terminal_check/)
  assert.match(t, /不要写「交付完成」/)
  assert.equal(deliveryWarningText([]), '')
})

test('g6 交付声明识别：终语命中，普通叙述不误伤', () => {
  for (const s of ['交付完成', '任务完成。', '全部完成 ✅', 'all done', '工作完成，文件已就位']) {
    assert.equal(hasDeliveryClaim(s), true, s)
  }
  for (const s of ['正在跑判据', '第 2 组还没落账', 'completed the third group but two remain', '我完成了内核组的实现，接下来做 CFOP'.replace('完成了内核组', '在推进内核组')]) {
    assert.equal(hasDeliveryClaim(s), false, s)
  }
})
