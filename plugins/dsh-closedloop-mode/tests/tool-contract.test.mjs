/**
 * tool-contract.test — v0.6.30 契约尺：描述=完整合同（高频拒因前置）——机械防「加闸不配描述」。
 * 原则（导演定向 2026-09-06）：模型零源码依赖；需要读 README/源码才能正确调用=引导缺陷。
 * 表=实测咬过人的高频拒因（分期扩充；加闸当轮同步配描述+本表条目）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-tc-'))
process.env.DSH_HOME = TMP

const T = await import('../src/tools.js')
const idx = await import('../src/index.js')

const defs = {}
for (const d of [
  T.costSetDefinition({ name: 'super_task_completion_mode' }), T.decomposeDefinition(), T.freezeDefinition({}), T.measureProposeDefinition(), T.probeRecordDefinition(),
  T.optimalDeclareDefinition(), T.optimalConvergeDefinition(), T.auditRecordDefinition('audit_record'), T.auditRecordDefinition('cost_audit'),
  T.auditDispatchDefinition(), T.optimalRollbackDefinition(), T.optimalStackDefinition(), T.reviseDoDefinition(), T.deliveryFeedbackDefinition(), T.terminalCheckDefinition(),
]) defs[d.name] = d

/** 契约表：工具 → 描述必须包含的规则锚（高频拒因，实测咬过人的） */
const CONTRACT = {
  optimal_converge: ['agreedPairs', '作废申报', '数值相等', '异源', 'beforeBand=引擎实读'],
  optimal_declare: ['probe:', '数字必须出现', '同签名', 'vExpect', 'dipPlan'],
  decompose: ['cmd:', '人判:'],
  super_task_completion_mode: ['≥12', 'severity', '完成条件', '超级任务完成模式', '先查看可用工具'],
  probe_record: ['1-40', 'execFile:', '协议禁壳'],
  optimal_rollback: ['≥8', '同签名'],
  freeze: ['确认'],
  measure_propose: ['棘轮'],
  audit_record: ['逐字'],
  audit_dispatch: ['降级派发卡'],
  delivery_feedback: ['真人', '交付反馈', '不冒充 accepted'],
}

test('tc1 契约尺：表内工具描述全覆盖高频拒因（描述=完整合同；缺=引导缺陷）', () => {
  const misses = []
  for (const [name, anchors] of Object.entries(CONTRACT)) {
    const d = defs[name]
    assert.ok(d, name + ' 在定义集')
    const surface = String(d.description || '') + JSON.stringify(d.parameters || {}) // 模型可见的完整合同面
    for (const a of anchors) if (!surface.includes(a)) misses.push(`${name} 缺「${a}」`)
  }
  assert.deepEqual(misses, [], '描述缺口（读源码需求的根源）：' + misses.join('；'))
})

test('tc2 十五工具与注册面一致（描述面可测）', () => {
  assert.equal(Object.keys(defs).length, idx.TOOL_NAMES.length)
  for (const n of idx.TOOL_NAMES) assert.ok(defs[n], n + ' 在注册面')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
