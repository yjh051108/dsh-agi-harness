/**
 * rollback-cause.test — v0.8.24 回炉 cause 结构化
 * rc1 rollbackStep 落结构化 cause，rolledBack 条目带 cause
 * rc2 枚举外的 cause 归 model（默认计入，不洗白）
 * rc3 rank 外部判定：结构化优先，无 cause 回退旧正则
 * rc4 定价返工判定：只有 model 计入
 * rc5 探针键大小写不敏感（evidenced 假阴性修复）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'rc-'))
const { declareStep, rollbackStep, loadStack, probeKeyFor } = await import('../src/optimal-engine.js')
const { isExternalRollback } = await import('../src/rank-organ.js')
const { countsTowardRework } = await import('../src/pricing-organ.js')

const decl = (sid) => declareStep(sid, {
  title: 'T', invariants: ['i'],
  predictions: [{ key: 'k', value: '1', source: 'prior:t' }],
  cost: [{ failure: 'f', defense: 'd' }],
  law: [{ signal: 's', action: 'a' }],
  measure: { right: 'r', wrongSignal: 'w', channels: ['a', 'b'] },
  vExpect: 'improve', confidence: 'high',
})

test('rc1 结构化 cause 落账', () => {
  const sid = 'rc1'
  assert.equal(decl(sid).ok, true)
  assert.equal(rollbackStep(sid, '外部依赖换了，重推', 'external').ok, true)
  assert.equal(loadStack(sid).rolledBack.at(-1).cause, 'external')
})

test('rc2 枚举外/缺省一律 model', () => {
  for (const [sid, cause] of [['rc2a', undefined], ['rc2b', 'whatever'], ['rc2c', '']]) {
    assert.equal(decl(sid).ok, true)
    rollbackStep(sid, '预测来源错了，重推', cause)
    assert.equal(loadStack(sid).rolledBack.at(-1).cause, 'model', `cause=${cause}`)
  }
})

test('rc3 rank 外部判定：结构化优先 + 旧账本兼容', () => {
  assert.equal(isExternalRollback({ cause: 'external', reason: '随便写' }), true)
  assert.equal(isExternalRollback({ cause: 'process-death', reason: '' }), true)
  assert.equal(isExternalRollback({ cause: 'model', reason: '外部原因' }), false, 'cause=model 时不看措辞')
  assert.equal(isExternalRollback({ reason: '外部依赖变更' }), true, '无 cause 走旧正则')
  assert.equal(isExternalRollback({ reason: '预测来源错了' }), false)
})

test('rc4 定价返工：只有 model 计入', () => {
  assert.equal(countsTowardRework({ cause: 'model' }), true)
  assert.equal(countsTowardRework({ cause: 'deliberate', reason: '随便写' }), false)
  assert.equal(countsTowardRework({ cause: 'external' }), false)
  assert.equal(countsTowardRework({ reason: 'E2E 验闸' }), false, '无 cause 旧正则兼容')
  assert.equal(countsTowardRework({ reason: '预测来源错了' }), true)
})

test('rc5 探针键大小写不敏感', () => {
  const probes = { MyProbe: { cmd: 'x' }, 'probe-cwd-001': { cmd: 'y' } }
  assert.equal(probeKeyFor(probes, 'myprobe'), 'MyProbe', '大写键旧实现查不到 → evidenced 假阴性')
  assert.equal(probeKeyFor(probes, 'MYPROBE'), 'MyProbe')
  assert.equal(probeKeyFor(probes, 'probe-cwd-001'), 'probe-cwd-001')
  assert.equal(probeKeyFor(probes, 'nope'), '')
  assert.equal(probeKeyFor(null, 'x'), '')
})
