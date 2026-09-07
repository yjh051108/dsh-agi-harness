/**
 * demands.test — v0.5.2 索取单落盘 + v0.5.3 disputed 提案回归
 * m1 来源纪律拒→索取单落盘（续追）；m2 declare 通过→销账；m3 预言失效且引 engram:→disputed 提案
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-dem-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const ms = await import('../src/mode-state.js')
const T = await import('../src/tools.js')
const eng = await import('../src/optimal-engine.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
function seed(sid) {
  let s = { ...ms.initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  ms.saveState(sid, ms.onWeightsConfirmed(ms.onWeightsFreeze(s).state))
}

test('m1 来源纪律拒 → 索取单落盘（text+age），回执带挂账提示', async () => {
  const sid = 'dem-1'
  seed(sid)
  const d = T.optimalDeclareDefinition()
  await assert.rejects(
    () => d.execute({ title: '缺料步', group: 'G', predict: [{ key: 'k', value: '1', source: '自由文本瞎猜' }], channels: ['a', 'b'] }, exec(sid)),
    /来源纪律.*索取单已挂账/s,
  )
  const s = ms.loadState(sid)
  assert.ok(s.demands && s.demands.length === 1, '索取单落盘')
  assert.match(s.demands[0].text, /来源纪律/)
})

test('m2 declare 通过 → 销账（demands 清空，回执记销数）', async () => {
  const sid = 'dem-2'
  seed(sid)
  const d = T.optimalDeclareDefinition()
  await d.execute({ title: '缺料步', group: 'G', predict: [{ key: 'k', value: '1', source: '自由文本' }], channels: ['a', 'b'] }, exec(sid)).catch(() => {})
  assert.equal(ms.loadState(sid).demands.length, 1, '先挂上')
  const r = await d.execute({ title: '补料步', group: 'G', predict: [{ key: 'k', value: '1', source: 'prior:显式先验' }], channels: ['a', 'b'] }, exec(sid))
  assert.match(r.text, /索取单销账×1/)
  assert.ok(!ms.loadState(sid).demands, '销账后无键（round-trip 纪律：空=无键，不造 undefined）')
})

test('m3 预言失效且该步引 engram: 源 → 回执带 disputed 提案（协议不直写图 R15）', async () => {
  const sid = 'dem-3'
  // 造一个 confirmed 图谱节点
  fs.mkdirSync(path.join(TMP, 'engram-relay'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'engram-relay', 'engrams.jsonl'), JSON.stringify({ title: '经验节点', summary: 'X 可行', status: 'confirmed' }))
  seed(sid)
  const d = T.optimalDeclareDefinition()
  const r = await d.execute({ title: '引图步', group: 'G', predict: [{ key: 'k', value: '1', source: 'engram:[[经验节点]]' }], channels: ['a', 'b'] }, exec(sid))
  assert.match(r.text, /engram.*经验节点.*✓/)
  const c = T.optimalConvergeDefinition()
  const cv = await c.execute({ agreed: ['k: 实测 2 ≠ 预测 1(引擎复验)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['a', 'b'] }, group: 'G' }, exec(sid))
  assert.match(cv.text, /disputed.*engram_update|R15/s)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
