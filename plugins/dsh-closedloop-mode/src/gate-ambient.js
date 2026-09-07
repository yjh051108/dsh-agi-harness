/**
 * gate-ambient — v0.7.2 Phase 4 学习环闭合：读侧消费三层权重 → 注入面一行成长提示。
 * 开发者目标「完全落地且实测可行」的关键：闸学到的权重必须真正影响下一次决策，
 * 否则只是日志器不是学习环。低命中的闸 → 一行成长导向提醒（高命中不打扰=尊重注意力，
 * 无数据不出=不空喊）。阈值取经验下界：0.5 置信以下且 ≥MIN_TRIALS 才提。
 */
import { queryGate } from './gate-core.js'
import { comboPenalty } from './gate-combo.js'

const MIN_TRIALS = 8        // 少于 8 次样本=噪声，不据此提醒（Wilson 下界此时不稳）
const COACH_THRESHOLD = 0.5 // 融合置信低于此才提醒（高于=这个动作你已经做得好，别打扰）

// 闸 → 成长提醒文案（任务语，非防御语：告诉模型"怎么提分"，不是"你又错了"）
const COACH = {
  step_hint: (c, n) => `声明命中率 ${c}（${n} 次）——预测前先想清楚「数字从哪来、实测会是多少」，这是提分最快的一处。`,
  deviation: (c, n) => `对账命中率 ${c}（${n} 次）——交实测前先真跑一遍，别信记忆里的数。`,
  baseline: (c, n) => `探针命中率 ${c}（${n} 次）——先实测再预测，探针是你最可信的器官。`,
  complexity_bias: (c, n) => `复杂度校准 ${c}（${n} 次）——步子迈小一点，每步做完再开下一步。`,
}

/**
 * 生成一行学习驱动的 ambient 提示（无则返回空串=零注入）。
 * @param {string} model 模型指纹
 * @param {string[]} focusGates 当前阶段最相关的闸（如 declare 前看 step_hint）
 * @param {string} phase 阶段标签（拼进文案前缀）
 */
export function gateAmbientLine({ model = 'default', focusGates = [], phase = '' } = {}) {
  // Phase9 健康门：历史高回炉的闸组合→本拍不据其推送（降频不硬拦）
  let penalized = new Set()
  try { penalized = new Set(comboPenalty(focusGates) || []) } catch { /* 组合层故障=不降权，退回单闸逻辑 */ }
  let best = null
  for (const gateId of focusGates) {
    if (penalized.has(gateId)) continue
    const q = COACH[gateId] ? queryGate({ gateId, model }) : null
    if (!q) continue
    // 用 session 层命中率判断（新鲜数据，反映当前状态）；数据太少跳过
    const s = q.layers.session
    if (s.trials < MIN_TRIALS) continue
    if (s.confidence >= COACH_THRESHOLD) continue // 做得好，不打扰
    if (!best || s.confidence < best.confidence) best = { gateId, confidence: s.confidence, trials: s.trials }
  }
  if (!best) return ''
  const pct = Math.round(best.confidence * 100)
  const line = COACH[best.gateId](pct + '%', best.trials)
  return `📊 你的成长记录 · ${phase || '当前'}：${line}`
}

/**
 * 阶段 → 关注闸映射（供 ambient 调用方按当前动作选闸）。
 */
export const PHASE_FOCUS = {
  declare: ['step_hint', 'complexity_bias'],
  converge: ['deviation', 'baseline'],
  probe: ['baseline'],
}
