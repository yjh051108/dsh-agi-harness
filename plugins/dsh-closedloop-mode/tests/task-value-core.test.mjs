import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-task-value-'))
process.env.DSH_HOME = TMP
const V = await import('../src/task-value-core.js')

const state = (extra = {}) => ({ stage: 'rolling', cost: { purpose: '统一任务状态与动作价值测试目的', assertions: [{ text: 'a', severity: 'major', source: 'test' }] }, groups: [{ title: '实现', settled: null }], closed: [], lastBand: 'far', ...extra })

test('v1 状态快照稳定生成候选', () => {
  const s = V.buildTaskState({ sid: 's1', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] }, friction: 2 })
  assert.equal(s.sid, 's1')
  assert.equal(s.model, 'test:model')
  assert.equal(s.remainingGroups[0], '实现')
  assert.ok(V.enumerateCandidates(s).some((c) => c.id === 'advance-complete-increment'))
})

test('v2 冷启动不编造价值', () => {
  const s = V.buildTaskState({ state: state(), stack: { steps: [], rolledBack: [] } })
  const c = V.enumerateCandidates(s)[0]
  const score = V.scoreCandidate(c, s, [])
  assert.equal(score.calibrated, false)
  assert.equal(score.label, '未校准')
})

test('v3 相近历史可保守评分且决策结果按 id 追加回读', () => {
  const s = V.buildTaskState({ sid: 's3', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] } })
  const c = V.enumerateCandidates(s)[0]
  const history = Array.from({ length: 5 }, () => ({ taskSig: s.taskSig, candidateId: c.id, finalQuality: 'accepted' }))
  const score = V.scoreCandidate(c, s, history)
  assert.equal(score.calibrated, true)
  const d = V.recordDecision({ decisionId: 'decision-1', taskState: s, candidates: [{ ...c, score }], selectedCandidateId: c.id })
  const o = V.recordOutcome({ decisionId: d.decisionId, taskState: s, candidateId: c.id, finalQuality: 'self_checked' })
  assert.equal(o.decisionId, 'decision-1')
  assert.equal(V.readRecords('task-decisions.jsonl').length, 1)
  assert.equal(V.readRecords('task-outcomes.jsonl').length, 1)
})

test('v4 未绑定候选不获得结果：recordBoundOutcome 返回 null 且零写', () => {
  const s = V.buildTaskState({ sid: 'unbound', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] } })
  assert.equal(V.recordBoundOutcome({ taskState: s, finalQuality: 'self_checked' }), null)
  assert.equal(V.readRecords('task-outcomes.jsonl').length, 1, '只保留 v3 的显式结果')
})

test('v5 实际 declare 只绑定对应候选，不回写决策快照', () => {
  const s = V.buildTaskState({ sid: 'bound', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] } })
  const candidates = V.enumerateCandidates(s)
  const d = V.recordDecision({ decisionId: 'decision-bound', taskState: s, candidates })
  const b = V.bindActualAction({ taskState: s, actionKind: 'declare', actionTitle: '真实声明动作' })
  assert.equal(b.decisionId, d.decisionId)
  assert.equal(b.candidateId, 'advance-complete-increment')
  assert.equal(V.readRecords('task-decisions.jsonl').find((x) => x.decisionId === d.decisionId).selectedCandidateId, null)
})

test('v6 终验与反馈均只回填同一已绑定决策', () => {
  const s = V.buildTaskState({ sid: 'outcome', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] } })
  V.recordDecision({ decisionId: 'decision-outcome', taskState: s, candidates: V.enumerateCandidates(s) })
  V.bindActualAction({ taskState: s, actionKind: 'declare' })
  const first = V.recordBoundOutcome({ taskState: s, finalQuality: 'self_checked' })
  const second = V.recordBoundOutcome({ taskState: s, finalQuality: 'accepted' })
  assert.equal(first.decisionId, 'decision-outcome')
  assert.equal(second.decisionId, 'decision-outcome')
  assert.equal(first.candidateId, second.candidateId)
})

test('v7 新候选快照不吞旧绑定：终验仍归因给此前真实动作', () => {
  const s = V.buildTaskState({ sid: 'later-snapshot', model: 'test:model', state: state(), stack: { steps: [], rolledBack: [] } })
  const candidates = V.enumerateCandidates(s)
  V.recordDecision({ decisionId: 'decision-first', taskState: s, candidates })
  V.bindActualAction({ taskState: s, actionKind: 'declare' })
  V.recordDecision({ decisionId: 'decision-later', taskState: s, candidates })
  const outcome = V.recordBoundOutcome({ taskState: s, finalQuality: 'self_checked' })
  assert.equal(outcome.decisionId, 'decision-first')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
