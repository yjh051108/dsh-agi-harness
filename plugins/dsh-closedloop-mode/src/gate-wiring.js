/**
 * gate-wiring — v0.7.0 闸接线层：把闸核心接入现有回执点，每次交互实时更新权重。
 * 接入 5 点：declare 成功/失败→step_hint 闸、converge 成功/失败→deviation 闸、
 *            terminal 归零→progress 闸、probe 落台账→baseline 闸、写闸拒→friction 闸。
 * 全部 try-catch 静默包裹（闸失败不影响主路）。模型指纹自动取当前会话模型。
 */
import { recordGateEffect, getModelFingerprint } from './gate-core.js'
import { recordQuality } from './quality-ledger.js'
import { bindActualAction, buildTaskState, recordBoundOutcome } from './task-value-core.js'
import { recordCombo } from './gate-combo.js'
import { PHASE_FOCUS } from './gate-ambient.js'

/** 安全记录（闸层故障=静默，不碰主路） */
function safeRecord(gateId, success, context) {
  try {
    return recordGateEffect({ gateId, success, model: getModelFingerprint(), context })
  } catch { return null }
}

/** declare 成功 → step_hint 闸记正效果 */
export function onDeclareSuccess(context) { safeRecord('step_hint', true, context) }

/** declare 被拒 → step_hint 闸记负效果 */
export function onDeclareReject(context) { safeRecord('step_hint', false, context) }

/** converge 成功 → deviation 闸记正 + Phase8 组合学习（本拍活跃闸组合记为闭合） */
export function onConvergeSuccess(context) {
  safeRecord('deviation', true, context)
  try { recordCombo({ gates: PHASE_FOCUS.converge, closed: true }) } catch { /* 组合学习失败不碰主路 */ }
}

/** converge 失败 → deviation 闸记负效果 */
export function onConvergeReject(context) { safeRecord('deviation', false, context) }

/** 回滚 → Phase8/9 组合学习（declare 相位活跃组合记为回炉，供健康门降权） */
export function onRollback() {
  try { recordCombo({ gates: PHASE_FOCUS.declare, rerolled: true }) } catch { /* 静默 */ }
}

/** terminal 归零 → progress 闸记正 + 质量账本自动记录 */
export function onTerminalZero({ s, stack, frictionSummary, sid }) {
  safeRecord('progress', true)
  try {
    const missCount = ((stack && stack.steps) || []).filter((x) => x && Array.isArray(x.discrepancies) && x.discrepancies.length).length
    recordQuality({
      sid,
      purpose: s?.cost?.purpose,
      assertions: s?.cost?.assertions,
      groups: s?.groups,
      writeSet: s?.writeSet,
      rerolls: (stack?.rolledBack || []).length,
      rerollLayers: (stack?.rolledBack || []).reduce((acc, r) => {
        const layer = r.layer || 'reasoning'
        acc[layer] = (acc[layer] || 0) + 1
        return acc
      }, {}),
      predictionBias: [],
      humanInterventions: 0,
      tokenCost: 0,
      frictionCount: frictionSummary?.total || 0,
      zTimeline: [],
      zeroed: true,
      missCount,
      // 终验只是系统自检；真实 accepted 只能由 delivery_feedback 的真人帧写入。
      finalQuality: 'self_checked',
    })
    const taskState = buildTaskState({ sid, model: getModelFingerprint(), state: s, stack, purpose: s?.cost?.purpose, assertions: s?.cost?.assertions })
    // 已有 declare/probe 选择则不覆盖；只有终端候选被实际执行时才作为兜底绑定。
    bindActualAction({ taskState, actionKind: 'terminal', actionTitle: 'terminal_check' })
    // 无实际候选绑定时不写学习结果，避免把终验广播给仅被展示过的候选。
    recordBoundOutcome({ taskState, finalQuality: 'self_checked', rerolls: (stack?.rolledBack || []).length, zeroed: true, missCount })
  } catch { /* 质量记录失败不影响归零 */ }
}

/** probe 落台账 → baseline 闸记正（探针成功=模型用了测量器官） */
export function onProbeSuccess(context) { safeRecord('baseline', true, context) }

/** probe 被拒 → baseline 闸记负 */
export function onProbeReject(context) { safeRecord('baseline', false, context) }

/** 写闸拒 → friction 闸记负（摩擦增加=注入策略需调整） */
export function onWriteGateDeny(context) { safeRecord('friction', false, context) }

/** 写闸放行 → friction 闸记正（闸放行了 open 步内的写=正确行为） */
export function onWriteGateAllow(context) { safeRecord('friction', true, context) }
