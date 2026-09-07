/**
 * judge-criteria.test — v0.6.24 判据闸执行器统一回归（摩擦报告 b7462c70 案底直修）
 * j1 decompose 判据注释（全角括号）提交即拒（案底：注释拼进命令=Command failed 误判红）
 * j2 组落账 broken 命令=「跑不了」≠判据红（显式分类，组不落账但类别明示）
 * j3 组落账 判据红（能跑但 exit≠0）=「判据红」显式（不落账）
 * j4 组落账 判据绿 = settled（现状保持）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-judge-'))
process.env.DSH_HOME = TMP

const ms = await import('../src/mode-state.js')
const T = await import('../src/tools.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })

function contractState(sid) {
  let s = { ...ms.initMode(), stage: 'brainstorm', task: 't' }
  s = { ...s, cost: { purpose: '为测试者验证判据闸统一（十二字以上）', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  ms.saveState(sid, s)
}

const settleState = (accept) => ({
  ...ms.initMode(),
  stage: 'rolling',
  weightsLocked: true,
  groups: [{ title: 'G', spec: 's', accept, verify: 'self', settled: null, closeRequested: true }],
  closed: [{ title: 'A1', group: 'G', at: 1, band: 'near', audit: null }],
})

test('j1 decompose 判据带注释（全角括号）→ 提交即拒（案底 b7462c70：注释拼进命令）', async () => {
  const sid = 'judge-j1'
  contractState(sid)
  const r = T.decomposeDefinition().execute({
    groups: [{ title: 'G', spec: 's', accept: ['cmd:node scripts/build.mjs（判据=构建绿）'], verify: 'self' }],
  }, exec(sid))
  await assert.rejects(() => r, /人判:|注释|案底/, '注释必须进 人判: 项，cmd: 只许命令本体')
})

test('j2 组落账 broken 命令（不存在模块）→ 显式「跑不了」≠判据红，组不落账', () => {
  const s = settleState(['cmd:node D:/no-such-dir/no-such.mjs'])
  const r = T.trySettleGroups(s, [{ title: 'A1', status: 'closed' }])
  assert.match(r.notes.join(), /跑不了/, '命令坏=跑不了（非判据红）')
  assert.doesNotMatch(r.notes.join(), /判据红/, 'broken 不冒充判据红')
  assert.match(r.notes.join(), /不落账/, '组保持未落账')
  assert.equal(r.state.groups[0].settled, null)
})

test('j3 组落账 判据红（能跑 exit≠0）→ 显式「判据红」，组不落账', () => {
  const redMjs = path.join(TMP, 'red.mjs')
  fs.writeFileSync(redMjs, 'process.exit(3)\n', 'utf8')
  const s = settleState([`cmd:node ${redMjs}`])
  const r = T.trySettleGroups(s, [{ title: 'A1', status: 'closed' }])
  assert.match(r.notes.join(), /判据红/, '能跑但红=判据红（与跑不了可区分）')
  assert.match(r.notes.join(), /不落账/)
  assert.equal(r.state.groups[0].settled, null)
})

test('j5 decompose 判据指向本步内创建的脚本：dry-run 接受并标注挂账（v0.8.2 死锁修复）', async () => {
  const sid = 'judge-j5'
  contractState(sid)
  const r = await T.decomposeDefinition().execute({
    groups: [{ title: 'G', spec: 's', accept: ['cmd:node scripts/no-today.mjs'], verify: 'self' }],
  }, exec(sid))
  assert.match(r.text, /组结构落盘/, 'pending 判据不再整单拒（旧实现此处抛 broken）')
  assert.match(r.text, /物料未就位/, '回执如实标注挂账')
})

test('j6 挂账判据落账时仍须实跑：目标未创建=不落账', () => {
  const s = settleState(['cmd:node scripts/no-today.mjs'])
  const r = T.trySettleGroups(s, [{ title: 'A1', status: 'closed' }])
  assert.match(r.notes.join(), /物料未就位/)
  assert.match(r.notes.join(), /不落账/)
  assert.equal(r.state.groups[0].settled, null)
})

test('j7 判据对象形态入参（v0.8.5 JSON 识别）：{kind,command|text} 与字符串等价，且宿主冻结入参不炸', async () => {
  const sid = 'judge-j7'
  contractState(sid)
  // 宿主工具管线会冻结入参（v0.8.5 案底：原地改写 g.accept 抛 readonly）——冻结对象必须照样可提交
  const frozen = Object.freeze([
    Object.freeze({ title: 'G', spec: 's', verify: 'self', accept: Object.freeze([Object.freeze({ kind: 'cmd', command: 'node scripts/build.mjs' }), Object.freeze({ kind: 'human', text: '浏览器实拍见主峰' })]) }),
  ])
  const r = await T.decomposeDefinition().execute({ groups: frozen }, exec(sid))
  assert.match(r.text, /组结构落盘/, '冻结入参照常落组（克隆而非改写）')
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'graded-state', sid + '.closedloop.json'), 'utf8'))
  const acc = saved.groups.find((g) => g.title === 'G').accept
  assert.ok(acc.includes('cmd:node scripts/build.mjs'), '对象形态规范化为 cmd: 前缀')
  assert.ok(acc.includes('人判:浏览器实拍见主峰'), 'human 规范化为 人判: 前缀')
})

test('j8 判据对象形态非法（缺 command/text）→ 明确拒并指路', async () => {
  const sid = 'judge-j8'
  contractState(sid)
  await assert.rejects(() => T.decomposeDefinition().execute({
    groups: [{ title: 'G', spec: 's', accept: [{ kind: 'cmd' }], verify: 'self' }],
  }, exec(sid)), /判据对象形态/)
})

test('j4 组落账 判据绿 → settled（现状保持）', () => {
  const okMjs = path.join(TMP, 'ok.mjs')
  fs.writeFileSync(okMjs, 'process.stdout.write("CLEAN")\n', 'utf8')
  const s = settleState([`cmd:node ${okMjs}`])
  const r = T.trySettleGroups(s, [{ title: 'A1', status: 'closed' }])
  assert.match(r.notes.join(), /落账 ✓/, '判据绿=组落账')
  assert.ok(r.state.groups[0].settled && r.state.groups[0].settled.verdict === 'mechanical-settle')
})

test('j9 挂账提示折叠：同类多条压成一行+N（v0.8.6 展示抖动修复）', async () => {
  const sid = 'judge-j9'
  contractState(sid)
  const acc = Array.from({ length: 5 }, () => ({ kind: 'cmd', command: 'node scripts/no-today.mjs' }))
  const r = await T.decomposeDefinition().execute({ groups: [{ title: 'G', spec: 's', accept: acc, verify: 'self' }] }, exec(sid))
  const listed = (r.text.match(/判据 #[0-9]+/g) || []).length
  assert.ok(listed <= 3, `折叠后仅列前 3 条（原 5 条同类，实列 ${listed}）`)
  assert.match(r.text, /另有 2 条同类判据挂账/)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
