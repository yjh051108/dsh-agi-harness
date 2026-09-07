/**
 * gate-core.test — v0.7.0 闸图核心引擎+质量账本回归锁。
 * 验证：闸创建/实时更新（无静默期）/三层存储/防污染/加权融合/模型绑定/质量签名/趋势查询。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-gate-'))
process.env.DSH_HOME = TMP

// ── gate-core ──
const gc = await import('../src/gate-core.js')

test('g1 闸注册表完整：17 闸×6 模块', () => {
  const reg = gc.getGateRegistry()
  const gateIds = Object.keys(reg)
  assert.equal(gateIds.length, gc.GATE_COUNT, `闸数=GATE_COUNT(${gc.GATE_COUNT})，实际=${gateIds.length}`)
  const modules = new Set(gateIds.map(id => reg[id].module))
  assert.ok(modules.size >= 5, `模块数≥5，实际=${modules.size}`)
})

test('g2 实时更新：第 1 次交互即更新置信（无静默期）', () => {
  const state = gc.recordGateEffect({ gateId: 'baseline', success: true, model: 'test' })
  assert.ok(state, '返回状态非空')
  assert.equal(state.trials, 1, 'trials=1（第一次就有）')
  assert.ok(state.confidence > 0, `置信>0（实时计算，不等阈值）`)
})

test('g3 三层存储：session→project 实时提交（≥5 次）', () => {
  // 重置（用新 model 隔离）
  const model = 'test-layer'
  for (let i = 0; i < 5; i++) {
    gc.recordGateEffect({ gateId: 'step_hint', success: true, model })
  }
  const q = gc.queryGate({ gateId: 'step_hint', model })
  assert.ok(q.layers.project.trials >= 1, `project 层已接收（≥5 session 触发提交），实际=${q.layers.project.trials}`)
  assert.ok(q.layers.session.trials >= 5, 'session 层 trials≥5')
})

test('g4 防污染：大量正常数据+少量反证=置信不动', () => {
  const model = 'test-pollution'
  // 100 次正常（80% 成功）
  for (let i = 0; i < 100; i++) {
    gc.recordGateEffect({ gateId: 'deviation', success: i % 5 !== 0, model })
  }
  const before = gc.queryGate({ gateId: 'deviation', model })
  const harnessBefore = before.layers.session.confidence

  // 5 次全失败（污染）
  for (let i = 0; i < 5; i++) {
    gc.recordGateEffect({ gateId: 'deviation', success: false, model })
  }
  const after = gc.queryGate({ gateId: 'deviation', model })
  const harnessAfter = after.layers.session.confidence

  // 置信变化 < 10%
  const change = Math.abs(harnessAfter - harnessBefore) / Math.max(harnessBefore, 0.01)
  assert.ok(change < 0.10, `置信变化 ${change.toFixed(3)} < 0.10（防污染）`)
})

test('g5 加权融合：三层置信加权后输出 fusedConfidence', () => {
  const model = 'test-fuse'
  // 只操作 session 层
  for (let i = 0; i < 10; i++) {
    gc.recordGateEffect({ gateId: 'persona', success: i < 8, model })
  }
  const q = gc.queryGate({ gateId: 'persona', model })
  assert.ok(typeof q.fusedConfidence === 'number', 'fusedConfidence 是数字')
  assert.ok(q.fusedConfidence >= 0 && q.fusedConfidence <= 1, '置信在 [0,1]')
  assert.ok(q.layers.session.confidence > 0, 'session 层有数据')
})

test('g6 模型绑定：不同 model 的闸数据隔离', () => {
  const modelA = 'test-model-a'
  const modelB = 'test-model-b'
  for (let i = 0; i < 3; i++) {
    gc.recordGateEffect({ gateId: 'rank_signal', success: true, model: modelA })
  }
  const qa = gc.queryGate({ gateId: 'rank_signal', model: modelA })
  const qb = gc.queryGate({ gateId: 'rank_signal', model: modelB })
  assert.ok(qa.layers.session.trials > 0, 'modelA 有数据')
  assert.equal(qb.layers.session.trials, 0, 'modelB 无数据（隔离）')
})

test('g7 模块查询：按模块名批量查闸', () => {
  const injectionGates = gc.queryModule('injection', 'test')
  assert.ok(injectionGates.length >= 4, `injection 模块 ≥4 闸，实际=${injectionGates.length}`)
  const actionGates = gc.queryModule('action', 'test')
  assert.ok(actionGates.length >= 3, `action 模块 ≥3 闸，实际=${actionGates.length}`)
})

test('g8 全局快照：所有闸可一次查询', () => {
  const snap = gc.snapshotAll('test')
  const keys = Object.keys(snap)
  assert.equal(keys.length, gc.GATE_COUNT, `快照包含全部 ${gc.GATE_COUNT} 闸`)
  for (const k of keys) {
    assert.ok(snap[k].gateId === k, `闸 ${k} 的 gateId 匹配`)
  }
})

// ── quality-ledger ──
const ql = await import('../src/quality-ledger.js')

test('q1 任务签名：归一化+哈希，同义 purpose 同签名', () => {
  const s1 = ql.taskSignature('修复测试网的红灯', [{ severity: 'major' }, { severity: 'minor' }])
  const s2 = ql.taskSignature('修复测试网的红灯', [{ severity: 'minor' }, { severity: 'major' }])
  assert.equal(s1, s2, '同 purpose+同断言结构=同签名（排序不敏感）')

  const s3 = ql.taskSignature('完全不同的任务', [{ severity: 'major' }])
  assert.notEqual(s1, s3, '不同 purpose=不同签名')
})

test('q2 质量记录：落盘+回读', () => {
  const rec = ql.recordQuality({
    sid: 'test-sid-1',
    purpose: '测试质量记录',
    assertions: [{ severity: 'major' }],
    rerolls: 2,
    rerollLayers: { reasoning: 1, transcription: 1 },
    predictionBias: [0.5, -1.2],
    humanInterventions: 1,
    tokenCost: 50000,
    frictionCount: 3,
    zTimeline: [0.2, 0.5, 0.8, 1.0],
    finalQuality: 'accepted',
  })
  assert.ok(rec.sig, '签名非空')
  assert.equal(rec.rerolls, 2, '回炉数记录')
  assert.equal(rec.finalQuality, 'accepted', '质量标记记录')
})

test('q3 趋势查询：≥2 单同签名可出趋势', () => {
  // 写入第二单
  ql.recordQuality({
    sid: 'test-sid-2',
    purpose: '测试质量记录',  // 同签名
    assertions: [{ severity: 'major' }],
    rerolls: 0,
    predictionBias: [0.1],
    humanInterventions: 0,
    tokenCost: 30000,
    frictionCount: 1,
    finalQuality: 'accepted',
  })
  const trend = ql.qualityTrend('测试质量记录', [{ severity: 'major' }])
  assert.ok(trend, '趋势非空')
  assert.ok(trend.total >= 2, `总单数≥2，实际=${trend.total}`)
  assert.ok(trend.recent, '近期聚合非空')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
