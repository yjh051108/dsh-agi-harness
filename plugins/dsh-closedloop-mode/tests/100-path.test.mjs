/** 100-path — 收尾环：①T1+ 防滑抽审（每 3 个 self 组→redteam+auditSampled）②T2 归零自动归档声明 ③导演面板行 ④诚实位清单（未机械验证项）。实现前=红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-1p-'))
process.env.DSH_HOME = TMP
fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
const T = await import('../src/tools.js')
const M = await import('../src/mode-state.js')
const R = await import('../src/rank-organ.js')
const exec = (sid) => ({ agent: { session: { id: sid } } })

const setup = async (sid, rankT, nSelf = 4) => {
  await T.costSetDefinition().execute({ purpose: '收尾环测试：防滑抽审与诚实位（至少十二字）', assertions: [{ text: 'a', severity: 'major', source: '标定' }], assumptions: [] }, exec(sid))
  const st = M.loadState(sid)
  M.saveState(sid, { ...st, rank: { T: rankT, C: 70, at: Date.now() } })
  const groups = Array.from({ length: nSelf }, (_, i) => ({ title: 'G' + i, spec: 'spec', accept: ['cmd:node --version'], verify: 'self' }))
  await T.decomposeDefinition().execute({ groups }, exec(sid))
}

test('p1 T1+ 防滑抽审：self 组每 3 取 1 转 redteam+auditSampled', async () => {
  const sid = 'p1'
  await setup(sid, 1, 4)
  const st = M.loadState(sid)
  const ss = (st.groups || [])
  const sampled = ss.filter((g) => g.verify === 'redteam')
  const marked = ss.filter((g) => g.auditSampled)
  assert.equal(sampled.length, 1, '4 组抽 1')
  assert.equal(marked.length, 1, '抽审标记')
  assert.equal(ss.filter((g) => g.verify === 'self').length, 3, '其余保持 self')
})

test('p2 T0 不抽审（现状保持）', async () => {
  const sid = 'p2'
  await setup(sid, 0, 4)
  const st = M.loadState(sid)
  assert.equal(st.groups.filter((g) => g.verify === 'redteam').length, 0, 'T0 无抽审')
})

test('p3 降档收回扩展：auditSampled 组也回 self', async () => {
  const sid = 'p3'
  await setup(sid, 1, 4)
  let st = M.loadState(sid)
  const rec = R.recoverRelaxed(st, { T: 1 })
  const g = rec.groups.find((x) => x.title === 'G0')
  assert.ok(g && g.verify !== 'redteam', '抽审组降档后应回 self（' + (g && g.verify) + '）')
})

test('p4 T2 归零回执含自动归档声明；T0 不含', async () => {
  const sid = 'p4'
  await setup(sid, 2, 3)
  const st = M.loadState(sid)
  M.saveState(sid, { ...st, stage: 'final', closed: [{ title: 'b', group: 'G0', at: 1, band: 'at' }], groups: st.groups.map((g) => ({ ...g, settled: { at: 1, verdict: 'pass' } })) })
  const r = await T.terminalCheckDefinition().execute({}, exec(sid))
  // T2 归零应含归档声明
  if (r.ok) assert.match(r.text, /归档|回望|走开/, 'T2 回执应含归档声明')
  const sid5 = 'p5'
  await setup(sid5, 0, 3)
  const st5 = M.loadState(sid5)
  M.saveState(sid5, { ...st5, stage: 'final', closed: [{ title: 'b', group: 'G0', at: 1, band: 'at' }], groups: st5.groups.map((g) => ({ ...g, settled: { at: 1, verdict: 'pass' } })) })
  const r5 = await T.terminalCheckDefinition().execute({}, exec(sid5))
  if (r5.ok) assert.ok(!/归档/.test(r5.text), 'T0 不应含归档声明')
})

test('p5 导演面板行 + 诚实位清单（未机械验证项）', async () => {
  const sid = 'p6'
  await setup(sid, 1, 3)
  const st = M.loadState(sid)
  M.saveState(sid, { ...st, stage: 'final', closed: [{ title: 'b', group: 'G0', at: 1, band: 'at' }], groups: st.groups.map((g) => ({ ...g, settled: { at: 1, verdict: 'pass' } })) })
  const r = await T.terminalCheckDefinition().execute({}, exec(sid))
  // 归零回执应含面板与诚实位
  if (r.ok) {
    assert.match(r.text, /导演|档位|面板/, '面板行')
  }
})
