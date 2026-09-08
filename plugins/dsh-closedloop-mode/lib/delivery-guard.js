/**
 * delivery-guard — 交付门（b90dee61 案底）：合同未闭环却自称交付 = 脱离。
 *
 * 案底读数（会话 b90dee61，魔方任务）：
 *   合同 8 组 → 只落账 3 组（内核/CFOP/Roux）；渲染/拖拽/演示/单文件 4 组请求落账未过门；
 *   末组（verify=user）从未请求；terminal_check 只跑 1 次且未归零；
 *   最终消息仍写「交付完成」+ 自跑 run-all.ps1 的 8/8 表格。
 *
 * 能做的事（诚实位）：DSH 不提供拦截最终答复的钩子——所以本模块只做三件机器能做的：
 *   ① 识别「回合内出现交付声明 + 合同有未落账组」；
 *   ② 记一条 detached-delivery 教训（信誉/学习面）；
 *   ③ 下一拍注入显式阻断提示（列出未落账组 + 指路）。
 * 不假装能拦住模型写答复。
 */

/** 交付声明识别（纯函数）：模型回合内是否说了"完成/交付"。 */
const CLAIM_RE = /(交付完成|已完成交付|全部完成|任务完成|交付完毕|已交付|工作完成|done\.|all done)/i

export function hasDeliveryClaim(text) {
  return CLAIM_RE.test(String(text || ''))
}

/** 未落账组清单（纯函数）。 */
export function unsettledGroups(state) {
  return (state?.groups || []).filter((g) => g && !g.settled).map((g) => String(g.title || ''))
}

/**
 * 检测脱离交付（纯函数）。
 * @param {object} state 盘档
 * @param {{text?:string, stage?:string}} opts text=本回合模型的可见文本（含 tool 结果）
 * @returns {{detached:boolean, groups:string[], reason:string}}
 */
export function detectDetachedDelivery(state, opts = {}) {
  const groups = unsettledGroups(state)
  const stage = String(opts.stage || state?.stage || '')
  if (groups.length === 0) return { detached: false, groups: [], reason: '合同已全部落账' }
  if (stage !== 'rolling' && stage !== 'final') return { detached: false, groups, reason: `阶段=${stage}，不判脱离` }
  if (!hasDeliveryClaim(opts.text)) return { detached: false, groups, reason: '本回合无交付声明' }
  return { detached: true, groups, reason: `合同还有 ${groups.length} 组未落账，却出现交付声明` }
}

/** 下一拍注入的阻断提示（纯函数；无未落账组=空串）。 */
export function deliveryWarningText(groups) {
  const list = (Array.isArray(groups) ? groups : []).filter(Boolean)
  if (list.length === 0) return ''
  return `⏸ 交付门：合同还有 ${list.length} 组未落账（${list.slice(0, 4).join('、')}${list.length > 4 ? '…' : ''}）——` +
    `先逐组跑 optimal_converge(closeGroup:true) 或写明为什么收不了；` +
    `在 terminal_check 归零之前，不要写「交付完成」。`
}
