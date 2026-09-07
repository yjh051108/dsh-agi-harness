/**
 * task-value-core — 闸图之上的统一任务状态、动作价值与结果账本。
 * 只提供事实、候选和保守估计，不替模型选路，不放松硬边界。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import { queryGate } from './gate-core.js'
import { qualityTrend, taskSignature } from './quality-ledger.js'

const MIN_TRIALS = 5
const dir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'gate-weights')
const file = (name) => join(dir(), name)
const DECISIONS = 'task-decisions.jsonl'
const BINDINGS = 'task-bindings.jsonl'
const OUTCOMES = 'task-outcomes.jsonl'
function append(name, value) { try { mkdirSync(dir(), { recursive: true }); appendFileSync(file(name), JSON.stringify(value) + '\n', 'utf8'); return true } catch { return false } }
export function readRecords(name) {
  if (!existsSync(file(name))) return []
  try { return readFileSync(file(name), 'utf8').split('\n').filter(Boolean).flatMap((x) => { try { return [JSON.parse(x)] } catch { return [] } }) } catch { return [] }
}
function confidence(gateId, model) {
  try { const q = queryGate({ gateId, model }); const s = q?.layers?.session; return s && s.trials >= MIN_TRIALS ? { trials: s.trials, confidence: s.confidence } : null } catch { return null }
}

export function buildTaskState({ sid, model = 'unbound', state, stack, friction = 0, purpose, assertions } = {}) {
  const cost = state?.cost || {}
  const as = assertions || cost.assertions || []
  const closed = Array.isArray(state?.closed) ? state.closed : []
  const groups = Array.isArray(state?.groups) ? state.groups : []
  const rolled = Array.isArray(stack?.rolledBack) ? stack.rolledBack : []
  const remainingGroups = groups.filter((g) => g && !g.settled).map((g) => g.title).filter(Boolean)
  return {
    version: 1, at: Date.now(), sid: sid || null, model: model || 'unbound',
    taskSig: taskSignature(purpose || cost.purpose || '', as), stage: state?.stage || 'off',
    remainingGroups, remainingAssertions: Math.max(0, as.length - closed.length),
    openStep: stack?.steps?.filter((s) => s?.status === 'open').pop()?.title || null,
    closedSteps: closed.length, reasoningRollbacks: rolled.filter((r) => r?.layer !== 'transcription').length,
    friction: Math.max(0, Number(friction) || 0), lastBand: state?.lastBand || null,
    gates: Object.fromEntries(['baseline', 'step_hint', 'deviation', 'complexity_bias', 'confidence_bias', 'progress'].map((id) => [id, confidence(id, model)])),
    qualityTrend: purpose || cost.purpose ? qualityTrend(purpose || cost.purpose, as) : null,
  }
}

export function enumerateCandidates(s) {
  if (!s || typeof s !== 'object') return []
  const out = []
  const add = (id, kind, basis) => out.push({ id, kind, basis, signature: createHash('sha256').update(`${s.taskSig}:${id}`).digest('hex').slice(0, 12) })
  if (s.openStep) add('close-open-step', 'converge', `当前有 open 步：${s.openStep}`)
  if (s.remainingGroups.length || s.remainingAssertions > 0) add('advance-complete-increment', 'implement', `未落账组 ${s.remainingGroups.length}·剩余断言 ${s.remainingAssertions}`)
  if (!s.openStep && s.reasoningRollbacks >= 2) add('measure-before-predict', 'probe', `推理层回炉 ${s.reasoningRollbacks}`)
  if (s.friction > 0) add('remove-current-friction', 'inspect', `本单摩擦 ${s.friction}`)
  if (!s.remainingGroups.length && s.remainingAssertions === 0) add('terminal-check', 'finish', '完成条件已无未覆盖项')
  return out
}

export function scoreCandidate(candidate, s, history = readRecords('task-outcomes.jsonl')) {
  if (!candidate || !s) return { calibrated: false, label: '未校准', trials: 0 }
  const rows = history.filter((r) => r.taskSig === s.taskSig && r.candidateId === candidate.id)
  if (rows.length < MIN_TRIALS) return { calibrated: false, label: '未校准', trials: rows.length }
  const wins = rows.filter((r) => r.finalQuality === 'accepted' || r.finalQuality === 'no_defect').length
  const successRate = (wins + 1) / (rows.length + 2)
  const cost = Math.min(0.35, s.friction * 0.02 + s.reasoningRollbacks * 0.03)
  return { calibrated: true, label: '已校准', trials: rows.length, successRate: +successRate.toFixed(3), cost: +cost.toFixed(3), expectedGain: +Math.max(0, successRate - cost).toFixed(3), uncertainty: +(1 / Math.sqrt(rows.length)).toFixed(3) }
}

export function recordDecision({ decisionId = randomUUID(), taskState, candidates = [], selectedCandidateId = null } = {}) {
  const rec = { decisionId, at: new Date().toISOString(), taskSig: taskState?.taskSig || null, sid: taskState?.sid || null, model: taskState?.model || 'unbound', state: taskState ? { ...taskState, at: undefined } : null, candidates: candidates.map((c) => ({ id: c.id, kind: c.kind, signature: c.signature, score: c.score || null })), selectedCandidateId }
  append('task-decisions.jsonl', rec)
  return rec
}

/**
 * 实际动作绑定：只在模型真正 declare/probe/converge 后写入。
 * 决策快照不可回写；每次绑定独立追加，审计可重放。
 */
