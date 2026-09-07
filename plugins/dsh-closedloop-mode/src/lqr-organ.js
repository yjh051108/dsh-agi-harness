/**
 * lqr-organ — 任务级 LQR 读数面：统一状态/价值核心的任务语呈现层。
 * 只摆候选、依据、预期与不确定性，不替模型选路，不预排路线。
 */
import { queryGate } from './gate-core.js'
import { buildTaskState, enumerateCandidates, recordDecision, scoreCandidate } from './task-value-core.js'

const IMPERATIVE = /应该选|必须选|禁止|建议你选|只能选|应当执行/

function taskLanguage(candidate, s) {
  if (candidate.id === 'terminal-check') return { a: '整单已达完成条件——terminal_check 归零', basis: '未落账组 0', fallback: '收尾风险低' }
  if (candidate.id === 'advance-complete-increment') return { a: `推进未完成目标（还差组：${s.remainingGroups.slice(0, 2).join('、') || '断言未覆盖'}）——挑一个当场能测闭合的完整增量`, basis: candidate.basis, fallback: '未校准' }
  if (candidate.id === 'close-open-step') return { a: '完成当前已打开动作并记录真实结果', basis: candidate.basis, fallback: '未校准' }
  if (candidate.id === 'measure-before-predict') return { a: '先 probe_record 实测再预测（对账易失手时）', basis: candidate.basis, fallback: '预期降回炉·非保证' }
  if (candidate.id === 'remove-current-friction') return { a: '检查当前摩擦来源并恢复可验证推进', basis: candidate.basis, fallback: '未校准' }
  return { a: candidate.kind, basis: candidate.basis, fallback: '未校准' }
}

/**
 * 任务级读数一行。recordSnapshot 仅供受控接线调用；默认不记账，避免同一拍多读污染。
 */
export function lqrReadout({ sid, state, stack, model = 'default', purpose, assertions, friction = 0, recordSnapshot = false } = {}) {
  if (!state) return ''
  try {
    const s = buildTaskState({ sid, model, state, stack, friction, purpose, assertions })
    const candidates = enumerateCandidates(s).map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, s) }))
    if (!candidates.length) return ''

    // 现有读侧的有效经验仍可显示，但只作为候选预期，不再自行构造状态。
    const sh = queryGate({ gateId: 'step_hint', model })
    const shHit = sh?.layers?.session?.trials >= 5 ? Math.round(sh.layers.session.confidence * 100) : null
    const cold = candidates.every((c) => !c.score.calibrated) && shHit == null && !s.qualityTrend?.previous
    const lines = candidates.map((candidate, i) => {
      const text = taskLanguage(candidate, s)
      let exp = candidate.score.calibrated
        ? `交付增益 ${Math.round(candidate.score.expectedGain * 100)}%·不确定 ${Math.round(candidate.score.uncertainty * 100)}%`
        : text.fallback
      if (candidate.id === 'advance-complete-increment' && shHit != null) exp = `声明命中 ${shHit}%`
      return `  ${i + 1}) ${text.a}｜依据:${text.basis}｜预期:${exp}`
    })
    if (recordSnapshot) recordDecision({ taskState: s, candidates })
    const head = `🧭 任务级读数（候选+依据+预期，供你自选，不替你定）${cold ? ' · 冷启动=未校准' : ''}`
    const out = head + '\n' + lines.join('\n')
    return IMPERATIVE.test(out) ? '' : out
  } catch {
    return ''
  }
}
