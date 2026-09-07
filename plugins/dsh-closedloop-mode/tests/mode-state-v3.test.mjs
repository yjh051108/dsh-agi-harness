/**
 * mode-state v3 合同测试（THEORY-v0.3 盘档块判据：往返等值 + 旧轨迹合同写面零命中 +
 * 真盘档迁移等式 + 源文件零接触哈希守护）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  initMode, serializeState, deserializeState, migrateLegacy, stateFileFor, legacyFileFor, trigger, deactivate, normalizeCost, loadConceptLimit, loadVerifyMode,
  onCostCommit, onGroupsEdit, onWeightsFreeze, onWeightsConfirmed, recordClosed, markGroupSettled,
  controlSurface, terminalCheck, allGroupsSettled, STAGES,
} from '../src/mode-state.js'

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

test('p1 全字段 round-trip 等值（含 terminalReport/injected/dipPending/closed）', () => {
  const full = {
    ...initMode(),
    stage: 'rolling', task: '测试单',
    cost: { purpose: 'p', assertions: [{ text: 'a1', severity: 'catastrophic', source: 'spec' }], nonGoals: ['ng'], nonGoalsConfirmed: true, assumptions: ['as'], aligned: true },
    groups: [{ title: 'G1', spec: 's', accept: ['x'], verify: 'redteam', do: '', settled: { at: 1, verdict: 'pass' } }],
    weightsLocked: true,
    closed: [{ title: 'b1', group: 'G1', at: 5, band: 'near', audit: { rounds: 1, passed: true } }, { title: 'b2', group: 'G1', at: 6, band: 'at', audit: null }],
    lastBand: 'at', dipPending: true,
    terminalReport: { at: 7, zero: true, closedSteps: 2 },
    injected: new Set(['weights', 'kickoff']),
  }
  assert.deepEqual(deserializeState(JSON.parse(JSON.stringify(serializeState(full)))), full)
  assert.deepEqual(deserializeState(JSON.parse(JSON.stringify(serializeState(initMode())))), initMode())
  // 可选域省略（serialize 的 undefined 不落 JSON）
  const bare = { ...initMode(), stage: 'brainstorm', task: 't', cost: onCostCommit(null, { purpose: 'p', assertions: [{ text: 'a', severity: 'minor', source: 's' }] }).cost }
  assert.deepEqual(deserializeState(JSON.parse(JSON.stringify(serializeState(bare)))), bare)
})

test('terminalCheck 饱和口径（#A/#B）：底档挂账不阻归零；中档挂账照阻', () => {
  const cost = { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }] }
  const g = [{ title: 'G', spec: '', accept: ['x'], verify: 'self', settled: { at: 1, verdict: 'pass' } }]
  const satStack = { steps: [{ title: 'A', status: 'closed', pendingDip: true, dv: { after: 'at', before: 'near', mode: 'dip' } }] }
  assert.equal(terminalCheck(cost, satStack, { groups: g }, 'final').zero, true, 'at 档旧挂账=饱和已清偿')
  const midStack = { steps: [{ title: 'A', status: 'closed', pendingDip: true, dv: { after: 'far', before: 'far', mode: 'dip' } }] }
  assert.equal(terminalCheck(cost, midStack, { groups: g }, 'final').zero, false, '中档挂账照阻')
})

test('p2 写面零轨迹键：输出键集 ∩ 禁止键 = ∅ 且源码写面段无 vChain', () => {
  const out = serializeState({ ...initMode(), stage: 'weights' })
  const banned = ['vChain', 'l1Locked', 'l2Locked', 'reviewPending', 'plan', 'star']
  assert.deepEqual(banned.filter((k) => k in out), [])
  const srcTxt = fs.readFileSync(new URL('../src/mode-state.js', import.meta.url), 'utf8')
  const marker = '迁移读面（旧键只读映射区）'
  const cut = srcTxt.indexOf(marker)
  assert.ok(cut > 0, '读写面标记存在')
  assert.equal(srcTxt.slice(0, cut).includes('vChain'), false, '写面段 vChain 命中 0')
  assert.equal(srcTxt.slice(cut).includes('vChain'), true, '读面段 vChain 命中登记（只读映射合法）')
})

test('p3 真 v2 盘档迁移等式（动态跨通道，测量时现算）', () => {
  for (const sid of ['session-b74630b0-c63f-4ce5-8a96-daac4de47c99', '4e0ae1fd-5d01-48bb-bdfd-cee5136938b3']) {
    const f = legacyFileFor(sid)
    if (!fs.existsSync(f)) { console.warn('跳过（无旧档）:', sid); continue }
    const raw = fs.readFileSync(f)
    const src = JSON.parse(raw.toString('utf8'))
    const v3 = migrateLegacy(src)
    const items = (src.plan?.groups || []).flatMap((g) => g.items || [])
    assert.equal(v3.closed.length, items.filter((i) => i.status === 'completed').length, `${sid} closed==completed`)
    assert.equal(v3.groups.length, (src.plan?.groups || []).length, `${sid} groups 等数`)
    assert.equal(v3.cost.assertions.length, (src.cost?.assertions || []).length, `${sid} assertions 等数`)
    assert.equal(v3.stage, src.stage === 'develop' ? 'rolling' : src.stage === 'final' ? 'final' : v3.stage)
    assert.equal('vChain' in v3, false)
  }
})

test('p4 源盘档零接触（全部测试读旧档后哈希不变）', () => {
  const files = ['session-b74630b0-c63f-4ce5-8a96-daac4de47c99', '4e0ae1fd-5d01-48bb-bdfd-cee5136938b3']
    .flatMap((sid) => [stateFileFor(sid), legacyFileFor(sid), legacyFileFor(sid).replace('.json', '.optimal.json')])
    .filter((f) => fs.existsSync(f))
  const before = files.map((f) => sha(fs.readFileSync(f)))
  for (const f of files) { const s = JSON.parse(fs.readFileSync(f, 'utf8')); migrateLegacy(s); deserializeState(s) }
  files.forEach((f, i) => assert.equal(sha(fs.readFileSync(f)), before[i], `${path.basename(f)} 哈希不变`))
})

test('p5 快环算子链：标定→组→冻结→确认→闭合→落账→归零', () => {
  let s = trigger(initMode(), 't3')
  assert.equal(s.stage, 'brainstorm')
  s = onCostCommit(s, { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: ['ng'], nonGoalsConfirmed: true })
  assert.equal(s.cost.aligned, true)
  s = onGroupsEdit(s, [{ title: 'G', spec: 'sp', accept: ['ac'] }]).state
  assert.equal(onWeightsFreeze(s).ok, true)
  s = onWeightsConfirmed(onWeightsFreeze(s).state)
  assert.equal(s.stage, 'rolling')
  s = recordClosed(s, { title: 'act-1', group: 'G', band: 'near' }).state
  s = markGroupSettled(s, 'G', 'pass').state
  assert.equal(allGroupsSettled(s), true)
  const rep = terminalCheck(s.cost, { steps: [{ title: 'act-1', status: 'closed' }] }, s, 'final')
  assert.equal(rep.zero, true)
  assert.throws(() => terminalCheck(s.cost, { steps: [] }, s, 'rolling'), /final/)
  // 锁后组编辑拒绝（唯一锁点）
  assert.equal(onGroupsEdit(s, [{ title: 'H' }]).ok, false)
  // 残差读数由盘档直读（模型不抄）：controlSurface 含全部 #3/#4 所需
  const surf = controlSurface(s)
  assert.deepEqual(Object.keys(surf).sort(), ['closed', 'cost', 'groups', 'residual', 'reviewNote', 'stage', 'task', 'weightsLocked'])
  assert.equal(surf.residual.lastBand, 'near')
  assert.equal(surf.residual.groupsOpen.length, 0)
})

test('STAGES 五态且 STAGE 迁移映射完整', () => {
  assert.deepEqual(STAGES, ['off', 'brainstorm', 'weights', 'rolling', 'final'])
  for (const legacy of ['off', 'brainstorm', 'l1-edit', 'l2-edit', 'review', 'develop', 'final']) {
    const m = migrateLegacy({ stage: legacy, plan: { groups: [] } })
    assert.ok(STAGES.includes(m.stage), legacy + ' → ' + m.stage)
  }
})

/* ---------- 存活函数补覆（旧 mode-state.test 处置的直迁/形变形） ---------- */

