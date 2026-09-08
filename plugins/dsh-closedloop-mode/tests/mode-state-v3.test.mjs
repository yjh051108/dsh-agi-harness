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
  controlSurface, terminalCheck, allGroupsSettled, STAGES, readAutoConfirm, normalizeGroup,
} from '../src/mode-state.js'

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-msv3-'))

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

test('p1c 空 doHistory 不添键（杀 .length→.length+1：键集漂移会被 deepEqual 抓到）', () => {
  const empty = normalizeGroup({ title: 'G', spec: 's', accept: ['a'], verify: 'self', doHistory: [] })
  assert.equal('doHistory' in empty, false, '空数组=不添键（防 deepEqual 键集漂移）')
  const some = normalizeGroup({ title: 'G', spec: 's', accept: ['a'], verify: 'self', doHistory: [{ do: 'self', at: 1 }] })
  assert.equal(Array.isArray(some.doHistory), true, '非空照添')
})

test('p1d autoConfirm 缺文件/坏 JSON 一律 false（杀 catch→return true：授权不得默认放行）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ac-'))
  const prev = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    assert.equal(readAutoConfirm(), false, '无设置文件=未授权')
    fs.writeFileSync(path.join(home, 'graded-settings.json'), '{ bad json')
    assert.equal(readAutoConfirm(), false, '坏 JSON=未授权')
    fs.writeFileSync(path.join(home, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }))
    assert.equal(readAutoConfirm(), true, '显式 true 才放行')
    fs.writeFileSync(path.join(home, 'graded-settings.json'), JSON.stringify({ autoConfirm: 'yes' }))
    assert.equal(readAutoConfirm(), false, '非布尔真值不算授权')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev
  }
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

/** FIX_V2_SAMPLES：内联 v2 盘档样本（自包含——开源不依赖任何机器的真实盘档）。 */
const FIX_V2_SAMPLES = [
  { v: 2, purpose: 'p', cost: { assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [] }, plan: { groups: [{ title: 'G', items: [{ title: 'A1', status: 'completed' }, { title: 'A2', status: 'pending' }] }] }, stage: 'develop', lastBand: 'far' },
  { v: 2, purpose: 'p2', cost: { assertions: [{ text: 'b', severity: 'catastrophic', source: 'y' }], nonGoals: [], assumptions: [] }, plan: { groups: [{ title: 'G2', items: [{ title: 'B1', status: 'completed' }] }] }, stage: 'final', lastBand: 'at' },
]

test('p3 v2 盘档迁移等式（fixture 自包含，测量时现算）', () => {
  for (const src of FIX_V2_SAMPLES) {
    const v3 = migrateLegacy(src)
    const items = (src.plan?.groups || []).flatMap((g) => g.items || [])
    assert.equal(v3.closed.length, items.filter((i) => i.status === 'completed').length, 'closed==completed')
    assert.equal(v3.groups.length, (src.plan?.groups || []).length, 'groups 等数')
    assert.equal(v3.cost.assertions.length, (src.cost?.assertions || []).length, 'assertions 等数')
    assert.equal(v3.stage, src.stage === 'develop' ? 'rolling' : src.stage === 'final' ? 'final' : v3.stage)
    assert.equal('vChain' in v3, false)
  }
})

test('p4 迁移读面零写盘（fixture 文件哈希不变）', () => {
  FIX_V2_SAMPLES.forEach((src, i) => {
    const f = path.join(TMP, `fix-v2-${i}.json`)
    fs.writeFileSync(f, JSON.stringify(src))
    const before = sha(fs.readFileSync(f))
    const s = JSON.parse(fs.readFileSync(f, 'utf8'))
    migrateLegacy(s)
    deserializeState(s)
    assert.equal(sha(fs.readFileSync(f)), before, `${path.basename(f)} 哈希不变`)
  })
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
