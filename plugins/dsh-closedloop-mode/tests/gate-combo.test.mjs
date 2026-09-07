/**
 * gate-combo.test — v0.7.4 Phase 8+9 闸间组合学习 + 健康门升降回归锁（恰好 4 例，守声明之约）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { recordCombo, comboWeight, downweightedGates, comboPenalty } = await import('../src/gate-combo.js')

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cl-combo-')) }

test('C1 组合学习：2 闸同活跃 5 次（3 闭 2 炉）→comboWeight 学到 0.6 闭/0.4 炉', () => {
  const dir = tmp()
  for (let i = 0; i < 5; i++) recordCombo({ gates: ['step_hint', 'deviation'], closed: i < 3, rerolled: i >= 3, dir })
  const w = comboWeight(['deviation', 'step_hint'], dir) // 顺序无关
  assert.ok(w, '数据足够=有权重')
  assert.equal(w.weight, 0.6, '闭合率 0.6 从数据学')
  assert.equal(w.rerollRate, 0.4, '回炉率 0.4')
  assert.equal(w.trials, 5)
})

test('C2 数据不足=不据以决策：4 次（<MIN_TRIALS 5）→comboWeight null', () => {
  const dir = tmp()
  for (let i = 0; i < 4; i++) recordCombo({ gates: ['baseline', 'progress'], closed: true, dir })
  assert.equal(comboWeight(['baseline', 'progress'], dir), null, '样本不足→null（诚实不据噪声决策）')
})

test('C3 健康门降权：高回炉组合被列出、低回炉不列（不删只标）', () => {
  const dir = tmp()
  for (let i = 0; i < 6; i++) recordCombo({ gates: ['friction', 'step_hint'], closed: false, rerolled: true, dir }) // 全炉
  for (let i = 0; i < 6; i++) recordCombo({ gates: ['baseline', 'deviation'], closed: true, dir }) // 全闭
  const bad = downweightedGates(0.5, dir)
  const keys = bad.map((b) => b.combo.sort().join('+'))
  assert.ok(keys.includes('friction+step_hint'), '高回炉组合降权列出')
  assert.ok(!keys.includes('baseline+deviation'), '低回炉组合不列（不误伤）')
})

test('C4 消费口降频：候选含坏组合→comboPenalty 返回该组合供注入面降频', () => {
  const dir = tmp()
  for (let i = 0; i < 6; i++) recordCombo({ gates: ['friction', 'step_hint'], closed: false, rerolled: true, dir })
  const pen = comboPenalty(['step_hint', 'friction', 'baseline'], dir)
  assert.deepEqual([...pen].sort(), ['friction', 'step_hint'], '命中高回炉组合→返回降权集')
  assert.equal(comboPenalty(['baseline', 'deviation'], dir), null, '无坏组合→不罚')
})

process.on('exit', () => { for (const d of []) { try { fs.rmSync(d, { recursive: true, force: true }) } catch {} } })
