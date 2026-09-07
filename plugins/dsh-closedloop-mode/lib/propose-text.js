/**
 * propose-text — v0.3 执行阶段最小状态面（THEORY-v0.3 §2 Propose；BENCH §3 预登记目标）。
 *
 * 教育=违规事件原则：本模块**只做展示**——一切判定条款住在 optimal-engine 的拒绝文本里
 * （编译器报错即教学，不开机前讲课）。stateFace 是纯函数：同入参逐字节等，零时钟零随机。
 * 输入=mode-state.controlSurface(state)（合同阶段合同+演进量直读），输出 ≤ FACE_BUDGET 字节。
 */

export const FACE_BUDGET = 1333 // UTF-8 字节上限 = v0.2 注入基线 3.9KB/块（FIT-plant P 场实测）× 1/3

const cut = (s, n) => {
  const x = String(s || '')
  return x.length > n ? x.slice(0, n) + '…' : x
}

/** 四元驻留面（v0.6.28 任务语版）：分组进度 / 完成条件 / 最近完成 / 下一步指引。
 *  架构词（残差/Q_N/cost-to-go/档/dip/severity 括注）住拉取面（工具回执/盘档/文档），不住推送面。 */
export function stateFace(surface) {
  const s = surface || {}
  const r = s.residual || {}
  const qn = s.cost || {}
  const groups = (s.groups || []).filter(Boolean)
  const settledN = groups.filter((g) => g.settled).length
  const openGs = groups.filter((g) => !g.settled).map((g) => cut(g.title, 12))
  const lines = []
  lines.push(`【闭环·进行中】分组任务：${groups.length ? `${settledN}/${groups.length} 完成` : '未分组'}${openGs.length ? `（还差：${openGs.join('、')}）` : ''}；小步已闭环 ${r.closedCount || 0}。`)
  if (s.reviewNote) lines.push(`📌 用户补充（确认弹窗随附）：${cut(s.reviewNote, 120)}`)
  const as = (qn.assertions || []).map((a) => cut(a?.text, 30)).filter(Boolean)
  if (as.length) lines.push(`完成条件（${as.length} 条）：${as.join('｜')}`)
  const cs = (s.closed || []).map((c) => String(c?.title || '')).filter(Boolean)
  if (cs.length) lines.push(`最近完成：${cs.slice(-4).map((t) => cut(t, 16)).join('、')}${cs.length > 4 ? ` 等${cs.length}项` : ''}`)
  lines.push('▸ 下一步：挑最有价值的一件事——用 optimal_declare 声明（预期什么数字、怎么验证），通过后自由实现。不提前排长计划。')
  return lines.join('\n')
}

/** 步提醒行（成长导向）：做完交对账 / 发现偏差→调整再试。 */
export function stepReminder(top) {
  const t = top || {}
  const name = `${t.n || '?'}.${cut(t.title, 20)}`
  if (t.status === 'open') return `当前步「${name}」——完成后用 optimal_converge 记录你的实测结果，然后开启下一步。`
  return `「${cut(t.title, 20)}」预测与实测有偏差——用 optimal_rollback 记下学到了什么，然后重新声明。这是成长，不是失败。`
}

/** v0.8.3 批确认诚实行（实测案底 aa1c164e：A7v–A11v 连续 5 步 at→at 全是「核验/收尾」名目——
 *  一大步做完后批量贴确认章。只报事实，不替模型选、不拦：把「我在批量确认」摆到台面上）。 */
export function batchConfirmLine(stack) {
  const closed = (stack?.steps || []).filter((s) => s?.status === 'closed')
  if (closed.length < 3) return ''
  let keep = 0
  for (let i = closed.length - 1; i >= 0; i--) {
    const dv = closed[i]?.dv
    if (dv && dv.before === 'at' && dv.after === 'at') { keep++; continue }
    break
  }
  if (keep < 3) return ''
  return `⚑ 本单已连续 ${keep} 步 at→at（多为收尾/核验名目）——若对应的是同一实现的批量确认，考虑合并收敛而非逐步贴标签；若确为独立增量，忽略本行即可。`
}

/** 合同锁定态回执（weights 态最小面：待确认的主权提示，人话版 v0.6.31）。 */
export function weightsFace(surface) {
  const s = surface || {}
  const qn = s.cost || {}
  const n = (qn.assertions || []).length
  const critical = (qn.assertions || []).filter((a) => a?.severity === 'catastrophic').length
  return [`【合同已锁待确认】完成条件 ${n} 条${critical ? `（其中关键 ${critical} 条）` : ''}· 分组 ${(s.groups || []).length} · 不做的事 ${(qn.nonGoals || []).length} 项`,
    '确认=settings.autoConfirm 直认（最高优先，不弹窗）；否则弹窗点选（可多选并附补充意见）；文本『确认』为无 UI 回退通道。'].join('\n')
}

/**
 * v0.4.6 蒸馏草稿（环铸记忆的引擎侧——terminal 归零时机械生成，模型誊写 engram_propose）。
 * R15 分工：引擎起草（数据全在盘，机械可算的部分不需要智能）、模型手写（记忆主权在人侧确认制）、
 * 观测者不代写（不直接入图）。纯函数零副作用，≤500B。
 */
export function distillDraft(s, stack) {
  const closed = (s && s.closed) || []
  if (closed.length === 0) return null
  const rb = (stack && Array.isArray(stack.rolledBack)) ? stack.rolledBack : []
  const vs = closed.filter((c) => typeof c.v === 'number').map((c) => c.v)
  const title = cut(String(s.cost && s.cost.purpose || closed[closed.length - 1].title || '单').split(/[，。；,;]/)[0], 12)
  const summary = `闭合${closed.length}·回炉${rb.length}·V${vs.length ? vs[0] + '→' + vs[vs.length - 1] : '无读数'}`
  const attr = rb.slice(0, 4).map((r) => cut(String(r.reason || '').slice(0, 36), 36)).join(' / ')
  const content = `归因史：${attr || '无'}；已闭：${closed.map((c) => cut(c.title, 12)).join('、')}；证据链：graded-state/session 盘档（closedloop+optimal 双档）`
  return `🧪 蒸馏草稿（engram_propose 誊写入图·确认制，R15 观测者不代写）\ntitle: ${title}\nsummary: ${summary}\ncontent: ${content}\nlayer: project | kind: event`
}
