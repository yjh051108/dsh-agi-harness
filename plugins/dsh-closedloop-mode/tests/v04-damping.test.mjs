/**
 * v04-damping.test — 事件触发阻尼回归（THEORY-v0.4 §3.4/§3.6 阻尼外环）
 * 7 例：平台达k真/平台不足k假/震荡真/单调不震荡/借据突增/无信号静默/组合仲裁多信号
 * v0.4.0 追加 5 例接线面（dampingSignal 纯函数：无 V 静默 / I 信号+键稳定 / D 信号 / P 信号 / 单调静默）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-damp-'))
process.env.DSH_HOME = TMP

const { detectPlateau, detectOscillation, detectIouSurge, detectHighV, dampingLine } = await import('../src/v04-damping.js')
const { dampingSignal } = await import('../src/index.js')

test('d1 I 平台：尾部连续 4 个读数不动 ≥k=3 → plateau', () => {
  const r = detectPlateau([5, 3, 2, 2, 2, 2], { k: 3 })
  assert.equal(r.plateau, true)
  assert.equal(r.run, 3)
})

test('d2 I 不足：只动 2 个平台 <k → false', () => {
  assert.equal(detectPlateau([5, 3, 2, 2], { k: 3 }).plateau, false)
  assert.equal(detectPlateau([1, 1], { k: 3 }).plateau, false, '序列过短假')
})

test('d3 D 震荡：升-降-升-降 翻转≥3 → oscillating', () => {
  const r = detectOscillation([1, 2, 1, 2, 1], { m: 3 })
  assert.equal(r.oscillating, true)
  assert.equal(r.flips, 3)
})

test('d4 D 单调不震荡：一路降 flips=0', () => {
  assert.equal(detectOscillation([5, 4, 3, 2, 1], { m: 3 }).oscillating, false)
})

test('d5 D 借据突增：窗口 5 内签发 3 张 → surge', () => {
  assert.equal(detectIouSurge([12, 14, 15], {}, 15).surge, true)
  assert.equal(detectIouSurge([2, 14, 15], {}, 15).surge, false, '窗口外不算')
})

test('d6 无信号全静默：dampingLine→null（零仪式税）', () => {
  assert.equal(dampingLine({}), null)
  assert.equal(dampingLine({ plateau: false, oscillating: false, iouSurge: false }), null)
})

test('d7 组合仲裁：平台+高V → 两信号同行输出', () => {
  const line = dampingLine({ plateau: true, highV: true })
  assert.match(line, /阻尼·I/)
  assert.match(line, /阻尼·P/)
  assert.match(line, /重规划/, 'I 出路=滚动时域')
  assert.equal(detectHighV(8, 10).high, true)
  assert.equal(detectHighV(2, 10).high, false)
})

/* ---------- v0.4.0 接线面（dampingSignal：盘档 V 序列→信号→注入决策，纯函数可测） ---------- */

const stateOf = (vs, withMeasure = true) => ({
  closed: vs.map((v) => (typeof v === 'number' ? { v } : v)),
  cost: { purpose: 'p', assertions: withMeasure
    ? [{ text: 'a', severity: 'major', source: 'x', measure: { cmd: 'node -e "process.exit(0)"', kind: 'bool' } }]
    : [{ text: 'a', severity: 'major', source: 'x' }] },
})

test('d8 接线静默：closed 无 V 序列（未测断言不落 V）→ dampingSignal null', () => {
  assert.equal(dampingSignal(stateOf([], false)), null)
  assert.equal(dampingSignal({ closed: [{ title: 'A1' }, { title: 'A2' }], cost: { assertions: [] } }), null)
})

test('d9 接线 I：尾部平台 V 序列 → 阻尼·I 行 + 幂等键两次调用稳定（同键不重注）', () => {
  const s = stateOf([4, 0.5, 0.5, 0.5, 0.5])
  const a = dampingSignal(s)
  assert.match(a.line, /阻尼·I/)
  assert.doesNotMatch(a.line, /阻尼·D|阻尼·P/)
  assert.equal(a.key, 'damp:100')
  assert.deepEqual(dampingSignal(s), a, '同态→同键')
})

test('d10 接线 D：V 序列震荡（差分符号翻转≥3）→ 阻尼·D 行（冻结自动闭合升级人审）', () => {
  const r = dampingSignal(stateOf([1, 0.2, 0.9, 0.2, 0.9, 0.3]))
  assert.match(r.line, /阻尼·D/)
  assert.match(r.line, /升级人审/)
  assert.equal(r.key, 'damp:010')
})

test('d11 接线 P：最新 V > 总权重×0.6 → 阻尼·P 行（本段闭合建议加另头审）', () => {
  const r = dampingSignal(stateOf([0.5, 0.5, 1.5]))
  assert.match(r.line, /阻尼·P/)
  assert.doesNotMatch(r.line, /阻尼·I|阻尼·D/)
})

test('d12 接线静默：单调降+低 V+无平台 → null（零仪式税）', () => {
  assert.equal(dampingSignal(stateOf([2, 1, 0.5, 0.2])), null)
})

test('d13 v0.4.1-F5 同源：V 序列取每动作最终态（vAfterAudit ?? v）——v 全同但最终态震荡 → D 行（旧语义会误判平台 I）', () => {
  const s = stateOf([{ v: 1, vAfterAudit: 1 }, { v: 1, vAfterAudit: 0.2 }, { v: 1, vAfterAudit: 0.9 }, { v: 1, vAfterAudit: 0.2 }, { v: 1, vAfterAudit: 0.9 }, { v: 1, vAfterAudit: 0.3 }])
  const r = dampingSignal(s)
  assert.match(r.line, /阻尼·D/, '最终态序列震荡被检出')
  assert.doesNotMatch(r.line, /阻尼·I/, 'v 序列的平台语义不遮蔽最终态震荡')
  assert.equal(r.key, 'damp:010')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
