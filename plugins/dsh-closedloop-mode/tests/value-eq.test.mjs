/**
 * value-eq.test — v0.8.12 数值协议化（去「字符串比较」脆弱性）
 * ne1 同一数值的不同序列化归一：1/1.0、01/1、3.50/3.5
 * ne2 符号位不可被降级层吞掉：-1 ≠ 1（含词数混排 ΔV -0.5 ≠ ΔV 0.5）
 * ne3 版本串不被数值层吞并：v0.4.5 ≠ v0.4.4
 * ne4 词数混排仍兼容且按数值比：「命中 1」==「命中 1.0」
 * ne5 端到端：结构化对账 measured '1.0' / 声明 '1' → 闭合（旧实现必判不等）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'veq-'))
process.env.DSH_HOME = TMP
const { declareStep, convergeStep, loadStack, valueEq } = await import('../src/optimal-engine.js')

const DV = { beforeBand: 'far', measuredBand: 'at', channels: ['盘档: state.json', '运行时: 日志'] }

test('ne1 同一数值的不同序列化判等', () => {
  assert.equal(valueEq('1', '1.0'), true, '1 与 1.0 是同一数值')
  assert.equal(valueEq('01', '1'), true, '前导零')
  assert.equal(valueEq('3.50', '3.5'), true, '尾随零')
  assert.equal(valueEq('1', '2'), false, '真不等仍不等')
})

test('ne2 符号位不可被降级层吞掉', () => {
  assert.equal(valueEq('-1', '1'), false, '旧实现 allNums 丢符号 → 假等值')
  assert.equal(valueEq('ΔV -0.5', 'ΔV 0.5'), false, '词数混排同样保留符号')
  assert.equal(valueEq('ΔV -0.5', 'ΔV -0.50'), true, '符号相同→数值归一')
})

test('ne3 版本串不被数值层吞并', () => {
  assert.equal(valueEq('v0.4.5', 'v0.4.4'), false, 'v0.4.4 案底护栏')
  assert.equal(valueEq('v0.4.5', 'v0.4.5'), true, '同版本串 raw 等值')
})

test('ne4 词数混排仍兼容且按数值比', () => {
  assert.equal(valueEq('命中 1', '命中 1.0'), true, '同一数值不同序列化')
  assert.equal(valueEq('命中 1', '命中 2'), false)
})

test('ne5 端到端：measured 1.0 / 声明 1 → 闭合', () => {
  const sid = 'ne5'
  const d = declareStep(sid, {
    title: 'T', invariants: ['不变量'],
    predictions: [{ key: 'k', value: '1', source: 'prior:测试' }],
    cost: [{ failure: 'f', defense: 'd' }],
    law: [{ signal: 's', action: 'a' }],
    measure: { right: 'r', wrongSignal: 'w', channels: ['a', 'b'] },
    vExpect: 'improve', confidence: 'high',
  })
  assert.equal(d.ok, true, d.error || '')
  const r = convergeStep(sid, { agreedPairs: [{ key: 'k', measured: '1.0', predicted: '1' }], dv: DV })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(loadStack(sid).steps[0].status, 'closed', '序列化差异不得阻止闭合')
})
