/**
 * gate-ambient.test — v0.7.2 Phase 4 学习环闭合回归锁。
 * 验证：低命中闸→出行（真实权重驱动）、高命中不打扰、无数据不出、% 匹配实置信（消费非空模板）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-gamb-'))
process.env.DSH_HOME = TMP

const { recordGateEffect } = await import('../src/gate-core.js')
const { gateAmbientLine, PHASE_FOCUS } = await import('../src/gate-ambient.js')

test('a1 低命中闸触发行：seed step_hint 8 次 3 成→出行含真实命中率', () => {
  const model = 'amb-low'
  for (let i = 0; i < 8; i++) recordGateEffect({ gateId: 'step_hint', success: i < 3, model })
  const line = gateAmbientLine({ model, focusGates: PHASE_FOCUS.declare, phase: '声明前' })
  assert.match(line, /你的成长记录 · 声明前/, "标题在位")
  assert.match(line, /声明命中率 \d+%（8 次）/, '命中率+样本数被真实消费')
  assert.ok(!line.includes('探针命中率'), '只出最相关那条（取最低）')
})

test('a2 高命中闸不打扰：seed baseline 全成→无行（尊重注意力）', () => {
  const model = 'amb-high'
  for (let i = 0; i < 20; i++) recordGateEffect({ gateId: 'baseline', success: true, model })
  const line = gateAmbientLine({ model, focusGates: ['baseline'], phase: '探针' })
  assert.equal(line, '', '做得好=零注入')
})

test('a3 无数据不出：空 model→空串（不空喊）', () => {
  const line = gateAmbientLine({ model: 'amb-empty', focusGates: PHASE_FOCUS.declare })
  assert.equal(line, '', '无样本=不据此提醒')
})

test('a4 样本不足不出：seed 5 次（<MIN_TRIALS 8）→空', () => {
  const model = 'amb-few'
  for (let i = 0; i < 5; i++) recordGateEffect({ gateId: 'step_hint', success: false, model })
  const line = gateAmbientLine({ model, focusGates: ['step_hint'] })
  assert.equal(line, '', '少于 8 样本=噪声，不提醒')
})

test('a5 取最低命中闸：seed deviation 高+step_hint 低→出行是 step_hint', () => {
  const model = 'amb-min'
  for (let i = 0; i < 15; i++) recordGateEffect({ gateId: 'deviation', success: true, model })
  for (let i = 0; i < 12; i++) recordGateEffect({ gateId: 'step_hint', success: i < 2, model })
  const line = gateAmbientLine({ model, focusGates: PHASE_FOCUS.declare, phase: 'x' })
  assert.match(line, /声明命中率/, '取最需提醒的闸（step_hint 更低）')
  assert.ok(!line.includes('对账命中率'), '不同时堆多条（注意力预算）')
})

test('a6 学习环闭合实证：同一闸命中率变化→提示内容随之变（非硬编码）', () => {
  const model = 'amb-dyn'
  // 先差：8 次 2 成
  for (let i = 0; i < 8; i++) recordGateEffect({ gateId: 'step_hint', success: i < 2, model })
  const before = gateAmbientLine({ model, focusGates: ['step_hint'] })
  assert.match(before, /声明命中率 (\d+)%/, '低命中出提示')
  const pctBefore = parseInt(/命中率 (\d+)%/.exec(before)[1], 10)
  // 转好：再灌 40 次全成→命中率拉高越过 0.5→不再打扰
  for (let i = 0; i < 40; i++) recordGateEffect({ gateId: 'step_hint', success: true, model })
  const after = gateAmbientLine({ model, focusGates: ['step_hint'] })
  assert.equal(after, '', '命中率提升到阈值上→提示自动消失=权重真在驱动行为')
  assert.ok(pctBefore < 50, `初始命中率应低（实测 ${pctBefore}%）`)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
