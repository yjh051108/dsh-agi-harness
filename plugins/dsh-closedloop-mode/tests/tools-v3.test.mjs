/** tools v0.3 工具面测例（旧 tools.test 的 cost_set 门控 suite 形变继承+段门 v3 化）。临时 DSH_HOME 隔离。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-tools-'))
process.env.DSH_HOME = TMP
const T = await import('../src/tools.js')
const { initMode, loadState, saveState, controlSurface } = await import('../src/mode-state.js')
const { declareStep, convergeStep } = await import('../src/optimal-engine.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
const A = (t, sv, src) => ({ text: t, severity: sv, source: src })

test('t1 cost_set 自主激活：off→定稿即 brainstorm+aligned+档位分布回执', async () => {
  const r = await T.costSetDefinition().execute({ purpose: '为测试者立最小合同（十二字以上）', assertions: [A('a', 'catastrophic', '标定'), A('b', 'minor', '条款')] }, exec('c1'))
  assert.match(r.text, /超级任务完成模式已启动/)
  assert.match(r.text, /完成条件 2 条（关键 1 · 重要 0 · 一般 1）/)
  const s = loadState('c1')
  assert.equal(s.stage, 'brainstorm')
  assert.equal(s.cost.aligned, true)
})

test('t2 cost_set 输入门 suite：空断言/缺档/缺源/照抄式短 purpose 全拒', async () => {
  const cs = T.costSetDefinition()
  await assert.rejects(() => cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', assertions: [] }, exec('c2')), /至少 1 条/)
  await assert.rejects(() => cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', assertions: [{ text: 'a', source: 's' }] }, exec('c2')), /档位/)
  await assert.rejects(() => cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', assertions: [{ text: 'a', severity: 'major' }] }, exec('c2')), /来源/)
  await assert.rejects(() => cs.execute({ purpose: '太短', assertions: [A('a', 'major', 's')] }, exec('c2')), /≥12/)
})

test('t3 cost_set nonGoals 确认制+旧参数显式拒', async () => {
  const cs = T.costSetDefinition()
  await assert.rejects(() => cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', assertions: [A('a', 'major', 's')], nonGoals: ['x'] }, exec('c3')), /既定规则/)
  const ok = await cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', assertions: [A('a', 'major', 's')], nonGoals: ['x'], nonGoalsConfirmed: true }, exec('c3'))
  assert.match(ok.text, /不做的事 1 项/)
  await assert.rejects(() => cs.execute({ purpose: '为测试者立最小合同十二字以上确凿', mode: 'correct' }, exec('c3')), /已废/)
})

test('t4 cost_set 锁后只读（单一锁点，改口走『修改』）', async () => {
  saveState('c4', { ...initMode(), stage: 'rolling', weightsLocked: true, cost: { purpose: 'p', assertions: [], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } })
  await assert.rejects(() => T.costSetDefinition().execute({ purpose: '为测试者立锁后合同十二字以上确凿', assertions: [A('a', 'major', 's')] }, exec('c4')), /『修改』/)
})

test('t5 decompose 组级门：Q_N 前拒/缺 spec、accept、重名拒/锁后拒；合规落树', async () => {
  const sid = 'd1'
  await assert.rejects(() => T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: ['a'] }] }, exec(sid)), /cost_set|未激活/)
  await T.costSetDefinition().execute({ purpose: '为测试者立组级合同十二字以上确凿', assertions: [A('a', 'major', 's')] }, exec(sid))
  await assert.rejects(() => T.decomposeDefinition().execute({ groups: [{ title: 'G', accept: ['a'] }] }, exec(sid)), /spec/)
  await assert.rejects(() => T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's' }] }, exec(sid)), /accept/)
  await assert.rejects(() => T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: ['a'] }, { title: 'G', spec: 's2', accept: ['b'] }] }, exec(sid)), /重复/)
  const ok = await T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: ['人判:a'], verify: 'redteam' }] }, exec(sid))
  assert.match(ok.text, /1 组，无块级序列/)
})

test('t6 freeze 锁点：空组拒；正常→weights 态+评审单含确认指引', async () => {
  const sid = 'f1'
  await T.costSetDefinition().execute({ purpose: '为测试者立冻结合同十二字以上确凿', assertions: [A('a', 'major', 's')] }, exec(sid))
  await assert.rejects(() => T.freezeDefinition().execute({}, exec(sid)), /组结构为空|decompose/)
  await T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: ['人判:a'] }] }, exec(sid))
  const r = await T.freezeDefinition().execute({}, exec(sid))
  assert.match(r.text, /合同已锁待确认|『确认』/)
  assert.equal(loadState(sid).stage, 'weights')
  assert.match(r.text, /完成条件 1 条/)
})

test('t7 terminal_check 工具：非 final 拒（唯一 throw）；final 零报告+terminalReport 落盘', async () => {
  const sid = 'z1'
  let s = { ...initMode(), stage: 'rolling', weightsLocked: true, cost: { purpose: '目的文本十二字以上确凿无疑', assertions: [A('a', 'major', 's')], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'redteam', settled: null }] }
  saveState(sid, s)
  await assert.rejects(() => T.terminalCheckDefinition().execute({}, exec(sid)), /final/)
  // 造归零态：动作闭合入栈+落账+过审+组 settled → final
  declareStep(sid, { title: 'A1', predictions: [{ key: 'k', value: '1', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  convergeStep(sid, { agreed: ['k: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } })
  s = loadState(sid)
  s.closed = [{ title: 'A1', group: 'G', at: 1, band: 'at', audit: { rounds: 1, last: { verdict: 'pass' } } }]
  s.groups[0].settled = { at: 1, verdict: 'pass' }
  s.groups[0].closeRequested = true
  s.stage = 'final'
  saveState(sid, s)
  const r = await T.terminalCheckDefinition().execute({}, exec(sid))
  assert.match(r.text, /终端归零/)
  assert.equal(loadState(sid).terminalReport.zero, true)
  // auditStat 纯面：pass 计数在位
  const { auditStat } = await import('../src/index.js')
  assert.deepEqual(auditStat(loadState(sid)), { rounds: 1, passed: 1, rejected: 0, pending: 0 })
})

test('t8 revise_do 组级：形态修订登记轨迹；枚举无效拒；无组拒；verify 不动', async () => {
  const sid = 'r1'
  saveState(sid, { ...initMode(), stage: 'rolling', weightsLocked: true, groups: [{ title: 'G', spec: '', accept: ['a'], verify: 'redteam', settled: null }], cost: { purpose: 'p', assertions: [], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } })
  const r = await T.reviseDoDefinition().execute({ group: 'G', do: 'subagent', reason: '批产独立' }, exec(sid))
  assert.match(r.text, /self→subagent|→subagent/)
  const g = loadState(sid).groups[0]
  assert.equal(g.do, 'subagent')
  assert.equal(g.verify, 'redteam', 'verify 只读')
  assert.equal(g.doHistory.length, 1)
  await assert.rejects(() => T.reviseDoDefinition().execute({ group: 'G', do: 'telepathy' }, exec(sid)), /组不在合同内|无效|无效/)
  await assert.rejects(() => T.reviseDoDefinition().execute({ group: '无此组', do: 'self' }, exec(sid)), /不在合同/)
})

test('t9 declare 双形状：v0.2 全量直通=full；差分=light 且物化回执含引擎直读链式量', async () => {
  const sid = 'sh1'
  await T.costSetDefinition().execute({ purpose: '为测试者立形状合同十二字以上确凿', assertions: [A('a', 'major', 's')] }, exec(sid))
  await T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: ['人判:a'] }] }, exec(sid))
  await T.freezeDefinition().execute({}, exec(sid))
  saveState(sid, { ...loadState(sid), stage: 'rolling' })
  const full = await T.optimalDeclareDefinition().execute({ title: '全量件', invariants: ['i'], predictions: [{ key: 'k', value: '1', source: 'prior:s' }], cost: [{ failure: 'f', defense: 'd' }], law: [{ signal: 's', action: 'a' }], measure: { right: 'r', wrongSignal: 'w', channels: ['fs: a', 'rt: b'] } }, exec(sid))
  assert.match(full.text, /准入=full/)
  // 闭合走工具面（recordClosed 推进 lastBand——链式量的盘档来源）
  await T.optimalConvergeDefinition().execute({ agreed: ['k: 实测 1 ≠ 预测 1(s)'], discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }, group: 'G' }, exec(sid))
  const diff = await T.optimalDeclareDefinition().execute({ title: '差分件', group: 'G', predict: [{ key: 'n', value: '2', source: 'prior:fs 直读' }], channels: ['fs: 盘读', 'rt: 活测'] }, exec(sid))
  assert.match(diff.text, /准入=light/)
  assert.match(diff.text, /beforeBand=near/, '链式量=上一实测（surface 直读，模型未写）')
})

test('t10 final+settled 自主开单正式通道（v0.3.1③自启动）', async () => {
  const sid = 'fs1'
  saveState(sid, { ...initMode(), stage: 'final', weightsLocked: true, cost: { purpose: '旧单目的', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: { at: 1, verdict: 'pass' } }], closed: [{ title: 'a1', group: 'G', at: 1, band: 'at', audit: null }] })
  const r = await T.costSetDefinition().execute({ purpose: '为自主开单测试立最小合同十二字以上确凿', assertions: [{ text: 'x', severity: 'major', source: 's' }] }, exec(sid))
  assert.match(r.text, /超级任务完成模式已启动/)
  const s = loadState(sid)
  assert.equal(s.stage, 'brainstorm', '已终结旧单→新单')
  assert.equal(s.weightsLocked, false)
  assert.equal(s.closed.length, 0, '新单账清零（旧单 V 账本在栈不抹）')
})

test('t11 freeze 确认弹窗（v0.3.2 结构化 UI：确认/反驳/含混三态直转）', async () => {
  const mk = (sid) => {
    saveState(sid, { ...initMode(), stage: 'brainstorm', weightsLocked: false, cost: { purpose: '为弹窗测试立最小合同十二字以上确凿', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] })
  }
  // 确认+补充
  mk('ui-ok')
  const askOk = { askUser: async () => ({ answers: [{ id: 'x', selected: ['确认·开快环'], custom: '第三组判据收紧' }] }) }
  const r1 = await T.freezeDefinition(askOk).execute({}, exec('ui-ok'))
  assert.match(r1.text, /UI 确认/)
  assert.equal(loadState('ui-ok').stage, 'rolling')
  assert.equal(loadState('ui-ok').reviewNote, '第三组判据收紧', '补充落 reviewNote 随 face 可见')
  // 反驳
  mk('ui-no')
  const r2 = await T.freezeDefinition({ askUser: async () => ({ answers: [{ selected: ['反驳·解锁重排'], custom: 'Q_N 漏了性能断言' }] }) }).execute({}, exec('ui-no'))
  assert.match(r2.text, /UI 反驳/)
  assert.equal(loadState('ui-no').stage, 'brainstorm')
  assert.equal(loadState('ui-no').weightsLocked, false)
  // 含混（两个都选）→ 保持待确认
  mk('ui-am')
  const r3 = await T.freezeDefinition({ askUser: async () => ({ answers: [{ selected: ['确认·开快环', '反驳·解锁重排'] }] }) }).execute({}, exec('ui-am'))
  assert.match(r3.text, /含混|未获明确/)
  assert.equal(loadState('ui-am').stage, 'weights', '含混不翻转（保持待确认）')
  // 无 UI 通道 → 回退提示在位
  mk('ui-none')
  const r4 = await T.freezeDefinition().execute({}, exec('ui-none'))
  assert.match(r4.text, /无 UI 通道/)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
