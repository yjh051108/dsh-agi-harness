/**
 * trust-deviation.test — v0.8.37 偏差处置权还给模型 + 诚信留痕。
 * 语义：预测≠实测不再自动回炉；模型自评处置（continue|turn|repair|stop）；硬边界=证据不可伪造。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-trust-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const ms = await import('../src/mode-state.js')
const T = await import('../src/tools.js')
const TL = await import('../src/trust-ledger.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
function seed(sid) {
  let s = { ...ms.initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  ms.saveState(sid, ms.onWeightsConfirmed(ms.onWeightsFreeze(s).state))
}
const DECL = (over = {}) => ({ title: '步A', group: 'G', predict: [{ key: '体积', value: '10', source: 'prior:凭印象估' }], channels: ['a', 'b'], ...over })
const MISMATCH = { agreedPairs: [{ key: '体积', measured: '15', predicted: '10', channel: 'a' }], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['a', 'b'] }, group: 'G' }

test('t1 DISPOSITIONS：四值封闭，非法值不认', () => {
  assert.deepEqual(TL.DISPOSITIONS, ['continue', 'turn', 'repair', 'stop'])
  assert.equal(TL.isDisposition('continue'), true)
  assert.equal(TL.isDisposition('rollback'), false, '回炉不是处置选项——处置权在模型，选项里没有「作废」')
  assert.equal(TL.isDisposition(''), false)
})

test('t2 dispositionLine：无偏差零注入；有偏差未处置=索取自评；已处置=记录一行', () => {
  assert.equal(TL.dispositionLine(0, 'continue', ''), '')
  assert.match(TL.dispositionLine(2, '', ''), /2 处偏差待你处置/)
  const l = TL.dispositionLine(1, 'turn', '路线绕开')
  assert.match(l, /偏差处置：turn/)
  assert.match(l, /拐弯/)
  assert.match(l, /路线绕开/)
})

test('t3 recordTrust 落盘 + trustSummary 汇总（开发者可见）', () => {
  TL.recordTrust({ sid: 's1', kind: 'violation', detail: '探针台账缺 key X' })
  TL.recordTrust({ sid: 's1', kind: 'misjudged', detail: 'continue 后出现真实缺陷' })
  const rows = TL.readTrust()
  assert.equal(rows.length, 2)
  assert.equal(rows[0].kind, 'violation')
  const sum = TL.trustSummary({ sid: 's1' })
  assert.match(sum, /violation×1/)
  assert.match(sum, /misjudged×1/)
  assert.match(sum, /trust\.jsonl/)
})

test('t4 有偏差但没给处置 → converge 被拒（要求自评，不回炉）', async () => {
  const sid = 'td-4'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await assert.rejects(
    () => T.optimalConvergeDefinition().execute(MISMATCH, exec(sid)),
    /处置权在你.*disposition/s,
  )
})

test('t5 带 disposition=continue → 步闭合 + deviations 落账（不再回炉）', async () => {
  const sid = 'td-5'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  const r = await T.optimalConvergeDefinition().execute({ ...MISMATCH, disposition: 'continue', reason: '体积差 5KB 不影响交付' }, exec(sid))
  assert.match(r.text, /closed（/, '有偏差仍可闭合——偏差是观察不是判决')
  assert.match(r.text, /偏差处置：continue/)
  const stack = JSON.parse(fs.readFileSync(path.join(TMP, 'graded-state', `${sid}.optimal.json`), 'utf8'))
  const st = stack.steps[stack.steps.length - 1]
  assert.equal(st.status, 'closed')
  assert.equal((st.deviations || []).length, 1, '偏差进 deviations 留痕')
  assert.equal(st.disposition.call, 'continue')
  assert.equal((st.discrepancies || []).length, 0, '已处置=不再挂回炉义务')
})

test('t6 有偏差 → 债升级（债只说明没拿到知识，不说明产品坏了）', async () => {
  const sid = 'td-6'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await T.optimalConvergeDefinition().execute({ ...MISMATCH, disposition: 'repair', reason: '下一步修正' }, exec(sid))
  const s = ms.loadState(sid)
  assert.equal(s.debts[0].state, 'escalated', '偏差=这笔断言没被测量兑现 → 升级')
  assert.equal(s.debts[0].everEscalated, true)
})
