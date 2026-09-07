/**
 * lqr-organ.test — v0.7.3 Phase 7 任务级 LQR 读数面回归锁（恰好 4 例，守声明之约）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-lqr-'))
process.env.DSH_HOME = TMP

const { recordGateEffect } = await import('../src/gate-core.js')
const { lqrReadout } = await import('../src/lqr-organ.js')
const { readRecords } = await import('../src/task-value-core.js')

const unfinishedState = {
  cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] },
  groups: [{ title: 'G', settled: false }],
  closed: [],
  residual: { groupsOpen: ['G'], closedCount: 0, lastBand: 'far' },
}
const doneState = {
  cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] },
  groups: [{ title: 'G', settled: true }],
  closed: [{ title: 'x', assertion: 'a' }],
  residual: { groupsOpen: [], closedCount: 1, lastBand: 'at' },
}

test('L1 候选随真实状态变：未完成→推进候选，已达→归零候选（非硬编码）', () => {
  const a = lqrReadout({ state: unfinishedState, stack: { rolledBack: [] }, model: 'lqr-l1' })
  const b = lqrReadout({ state: doneState, stack: { rolledBack: [] }, model: 'lqr-l1' })
  assert.match(a, /推进未完成目标/, '未完成态出推进候选')
  assert.match(b, /terminal_check 归零/, '已达态出归零候选')
  assert.notEqual(a, b, '两态读数不同=随状态变化')
})

test('L2 冷启动诚实未校准：无闸历史无趋势→含「未校准」不编百分比', () => {
  const line = lqrReadout({ state: unfinishedState, stack: { rolledBack: [] }, model: 'lqr-cold-none' })
  assert.match(line, /未校准/, '冷启动标注未校准')
  assert.match(line, /冷启动/, '头部标明冷启动态')
})

test('L3 不替模型选：读数无祈使句（应该选/必须选/禁止/只能选 皆不得现）', () => {
  const line = lqrReadout({ state: unfinishedState, stack: { rolledBack: [] }, model: 'lqr-l3' })
  assert.ok(line.length > 0, '有读数')
  assert.ok(!/应该选|必须选|禁止|只能选|建议你选|应当执行/.test(line), '无祈使越权句')
  assert.match(line, /供你自选/, '明确交还决策权')
})

test('L4 真实权重驱动：seed step_hint 低命中→候选含数据命中的百分比（非空模板）', () => {
  const model = 'lqr-wire'
  for (let i = 0; i < 12; i++) recordGateEffect({ gateId: 'step_hint', success: i < 4, model })
  const line = lqrReadout({ state: unfinishedState, stack: { rolledBack: [] }, model })
  assert.match(line, /声明命中 \d+%/, '候选预期由闸学到的真实命中率驱动')
})

test('L5 统一核心候选进入读数：open 步优先呈现为记录真实结果', () => {
  const line = lqrReadout({ state: unfinishedState, stack: { steps: [{ title: '正在实现', status: 'open' }], rolledBack: [] }, model: 'lqr-unified' })
  assert.match(line, /完成当前已打开动作并记录真实结果/)
})

test('L6 决策快照受控追加：默认读数零写，recordSnapshot 才落一条', () => {
  const model = 'lqr-snapshot'
  lqrReadout({ sid: 'snapshot-1', state: unfinishedState, stack: { steps: [], rolledBack: [] }, model })
  assert.equal(readRecords('task-decisions.jsonl').length, 0)
  lqrReadout({ sid: 'snapshot-1', state: unfinishedState, stack: { steps: [], rolledBack: [] }, model, recordSnapshot: true })
  assert.equal(readRecords('task-decisions.jsonl').length, 1)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
