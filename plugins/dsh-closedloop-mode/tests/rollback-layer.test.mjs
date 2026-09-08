/**
 * rollback-layer.test — v0.8.16 回炉分层协议化（结构化码判定，与文案无关）
 * rl1 码直判：unequal→reasoning；no-number/declared-mismatch→transcription
 * rl2 端到端：converge 产生 unequal → rollback 层=reasoning
 * rl3 端到端：converge 无实测数字（no-number）→ rollback 层=transcription
 * rl4 文案无关：同一码配任意文案，判定不变（旧实现靠正则反解文案）
 * rl5 无码兼容：存量栈/外部调用走旧正则口径；模型自报（declared）保守=reasoning
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'rbl-'))
const { declareStep, convergeStep, rollbackStep, loadStack, classifyRollbackLayer } = await import('../src/optimal-engine.js')

const DV = { beforeBand: 'far', measuredBand: 'at', channels: ['盘档: state.json', '运行时: 日志'] }
const decl = (sid, key, value) => declareStep(sid, {
  title: 'T', invariants: ['不变量'],
  predictions: [{ key, value, source: 'prior:测试' }],
  cost: [{ failure: 'f', defense: 'd' }],
  law: [{ signal: 's', action: 'a' }],
  measure: { right: 'r', wrongSignal: 'w', channels: ['a', 'b'] },
  vExpect: 'improve', confidence: 'high',
})

test('rl1 码直判（语义表）', () => {
  assert.equal(classifyRollbackLayer(['任意文案'], ['unequal']), 'reasoning')
  assert.equal(classifyRollbackLayer(['任意文案'], ['no-number']), 'transcription')
  assert.equal(classifyRollbackLayer(['任意文案'], ['declared-mismatch']), 'transcription')
  assert.equal(classifyRollbackLayer(['a', 'b'], ['no-number', 'unequal']), 'reasoning', '混合=保守推理层')
})

test('rl2 端到端：实测≠声明 → reasoning', () => {
  const sid = 'rl2'
  assert.equal(decl(sid, 'k', '1').ok, true)
  convergeStep(sid, { agreedPairs: [{ key: 'k', measured: '2', predicted: '1' }], dv: DV })
  assert.deepEqual(loadStack(sid).steps[0].discrepancyCodes, ['unequal'])
  const r = rollbackStep(sid, '数值不符，重推建模')
  assert.equal(r.ok, true)
  assert.equal(loadStack(sid).rolledBack.at(-1).layer, 'reasoning')
  assert.deepEqual(loadStack(sid).rolledBack.at(-1).codes, ['unequal'])
})

test('rl3 端到端：无数值实证 → transcription', () => {
  const sid = 'rl3'
  assert.equal(decl(sid, 'k', '1').ok, true)
  convergeStep(sid, { agreedPairs: [{ key: 'k', measured: '一切正常', predicted: '1' }], dv: DV })
  assert.deepEqual(loadStack(sid).steps[0].discrepancyCodes, ['no-number'])
  rollbackStep(sid, '补实测数字')
  assert.equal(loadStack(sid).rolledBack.at(-1).layer, 'transcription')
})

test('rl4 文案无关（同一码任意文案判定不变）', () => {
  assert.equal(classifyRollbackLayer(['完全不含任何关键词的一句话'], ['unequal']), 'reasoning')
  assert.equal(classifyRollbackLayer(['这句话里有「不一致」和「假吻合」两个词'], ['no-number']), 'transcription', '码优先于文案词面')
})

test('rl5 无码兼容 + 模型自报保守', () => {
  assert.equal(classifyRollbackLayer(['k: 实测 31 与预测 30 不一致']), 'reasoning', '存量无码走旧口径')
  assert.equal(classifyRollbackLayer(['k: 假吻合（占位词…）']), 'transcription')
  assert.equal(classifyRollbackLayer(['k: 我自己申报的误差'], ['declared']), 'reasoning', '模型自报=推理层')
  assert.equal(classifyRollbackLayer([]), 'reasoning', '无记录=保守')
})
