/**
 * nearfield.test — v0.6.2 近场变焦回归
 * n1 内容齐（组/判据/上次实测/承诺/指针）；n2 体积守 ≤400B（锚定不是税——超预算即失败）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const NF = await import('../src/near-field.js')

const state = {
  groups: [{ title: 'G组', spec: '把校准三件做完并接入批算腿', accept: ['cmd:node check.mjs', '人判:报告已交付并贴回原话记录'], verify: 'self', settled: null }],
  closed: [{ title: '上一步名很长很长很长很长', v: 0.4, band: 'near' }],
}
const step = { title: '本步名字也很长很长很长', group: 'G组', predictions: [{ key: 'k1' }, { key: 'k2' }], measure: { channels: ['a', 'b'] } }

test('n1 近场五要素齐全+末步指针（全局在盘不在脑）', () => {
  const t = NF.nearField(state, step, state.closed[0])
  assert.match(t, /【近场｜只做这一步/)
  assert.match(t, /G组.*未落账/)
  assert.match(t, /cmd:node check\.mjs/)
  assert.match(t, /上次实测：「上一步名很长很长/)
  assert.match(t, /吻合\[k1,k2\]·通道2/)
  assert.match(t, /optimal_stack.*全局在盘不在脑/)
})

test('n2 体积≤400B（锚定成本封顶，超=退化成税）+ 首步无上次实测态', () => {
  const t = NF.nearField(state, step, null)
  assert.ok(Buffer.byteLength(t, 'utf8') <= 400, `近场 ${Buffer.byteLength(t, 'utf8')}B 超预算`)
  assert.match(t, /无（本单首步）/)
})

test('n3 端到端（59dc4033 活卡案底锁）：declare 锚段组名/判据实填充（引擎 step 无 group，接线从 args 补）', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-e2e-'))
  const ms = await import('../src/mode-state.js')
  const T = await import('../src/tools.js')
  const sid = 'nf-e2e'
  const s = { ...ms.initMode(), stage: 'rolling', weightsLocked: true, cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: '装组', spec: '端到端验锚段填充', accept: ['人判:锚段含组名'], verify: 'self', settled: null }] }
  ms.saveState(sid, s)
  const r = await T.optimalDeclareDefinition().execute({ title: '锚验步', group: '装组', predict: [{ key: 'k', value: '1', source: 'prior:x' }], channels: ['a', 'b'] }, { agent: { session: { id: sid } } })
  assert.match(r.text, /组「装组」\(未落账\) 端到端验锚段填充/, '锚段组名/spec 必须实填充')
  assert.match(r.text, /判据: 人判:锚段含组名/)
})
