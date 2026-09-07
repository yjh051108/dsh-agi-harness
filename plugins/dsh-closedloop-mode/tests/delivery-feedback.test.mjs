import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-feedback-'))
process.env.DSH_HOME = TMP
const T = await import('../src/tools.js')
const V = await import('../src/task-value-core.js')
const W = await import('../src/gate-wiring.js')
const { initMode, saveState, loadState } = await import('../src/mode-state.js')

const sid = 'feedback-current'
const ready = () => saveState(sid, {
  ...initMode(), stage: 'final', terminalReport: { zero: true },
  cost: { purpose: '开发者交付反馈真实帧测试目的', assertions: [{ text: 'a', severity: 'major', source: 'test' }] },
  groups: [{ title: 'G', settled: { at: 1, verdict: 'pass' } }],
})
const exec = (messages) => ({ agent: { session: { id: sid, deriveMessages: async () => messages } } })
const human = (text) => ({ role: 'user', source: { kind: 'user', rpcId: 'human-1' }, content: [{ type: 'text', text }] })

test('f1 无真人帧拒绝：模型参数不能伪造 accepted', async () => {
  ready()
  await assert.rejects(() => T.deliveryFeedbackDefinition().execute({ result: 'accepted' }, exec([{ role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: '交付反馈 accepted' }] }])), /真人证据/)
})

test('f2 真人帧与参数不一致拒绝，只认开发者原话', async () => {
  ready()
  await assert.rejects(() => T.deliveryFeedbackDefinition().execute({ result: 'accepted' }, exec([human('交付反馈 rejected')])), /不一致/)
})

test('f3 真人帧匹配后才追加 accepted；终验自身只写 self_checked', async () => {
  ready()
  const terminalState = { ...loadState(sid), closed: [{ title: 'a', assertion: 'a' }] }
  const taskState = V.buildTaskState({ sid, model: 'test:model', state: terminalState, stack: { rolledBack: [] } })
  const chosen = V.enumerateCandidates(taskState).find((c) => c.id === 'terminal-check')
  V.recordDecision({ decisionId: 'feedback-bound', taskState, candidates: [chosen] })
  V.bindActualAction({ taskState, actionKind: 'terminal' })
  W.onTerminalZero({ s: terminalState, stack: { rolledBack: [] }, frictionSummary: {}, sid })
  const quality = V.readRecords('quality-ledger.jsonl').at(-1)
  assert.equal(quality.finalQuality, 'self_checked')
  const selfChecked = V.readRecords('task-outcomes.jsonl').at(-1)
  assert.equal(selfChecked.finalQuality, 'self_checked')
  const r = await T.deliveryFeedbackDefinition().execute({ result: 'accepted', note: '可用' }, exec([human('交付反馈 accepted')]))
  assert.match(r.text, /accepted/)
  const outcome = V.readRecords('task-outcomes.jsonl').at(-1)
  assert.equal(outcome.finalQuality, 'accepted')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