test('p7 存活件：非法 stage 回 initMode / trigger 清合同 / deactivate 归零 / normalizeCost 遗留字符串继承标记', () => {
  assert.deepEqual(deserializeState({ stage: 'nonsense' }), initMode())
  assert.deepEqual(deserializeState(null), initMode())
  const t = trigger(initMode(), '任务X')
  assert.equal(t.stage, 'brainstorm')
  assert.equal(t.task, '任务X')
  assert.equal(t.cost.aligned, false)
  assert.deepEqual(deactivate(), initMode())
  const legacyStrs = normalizeCost({ assertions: ['旧条目'] })
  assert.deepEqual(legacyStrs.assertions, [{ text: '旧条目', severity: 'major', source: '旧盘档继承' }], '字符串条目=遗留形态，继承标记不冒充新立')
})

test('p8 设置读取存活：全局+会话覆盖+非法回退（旧两例并作形变）', () => {
  const prev = process.env.DSH_HOME
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-set-'))
  process.env.DSH_HOME = tmp
  try {
    fs.mkdirSync(path.join(tmp, 'graded-state'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'graded-settings.json'), JSON.stringify({ conceptLimit: 5, verifyMode: 'subagent' }))
    assert.equal(loadConceptLimit('sid-n'), 5, '全局生效')
    assert.equal(loadVerifyMode('sid-n'), 'subagent')
    fs.writeFileSync(path.join(tmp, 'graded-state', 'sid-1.settings.json'), JSON.stringify({ conceptLimit: 8 }))
    assert.equal(loadConceptLimit('sid-1'), 8, '会话覆盖优先')
    assert.equal(loadVerifyMode('sid-1'), 'subagent', '会话未覆盖项回落全局')
    fs.writeFileSync(path.join(tmp, 'graded-settings.json'), JSON.stringify({ conceptLimit: 99 }))
    assert.equal(loadConceptLimit('sid-x'), 3, '越界回退 3')
  } finally {
    process.env.DSH_HOME = prev
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
