/**
 * v04-wiring.test — S1 接线回归（measure 字段/棘轮工具/V 并显/face-spam 修复）
 * 8 例：w1 measure round-trip 盘档 · w2 序列化保 measure · w3 propose auto · w4 删除机拒
 *        w5 改令入人审队 · w6 measureReads 真值 · w7 无 measure 零变化 · w8 face-spam 回归（cut 案底）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-s1-'))
process.env.DSH_HOME = TMP

const { initMode, onCostCommit, onGroupsEdit, onWeightsFreeze, onWeightsConfirmed, saveState, loadState, serializeState, deserializeState, recordClosed } = await import('../src/mode-state.js')
const T = await import('../src/tools.js')
const idx = await import('../src/index.js')
const { loadSpec } = await import('../src/v04-grader.js')
const { declareStep } = await import('../src/optimal-engine.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
const mAssert = (text, measure) => ({ text, severity: 'major', source: 's1 测试合同', ...(measure ? { measure } : {}) })

function rolling(sid, assertions) {
  let s = onCostCommit({ ...initMode(), stage: 'brainstorm', task: 't' }, { purpose: 's1 接线回归测试目的十二字以上', assertions })
  s = onGroupsEdit(s, [{ title: 'G', spec: 's', accept: ['a'], verify: 'self' }]).state
  s = onWeightsConfirmed(onWeightsFreeze(s).state)
  saveState(sid, s)
  return s
}

test('w1 cost_set 接受 measure 字段且盘档 round-trip 保留', async () => {
  const sid = 's1-w1'
  saveState(sid, { ...initMode(), stage: 'brainstorm' })
  const r = await T.costSetDefinition().execute({
    purpose: '验证 measure 字段能进合同并持久化',
    assertions: [{ ...mAssert('构建绿', { cmd: 'node scripts/build.mjs', kind: 'bool' }), rationale: '护栏断言：构建绿=本单前提，挂合同时绿=环境未坏（判别力闸 v0.5.8：已绿必携 rationale；r46 案底：住断言对象内非顶层）' }],
  }, exec(sid))
  assert.equal(r.ok, true)
  const s = loadState(sid)
  assert.deepEqual(s.cost.assertions[0].measure, { cmd: 'node scripts/build.mjs', kind: 'bool', target: null })
})

test('w2 serialize/deserialize 保 measure；无 measure 断言不造空键', () => {
  const s = { ...initMode(), stage: 'brainstorm', cost: { purpose: 'p', assertions: [mAssert('a', { cmd: 'x', kind: 'count', target: 3 }), mAssert('b')], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  const rt = deserializeState(JSON.parse(JSON.stringify(serializeState(s))))
  assert.deepEqual(rt.cost.assertions[0].measure, { cmd: 'x', kind: 'count', target: 3 })
  assert.equal('measure' in rt.cost.assertions[1], false, '条件展开：无 measure=无键')
})

test('w3 measure_propose 首提=新增 → auto 生效宿主侧落盘', async () => {
  const sid = 's1-w3'
  rolling(sid, [mAssert('x')])
  const r = await T.measureProposeDefinition().execute({ measures: [{ id: 'build', cmd: 'node scripts/build.mjs', kind: 'bool', w: 2 }] }, exec(sid))
  assert.match(r.text, /auto 生效/)
  assert.equal(loadSpec(sid).spec.measures.length, 1)
})

test('w4 删除既有 measure → 棘轮机拒（throw 含 violation 清单）', async () => {
  const sid = 's1-w3'
  await assert.rejects(
    () => T.measureProposeDefinition().execute({ measures: [] }, exec(sid)),
    /棘轮机拒.*不可摘除/s,
  )
})

test('w5 改测量命令 → 人审队列（未落盘，回执含指引）', async () => {
  const sid = 's1-w3'
  const cur = loadSpec(sid).spec
  const r = await T.measureProposeDefinition().execute({ measures: [{ ...cur.measures[0], cmd: 'node scripts/build.mjs --no-verify' }] }, exec(sid))
  assert.match(r.text, /人审队列/)
  assert.equal(loadSpec(sid).spec.measures[0].cmd, 'node scripts/build.mjs', '未批准不落盘')
})

test('w6 measureReads：注入假读数器 → V=Σw(1−z) 精确', () => {
  const s = { cost: { assertions: [
    mAssert('甲', { cmd: 'bool-cmd', kind: 'bool' }),
    { ...mAssert('乙', { cmd: 'ratio-cmd', kind: 'ratio', target: 10 }), severity: 'minor' },
  ] } }
  const fake = (cmd) => (cmd === 'bool-cmd' ? '' : '5/10')
  const vr = T.measureReads(s, fake)
  assert.equal(vr.V, 0.5, '甲 major(w2) z=1 贡献 0；乙 minor(w1) z=0.5 贡献 0.5 → V=0.5')
  assert.equal(vr.total, 2)
  assert.equal(vr.green, 1, '仅甲满绿')
})

test('w7 无 measure 断言 → measureReads=null（V 不装全知，converge 零变化）', () => {
  assert.equal(T.measureReads({ cost: { assertions: [mAssert('无测量')] } }, () => ''), null)
  assert.equal(T.measureReads({ cost: { assertions: [] } }, () => ''), null)
})

test('w8 face-spam 回归：rolling+栈顶 open 步 post-step 完整执行，face/gate 标记持久化', async () => {
  const sid = 's1-w8'
  rolling(sid, [mAssert('x')])
  declareStep(sid, { title: 'W8', predictions: [{ key: 'k', value: '1', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const evs = {}
  const ctx = {
    effect: (fn) => { try { fn() } catch { /* 探针注册失败不影响事件面 */ } },
    on: (name, fn) => { evs[name] = fn },
    commands: { register: () => {} },
    tools: { register: () => () => {} },
    webServer: { register: () => () => {} },
    userQuestions: { ask: async () => ({ answers: [] }) },
  }
  idx.apply(ctx, {})
  const handler = evs['agent/pre-step']
  const agent = { session: { id: sid } }
  const mk = () => ({ messages: [{ role: 'user', content: [{ type: 'text', text: '干活吧' }] }] })
  const d1 = mk()
  await handler({ agent, messages: d1.messages }, async () => d1)
  const s1 = loadState(sid)
  assert.ok(s1.injected.has('face:0:1open'), 'face 标记持久（bug 版：saveState 被 cut ReferenceError 吞掉永不执行）')
  assert.ok(s1.injected.has('gate:open:1'), '写闸短句执行成功且标记落盘')
  assert.ok(d1.messages.some((x) => x.source?.kind === 'plugin' && String(x.content?.[0]?.text || '').includes('当前步「1.W8」')), '步提醒真注入（成长导向）')
  const d2 = mk()
  await handler({ agent, messages: d2.messages }, async () => d2)
  assert.equal(d2.messages.filter((x) => x.source?.kind === 'plugin').length, 0, '同键二跑=零注入（face-spam 根除）')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
