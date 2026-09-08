/**
 * falsify-wiring.test — v0.8.30 判据可证伪门 · 接线层（写入面台账 + 落账门）
 * w1 falsifyBlock：grep 型判据 ⇒ block（判据空转）
 * w2 falsifyBlock：行为型判据 ⇒ 不 block
 * w3 落账门：空转判据的组不落账，回执给出改法，且产物已还原
 * w4 落账门：行为型判据的组正常落账
 * w5 无产物（判据目标尚未创建）⇒ 门不误杀（走 no-artifact，拦的是"判据红"不是"空转"）
 * w6 写入面台账 recordWrite：去重/上限/空值不添键
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { falsifyBlock, trySettleGroups } = await import('../src/tools.js')
const { initMode, onGroupsEdit, recordWrite, MAX_WRITE_SET } = await import('../src/mode-state.js')

const GREP_JUDGE = [
  "import { readFileSync } from 'node:fs'",
  'const txt = readFileSync(process.argv[2], "utf8")',
  'process.exit(txt.includes("NEEDLE") ? 0 : 1)',
].join('\n')

const BEHAVIOR_JUDGE = [
  "import { pathToFileURL } from 'node:url'",
  'const m = await import(pathToFileURL(process.argv[2]).href)',
  'process.exit(m.answer === 42 ? 0 : 1)',
].join('\n')

const BEHAVIOR_ARTIFACT = 'export const answer = 42\n'

/** 建一个临时工作区：grep 型判据 + 产物 */
function grepCase() {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-wire-grep-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.txt')
  writeFileSync(judge, GREP_JUDGE)
  writeFileSync(artifact, 'NEEDLE 真做了活的产物\n')
  return { dir, judge, artifact }
}

/** 建一个临时工作区：行为型判据 + 产物 */
function behaviorCase() {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-wire-beh-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.mjs')
  writeFileSync(judge, BEHAVIOR_JUDGE)
  writeFileSync(artifact, BEHAVIOR_ARTIFACT)
  return { dir, judge, artifact }
}

/** 造一个"请求落账"的最小状态（组+已闭动作+栈闭合） */
function settleState(accept, writeSet) {
  const r = onGroupsEdit(initMode(), [{ title: 'G', spec: '测试组', accept, verify: 'self', closeRequested: true }])
  assert.equal(r.ok, true, r.error || '')
  return { ...r.state, stage: 'rolling', weightsLocked: true, writeSet, closed: [{ title: 'A', group: 'G', at: Date.now() }] }
}
const STEPS = [{ title: 'A', status: 'closed' }]

test('w1 falsifyBlock：grep 型判据 ⇒ block', async () => {
  const { dir, judge, artifact } = grepCase()
  const fb = await falsifyBlock([`cmd: node ${judge} ${artifact}`], { writeSet: [judge, artifact], cwd: dir })
  assert.equal(fb.block, true, '字面壳能过 ⇒ 判据空转 ⇒ 必须 block')
  assert.equal(fb.notes[0].includes('判据空转'), true)
  assert.equal(fb.notes[0].includes('行为型判据'), true, '拒收文案必须带改法')
  assert.equal(fb.details[0].verdict, 'vacuous')
  assert.equal(readFileSync(artifact, 'utf8'), 'NEEDLE 真做了活的产物\n', '负对照后产物已还原')
})

test('w2 falsifyBlock：行为型判据 ⇒ 不 block', async () => {
  const { dir, judge, artifact } = behaviorCase()
  const fb = await falsifyBlock([`cmd: node ${judge} ${artifact}`], { writeSet: [judge, artifact], cwd: dir })
  assert.equal(fb.block, false, '真执行产物读运行时读数 ⇒ 两条负对照都红 ⇒ sensitive')
  assert.equal(fb.details[0].verdict, 'sensitive')
  assert.equal(readFileSync(artifact, 'utf8'), BEHAVIOR_ARTIFACT)
})

test('w3 落账门：空转判据的组不落账，回执给改法', async () => {
  const { dir, judge, artifact } = grepCase()
  const s = settleState([`cmd: node ${judge} ${artifact}`], [judge, artifact])
  const out = await trySettleGroups(s, STEPS, new Set(), dir)
  assert.equal(out.state.groups[0].settled, null, '判据不可证伪 ⇒ 组不落账')
  const joined = out.notes.join('\n')
  assert.equal(joined.includes('判据不可证伪'), true, joined)
  assert.equal(joined.includes('判据空转'), true, joined)
})

test('w4 落账门：行为型判据的组正常落账', async () => {
  const { dir, judge, artifact } = behaviorCase()
  const s = settleState([`cmd: node ${judge} ${artifact}`], [judge, artifact])
  const out = await trySettleGroups(s, STEPS, new Set(), dir)
  assert.notEqual(out.state.groups[0].settled, null, '敏感判据 ⇒ 落账：' + out.notes.join(' / '))
  assert.equal(out.notes.join('\n').includes('落账 ✓'), true, out.notes.join('\n'))
})

test('w5 无产物 ⇒ 门不误杀（拦的是判据红，不是空转）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-wire-none-'))
  const judge = join(dir, 'judge.mjs')
  writeFileSync(judge, GREP_JUDGE)
  const s = settleState([`cmd: node ${judge} ${join(dir, 'not-yet.txt')}`], [judge])
  const out = await trySettleGroups(s, STEPS, new Set(), dir)
  const joined = out.notes.join('\n')
  assert.equal(joined.includes('判据不可证伪'), false, '无可变异产物 ⇒ 不该按空转拒：' + joined)
  assert.equal(joined.includes('判据未全绿'), true, '判据自己红 ⇒ 仍不落账（另一条路）')
})

test('w6 写入面台账：去重/上限/空值不添键', () => {
  const s0 = initMode()
  assert.equal('writeSet' in s0, false, '初始态无 writeSet 键（round-trip 键纪律）')
  const s1 = recordWrite(s0, 'D:/a.js')
  assert.deepEqual(s1.writeSet, ['D:/a.js'])
  assert.equal(recordWrite(s1, 'D:/a.js'), s1, '重复路径返回原状态（幂等）')
  assert.equal(recordWrite(s1, '  '), s1, '空值不添键')
  let s = s1
  for (let i = 0; i < MAX_WRITE_SET + 10; i++) s = recordWrite(s, `D:/f${i}.js`)
  assert.equal(s.writeSet.length, MAX_WRITE_SET, '上限截断')
  assert.equal(s.writeSet[s.writeSet.length - 1], `D:/f${MAX_WRITE_SET + 9}.js`, '保留最新')
})
