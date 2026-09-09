/**
 * debt-wiring.test — 债账接线（v0.8.36）：declare 建债/直拒、converge 升级/清偿、状态 round-trip。
 * 案底：session-0b6ea232 69 条预测 17 条靠猜、外部索取 0 次——本文件把后果写成断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-debt-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const ms = await import('../src/mode-state.js')
const T = await import('../src/tools.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
function seed(sid) {
  let s = { ...ms.initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  ms.saveState(sid, ms.onWeightsConfirmed(ms.onWeightsFreeze(s).state))
}
const DECL = (over = {}) => ({ title: '步A', group: 'G', predict: [{ key: 'vendor 文件数', value: '2', source: 'prior:按惯例估' }], channels: ['a', 'b'], ...over })
const CONV = (over = {}) => ({ agreedPairs: [{ key: 'vendor 文件数', measured: '2', predicted: '2', channel: 'a' }], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['a', 'b'] }, group: 'G', ...over })

test('w1 declare 用 prior → 建债落盘 + 回执带债务读数', async () => {
  const sid = 'dw-1'
  seed(sid)
  const r = await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  const s = ms.loadState(sid)
  assert.ok(Array.isArray(s.debts) && s.debts.length === 1, '非实证来源必须建债')
  assert.equal(s.debts[0].state, 'open')
  assert.equal(s.debts[0].claimKey, 'vendor文件数')
  assert.match(r.text, /⏳ 欠世界 1 笔/, '回执给一行读数（不是提示语，是账）')
})

test('w2 状态 round-trip：债账跨保存不丢（含 state/misses）', () => {
  const sid = 'dw-2'
  seed(sid)
  ms.saveState(sid, { ...ms.loadState(sid), debts: [{ claimKey: 'k1', key: 'K1', claim: 'v', at: 1, state: 'escalated', misses: 2, hits: 0, by: null }] })
  const s = ms.loadState(sid)
  assert.equal(s.debts.length, 1)
  assert.equal(s.debts[0].state, 'escalated')
  assert.equal(s.debts[0].misses, 2)
  const ser = ms.serializeState(s)
  assert.ok(Array.isArray(ser.debts) && ser.debts[0].claimKey === 'k1', '序列化带债')
})

test('w3 converge 失配 → 该债升级（只能用世界还）', async () => {
  const sid = 'dw-3'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await T.optimalConvergeDefinition().execute(CONV({ agreedPairs: [{ key: 'vendor 文件数', measured: '3', predicted: '2', channel: 'a' }], disposition: 'continue', reason: '偏差已记录' }), exec(sid))
  const s = ms.loadState(sid)
  assert.equal(s.debts[0].state, 'escalated', '猜错=升级，不是回炉罚')
})

test('w4 升级后同 claimKey 再用 prior → 直拒（这笔债只能用世界还）', async () => {
  const sid = 'dw-4'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await T.optimalConvergeDefinition().execute(CONV({ agreedPairs: [{ key: 'vendor 文件数', measured: '3', predicted: '2', channel: 'a' }], disposition: 'continue', reason: '偏差已记录' }), exec(sid))
  await assert.rejects(
    () => T.optimalDeclareDefinition().execute(DECL({ title: '步B' }), exec(sid)),
    /这笔债只能用世界还/,
  )
  await assert.rejects(
    () => T.optimalDeclareDefinition().execute(DECL({ title: '步C', predict: [{ key: 'Vendor 文件数', value: '2', source: 'prior:换个说法再猜' }] }), exec(sid)),
    /这笔债只能用世界还/,
    '同一件事换措辞=同一笔债（claimKey 归一）',
  )
})

test('w5 带实证来源（read:）→ 放行并清偿旧债', async () => {
  const sid = 'dw-5'
  seed(sid)
  const f = path.join(TMP, 'evidence.txt')
  fs.writeFileSync(f, 'vendor: three.module.js OrbitControls.js\n')
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await T.optimalConvergeDefinition().execute(CONV({ agreedPairs: [{ key: 'vendor 文件数', measured: '3', predicted: '2', channel: 'a' }], disposition: 'continue', reason: '偏差已记录' }), exec(sid))
  const r = await T.optimalDeclareDefinition().execute(DECL({ title: '步D', predict: [{ key: 'vendor 文件数', value: '2', source: `read:${f}#L1` }] }), exec(sid))
  assert.match(r.text, /已声明/, '实证来源放行')
  const s = ms.loadState(sid)
  assert.equal(s.debts[0].state, 'discharged', '拿到东西=还债')
  assert.equal(s.debts[0].by, 'read')
})

test('w6 converge 吻合 → 清偿（债由测量还）', async () => {
  const sid = 'dw-6'
  seed(sid)
  await T.optimalDeclareDefinition().execute(DECL(), exec(sid))
  await T.optimalConvergeDefinition().execute(CONV(), exec(sid))
  const s = ms.loadState(sid)
  assert.equal(s.debts[0].state, 'discharged')
  assert.equal(s.debts[0].by, 'measure')
})
