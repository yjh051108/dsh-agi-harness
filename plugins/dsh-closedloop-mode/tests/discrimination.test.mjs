/**
 * discrimination.test — v0.5.8 判别力闸 + 组判据挂账回归（体感实测两洞升闸）
 * d1 已绿 measure 无 rationale=拒；d2 补 rationale=过；d3 measure 报错=拒（dry-run 升闸）；
 * d4 裸 accept=拒；cmd:/人判: 前缀=过；d5 落账时 cmd 红=不落账、全绿+人判=落账带挂账注
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-dsc-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const ms = await import('../src/mode-state.js')
const T = await import('../src/tools.js')
const exec = (sid) => ({ agent: { session: { id: sid } } })

const green = { cmd: 'node -e "process.exit(0)"', kind: 'bool' }
const broken = { cmd: 'no-such-exe-xyz --version', kind: 'bool' } // 真·报错（exe 不存在=ENOENT），区别于 node 跑红

test('d1 measure 挂合同时已绿且无 rationale → 判别力闸拒', async () => {
  const c = T.costSetDefinition()
  await assert.rejects(
    () => c.execute({ purpose: '判别力闸回归测试用途足够长', assertions: [{ text: 'a', severity: 'major', source: 's', measure: green }] }, exec('dsc-1')),
    /判别力闸.*无判别力/s,
  )
})

test('d2 同 measure 补 rationale（护栏声明）→ 放行', async () => {
  const c = T.costSetDefinition()
  const r = await c.execute({ purpose: '判别力闸回归测试用途足够长', assertions: [{ text: 'a', severity: 'major', source: 's', measure: green, rationale: '防回归护栏：变红即事故，绿是常态' }] }, exec('dsc-2'))
  assert.equal(r.ok, true)
})

test('d3 measure 直接报错（路径不存在）→ dry-run 纪律升闸拒绝', async () => {
  const c = T.costSetDefinition()
  await assert.rejects(
    () => c.execute({ purpose: '报错拒绝回归测试用途足够长', assertions: [{ text: 'a', severity: 'major', source: 's', measure: broken }] }, exec('dsc-3')),
    /报错不可挂|dry-run/s,
  )
})

test('d4 裸 accept 前缀闸；cmd:/人判: 放行', async () => {
  let s = { ...ms.initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  ms.saveState('dsc-4', s)
  const d = T.decomposeDefinition()
  await assert.rejects(() => d.execute({ groups: [{ title: 'G', spec: 'sp', accept: ['裸判据'] }] }, exec('dsc-4')), /前缀闸/)
  const ok = await d.execute({ groups: [{ title: 'G', spec: 'sp', accept: ['cmd:node -e "process.exit(0)"', '人判:报告已交付'] }] }, exec('dsc-4'))
  assert.equal(ok.ok, true)
})

test('d5 落账门：cmd 红不落账；全绿+人判挂账注', async () => {
  const base = {
    ...ms.initMode(), stage: 'rolling', weightsLocked: true,
    cost: { purpose: 'p', assertions: [], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
    closed: [{ title: 'T1', group: 'G', at: 1, band: 'at' }],
  }
  const steps = [{ n: 1, title: 'T1', status: 'closed' }]
  const red = JSON.parse(JSON.stringify(base))
  red.groups = [{ title: 'G', spec: 's', accept: ['cmd:node -e "process.exit(1)"'], verify: 'self', settled: null, closeRequested: true }]
  const rr = T.trySettleGroups(red, steps)
  assert.equal(rr.state.groups[0].settled, null, 'cmd 红=不落账')
  assert.match(rr.notes.join(''), /判据红/, 'v0.6.24 三态：能跑但红=判据红（显式）')
  assert.match(rr.notes.join(''), /不落账/)
  const greenG = JSON.parse(JSON.stringify(base))
  greenG.groups = [{ title: 'G', spec: 's', accept: ['cmd:node -e "process.exit(0)"', '人判:报告已交付'], verify: 'self', settled: null, closeRequested: true }]
  const gr = T.trySettleGroups(greenG, steps)
  assert.ok(gr.state.groups[0].settled, '全绿落账')
  assert.match(gr.notes.join(''), /人判挂账：报告已交付/)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
