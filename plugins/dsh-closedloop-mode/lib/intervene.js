/**
 * intervene — 介入率口径（v0.8.27）。
 *
 * 案底（用户质询直查）：旧口径 = 「24h 窗口内真人帧数 ÷ 24h 窗口内闭合步数」，
 * 分子**不判断该帧是否落在某个未闭合步的窗口内**——设计讨论、闲聊、早期环未开时的对话全算成「介入」。
 * 实测本会话 114 真人帧里只有 38 帧落在「声明→闭合/下一步」窗口内 → 旧口径高估约 3 倍。
 *
 * 本模块给出**在岗介入率**：分子只数落在未闭合步窗口内的真人帧（=人被迫下场救火的那类），
 * 分母仍是栈档闭合步。旧口径保留（面板兼容 + 历史可比性），两口径并列呈现，基线不可比写进 caveat。
 *
 * 纯函数：无 IO、无时钟依赖（cut 由调用方传入）——可合成数据单测。
 */

/** 帧分类（与旧脚本同口径，单一真相）：goal 自动续单/plugin 注入/agent-instructions 一律不算人。
 *  返回 'human' | 'goal' | 'plugin' | 'agent-instructions' | 'other'。 */
export function classifyFrameSource(source) {
  const s = source && typeof source === 'object' ? source : {}
  if (s.goalId) return 'goal'
  if (s.kind === 'agent-instructions') return 'agent-instructions'
  if (s.plugin) return 'plugin'
  if (s.kind === 'user' && s.rpcId) return 'human'
  return 'other'
}

/** 步窗口（声明→闭合；无闭合记录=到下一步声明；末步无闭合=Infinity）。
 *  steps: [{at, title}]（按 at 升序）；closedAt: {title: 闭合时间}。 */
export function workWindows(steps, closedAt = {}) {
  const arr = (steps || []).filter((s) => s && typeof s.at === 'number').slice().sort((a, b) => a.at - b.at)
  return arr.map((s, i) => {
    const end = (typeof closedAt[s.title] === 'number' ? closedAt[s.title] : (arr[i + 1] ? arr[i + 1].at : Infinity))
    return { from: s.at, to: Math.max(end, s.at), title: s.title }
  })
}

/** 时间点是否落在任一窗口内。 */
export function inAnyWindow(t, windows) {
  for (const w of windows || []) if (t >= w.from && t < w.to) return true
  return false
}

/** 双口径介入率。
 *  @param frames 真人帧时间戳数组（调用方已按 classifyFrameSource 过滤）
 *  @param steps  步数组 [{at,title,status}]
 *  @param closedAt {title: 闭合时间}
 *  @param cut    24h 窗口起点（毫秒）；缺省=不过滤
 *  @returns {humans, humansOnDuty, gap, closed, rate, rateOnDuty, onDutyShare} */
export function interveneMetrics({ frames = [], steps = [], closedAt = {}, cut = null } = {}) {
  const win = workWindows(steps, closedAt)
  const fs = (frames || []).filter((t) => typeof t === 'number')
  const f24 = cut == null ? fs : fs.filter((t) => t >= cut)
  const onDuty24 = f24.filter((t) => inAnyWindow(t, win)).length
  const steps24 = cut == null ? (steps || []) : (steps || []).filter((s) => s && typeof s.at === 'number' && s.at >= cut)
  const closed = steps24.filter((s) => s && s.status === 'closed').length
  const r = (n) => (closed > 0 ? +(n / closed).toFixed(2) : null)
  return {
    humans: f24.length,
    humansOnDuty: onDuty24,
    gap: f24.length - onDuty24,
    closed,
    rate: r(f24.length),          // 旧口径（窗口内真人帧 ÷ 闭合步）
    rateOnDuty: r(onDuty24),      // 新口径（在岗介入率）
    onDutyShare: f24.length ? +(onDuty24 / f24.length).toFixed(2) : null,
  }
}
