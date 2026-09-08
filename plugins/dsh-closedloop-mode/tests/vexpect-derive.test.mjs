/**
 * vexpect-derive.test — v0.8.26 vExpect 推导化（消除「猜档位」摩擦）
 * vd1 省略 + ticketBand=at → maintain（source=derived）
 * vd2 省略 + ticketBand=far → improve
 * vd3 省略 + 无档（新合同）→ improve
 * vd4 显式 dip + dipPlan → 保留（source=declared）
 * vd5 显式 improve + ticketBand=at → 仍拒（保护不放松）
 * vd6 stackText 明示当前档
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'vd-'))
const { declareStep, convergeStep, loadStack, stackText } = await import('../src/optimal-engine.js')

const args = (over = {}) => ({
  title: 'T', invariants: ['i'],
  predictions: [{ key: 'k', value: '1', source: 'prior:t' }],
  cost: [{ failure: 'f', defense: 'd' }],
  law: [{ signal: 's', action: 'a' }],
  measure: { right: 'r', wrongSignal: 'w', channels: ['a', 'b'] },
  confidence: 'high',
  ...over,
})

test('vd1 省略 + at 档 → maintain', () => {
  const sid = 'vd1'
  const r = declareStep(sid, args({ ticketBand: 'at' }))
  assert.equal(r.ok, true, r.error || '')
  assert.equal(r.step.vExpect, 'maintain')
  assert.equal(r.step.vExpectSource, 'derived')
})

test('vd2/vd3 省略 + far / 无档 → improve', () => {
  for (const [sid, band] of [['vd2', 'far'], ['vd3', undefined]]) {
    const r = declareStep(sid, args({ ticketBand: band }))
    assert.equal(r.ok, true, r.error || '')
    assert.equal(r.step.vExpect, 'improve', `band=${band}`)
    assert.equal(r.step.vExpectSource, 'derived')
  }
})

test('vd4 显式 dip 保留（需 dipPlan）', () => {
  const sid = 'vd4'
  const bad = declareStep(sid, args({ vExpect: 'dip' }))
  assert.equal(bad.ok, false, 'dip 缺回升计划=拒')
  const r = declareStep(sid, args({ vExpect: 'dip', dipPlan: '下一步补交叉断言回升到 at' }))
  assert.equal(r.ok, true, r.error || '')
  assert.equal(r.step.vExpect, 'dip')
  assert.equal(r.step.vExpectSource, 'declared')
})

test('vd5 显式非法值仍拒（at 档 improve）', () => {
  const r = declareStep('vd5', args({ vExpect: 'improve', ticketBand: 'at' }))
  assert.equal(r.ok, false, 'maintainGate 保护不放松')
  assert.match(r.error, /maintainGate/)
  assert.match(r.error, /删掉/, '拒语指路：省略即推导')
})

test('vd6 stackText 明示当前档（按最后闭合步的实测档）', () => {
  const sid = 'vd6'
  assert.equal(declareStep(sid, args()).ok, true)
  const r = convergeStep(sid, { agreedPairs: [{ key: 'k', measured: '1', predicted: '1' }], dv: { beforeBand: 'far', measuredBand: 'at', channels: ['盘档: a.json', '运行时: 日志'] } })
  assert.equal(r.ok, true, r.error || '')
  assert.match(stackText(loadStack(sid)), /当前档=at/, '声明前可读')
})

test('vd7 端到端：materialize 不再注入 improve，at 档省略即推导 maintain', async () => {
  const cm = await import('../src/contract-merge.js')
  const diff = { title: '新步', group: 'g', predict: [{ key: 'k', value: '1', source: 'prior:测试' }], channels: ['read: a', 'rt: b'] }
  const m = cm.materialize({ lastBand: 'at', qn: [] }, diff)
  assert.equal(m.ok, true, m.error || '')
  assert.equal(m.contract.vExpect, undefined, '省略=undefined（旧实现注入 improve=摩擦源）')
  m.contract.ticketBand = 'at'
  const r = declareStep('vd7', { ...m.contract, invariants: ['i'], cost: [{ failure: 'f', defense: 'd' }], law: [{ signal: 's', action: 'a' }], confidence: 'high' })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(r.step.vExpect, 'maintain')
  assert.equal(r.step.vExpectSource, 'derived')
})