/** 当前任务的最近真实绑定；传 decisionId 时只查询该快照。 */
export function currentBinding(taskState, decisionId = null) {
  if (!taskState) return null
  const bindings = readRecords(BINDINGS).filter((b) => b.taskSig === taskState.taskSig && b.sid === taskState.sid)
  return (decisionId ? bindings.filter((b) => b.decisionId === decisionId) : bindings).at(-1) || null
}

export function bindActualAction({ taskState, actionKind, actionTitle = '', candidateId = null, decisionId = null } = {}) {
  const decisions = readRecords(DECISIONS).filter((d) => d.taskSig === taskState?.taskSig && d.sid === taskState?.sid)
  // 新快照可能在动作后生成；真实动作要绑定最近尚未被采取的候选，而非盲取最后一条。
  const decision = decisionId ? decisions.find((d) => d.decisionId === decisionId) : [...decisions].reverse().find((d) => !currentBinding(taskState, d.decisionId))
  if (!decision) return currentBinding(taskState)
  const chosen = candidateId || ({ declare: 'advance-complete-increment', probe: 'measure-before-predict', converge: 'close-open-step', terminal: 'terminal-check' }[actionKind] || null)
  if (!chosen || !decision.candidates?.some((c) => c.id === chosen)) return null
  const rec = { bindingId: randomUUID(), at: new Date().toISOString(), decisionId: decision.decisionId, taskSig: taskState.taskSig, sid: taskState.sid, model: taskState.model, candidateId: chosen, actionKind, actionTitle: String(actionTitle || '').slice(0, 200) }
  append(BINDINGS, rec)
  return rec
}

export function recordOutcome({ decisionId = null, taskState, candidateId = null, finalQuality = 'unknown', postDeliveryDefect = false, humanIntervention = 0, rerolls = 0, note = '' } = {}) {
  const allowed = ['accepted', 'needed_fix', 'rejected', 'self_checked', 'unknown', 'no_defect']
  const rec = { decisionId, at: new Date().toISOString(), taskSig: taskState?.taskSig || null, sid: taskState?.sid || null, model: taskState?.model || 'unbound', candidateId, finalQuality: allowed.includes(finalQuality) ? finalQuality : 'unknown', postDeliveryDefect: postDeliveryDefect === true, humanIntervention: Math.max(0, Number(humanIntervention) || 0), rerolls: Math.max(0, Number(rerolls) || 0), note: String(note || '').slice(0, 500) }
  append('task-outcomes.jsonl', rec)
  return rec
}

/** 只给最近实际绑定写结果；无绑定=不归因（不是 unknown 广播）。 */
export function recordBoundOutcome({ taskState, finalQuality = 'unknown', postDeliveryDefect = false, humanIntervention = 0, rerolls = 0, note = '' } = {}) {
  const binding = currentBinding(taskState)
  if (!binding) return null
  return recordOutcome({ decisionId: binding.decisionId, candidateId: binding.candidateId, taskState, finalQuality, postDeliveryDefect, humanIntervention, rerolls, note })
}

export function taskValueFiles() { return { decisions: file(DECISIONS), bindings: file(BINDINGS), outcomes: file(OUTCOMES) } }
