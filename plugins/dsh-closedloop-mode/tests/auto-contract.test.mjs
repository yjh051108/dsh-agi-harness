/** auto-contract — 方案A：声明即合同（首个 declare 自动立项 + 目标锁）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ac-'))
fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
process.env.DSH_HOME = TMP
const T = await import('../src/tools.js')
const M = await import('../src/mode-state.js')
const exec = (sid) => ({ agent: { session: { id: sid } } })
const src = 'prior:基准 p=0.5'
const base = (title, key, value, exp = 'improve') => ({
  title,
  group: 'G',
  invariants: ['不变量 i1'],
  predict: [{ key, value, source: src }],
  law: [{ signal: 'x', action: 'y' }],
  channels: ['a', 'b'],
  vExpect: exp,
})
const close = (sid, before, measured) => T.optimalConvergeDefinition().execute({ group: 'G', agreed: ['值一致：实测=预测'], discrepancies: [], dv: { beforeBand: before, measuredBand: measured, channels: ['c1', 'c2'] } }, exec(sid))

test('a1 无合同 declare → 自动立项（回执明示 + 合同物化）', async () => {
  const sid = 'a1'
  M.initMode()
  const r = await T.optimalDeclareDefinition().execute(base('声一', 'k1', 'v1'), exec(sid))
  assert.match(r.text, /已自动立项/)
  const st = M.loadState(sid)
  assert.ok(st.cost && st.cost.aligned, '立项后合同已对齐')
  assert.ok(st.cost.assertions.length >= 1, 'predict 集已物化为断言')
})

test('a2 目标锁：闭合后同 key 改 value 被拒（目标漂移）', async () => {
  const sid = 'a2'
  M.initMode()
  const r1 = await T.optimalDeclareDefinition().execute(base('声一', 'k1', 'v1'), exec(sid))
  assert.match(r1.text, /已自动立项/)
  await close(sid, 'far', 'near')
  await assert.rejects(() => T.optimalDeclareDefinition().execute(base('声二', 'k1', 'v2', 'improve'), exec(sid)), /目标漂移/, '同 key 改 value 必须被拒（目标漂移）')
})

test('a3 目标锁放松面：同 key 同 value 或新 key 允许', async () => {
  const sid = 'a3'
  M.initMode()
  const r1 = await T.optimalDeclareDefinition().execute(base('声一', 'k1', 'v1'), exec(sid))
  assert.match(r1.text, /已自动立项/)
  await close(sid, 'far', 'near')
  const r2 = await T.optimalDeclareDefinition().execute(base('声二', 'k1', 'v1', 'improve'), exec(sid))
  assert.ok(r2.ok, '同 key 同 value 允许')
  await close(sid, 'near', 'at')
  const r3 = await T.optimalDeclareDefinition().execute(base('声三', 'k2', 'v2', 'maintain'), exec(sid))
  assert.ok(r3.ok, '新 key 允许')
})

test('a4 兼容：cost_set 预立合同后 declare 不自动立项', async () => {
  const sid = 'a4'
  M.initMode()
  await T.costSetDefinition().execute({ purpose: '先合同后声明的既有路径（兼容性回归）', assertions: [{ text: 'a', severity: 'major', source: '标定' }], assumptions: [] }, exec(sid))
  await T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 'spec', accept: ['cmd:node --version'], verify: 'self' }] }, exec(sid))
  const f = await T.freezeDefinition().execute({}, exec(sid))
  assert.ok(f.ok)
  const r = await T.optimalDeclareDefinition().execute(base('声一', 'k1', 'v1'), exec(sid))
  assert.ok(!/已自动立项/.test(r.text || ''), '已有合同时不自动立项')
  assert.ok(r.ok)
})
