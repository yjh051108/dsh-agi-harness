/**
 * debt-ledger — v0.8.36 欠世界的债：把「猜」变成债，把「向世界要」变成唯一还债通路。
 *
 * 案底（session-0b6ea232，6.5h / 137M token）：69 条预测里 17 条建立在 prior（猜）上；
 * 向外界索取 0 次（web_search / engram_recall / dev_plugin_status 全 0）；自造 63 个文件
 * （13 个 verify 套件 + 20 个一次性 scratch 探针 + 自写 CDP 驱动）——57% 的算力用来造器官。
 * 根因不是「不会查」，是**后果结构里没有「猜」的代价**：造东西有进度，向世界要有零反馈。
 *
 * 本模块给出机械后果（不是提示）：
 *  ① 任何建立在非实证来源上的断言 = 一笔 open 债；
 *  ② 猜错 → escalated：**同一 claimKey 的下一次声明必须带实证来源，否则直拒**（第一次猜可以，猜错后不许再猜）；
 *  ③ 吻合或带实证来源 → discharged；
 *  ④ 已清偿后重新猜 → 直接 escalated（你问过世界了，别再猜）。
 * 触发条件是 claimKey（任何断言的归一化身份），不是情境清单——所以对浏览器、GPU、字体、物理库一律成立。
 *
 * 纪律：纯函数、无 IO、无时钟（时间由调用方传入）；不产生任何面向模型的文案，只产生账与拒。
 */

/** 还债路径优先级（便宜优先）——拿来主义的机械形式：能记就记，能借就借，最后才自己测。 */
export const REPAY_ORDER = ['engram', 'web', 'plugin', 'npm', 'probe', 'read']
const RANK = { engram: 4, web: 3, plugin: 3, npm: 3, probe: 2, read: 2, prior: 1 }

/** 断言的归一化身份：大小写/空白/常见标点无关，长度截断（同一件事的不同措辞归一到同一笔债）。 */
export function claimKey(key) {
  return String(key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[`"'，。；：、（）()[\]【】{}「」『』=]/g, '')
    .replace(/\s+/g, '')
    .slice(0, 48)
}

/** 来源形态（与 optimal-engine 的四形态同一真相，另加 web/plugin/npm 三种「向世界要」的形态）。 */
export function sourceKind(source) {
  const s = String(source ?? '').trim()
  if (!s) return 'none'
  const m = /^([a-z]+):/i.exec(s)
  if (!m) return 'freetext'
  const k = m[1].toLowerCase()
  return ['read', 'probe', 'engram', 'web', 'plugin', 'npm', 'prior'].includes(k) ? k : 'freetext'
}

/** 实证来源=绑定到「拿到的东西」；prior/freetext/none = 猜。 */
export function isEvidential(source) {
  return ['read', 'probe', 'engram', 'web', 'plugin', 'npm'].includes(sourceKind(source))
}

export function sourceRank(source) { return RANK[sourceKind(source)] ?? 0 }

/** 登记债务：非实证来源 → 新债 / 重开 / 保持；返回新账（不改原数组）。 */
export function recordDebts(debts, predictions = [], step = null) {
  const out = (Array.isArray(debts) ? debts : []).map((d) => ({ ...d }))
  for (const p of (Array.isArray(predictions) ? predictions : [])) {
    if (isEvidential(p && p.source)) continue
    const k = claimKey(p && p.key)
    if (!k) continue
    const cur = out.find((d) => d.claimKey === k)
    if (cur) {
      cur.misses = (cur.misses || 0) + 1
      // 已清偿过还再猜 = 直接升级（世界已经答过一次）
      cur.state = cur.state === 'discharged' ? 'escalated' : (cur.state === 'escalated' ? 'escalated' : 'open')
      if (cur.state === 'escalated') cur.everEscalated = true
      cur.at = step != null ? step : cur.at
      continue
    }
    out.push({ claimKey: k, key: String(p?.key ?? '').slice(0, 80), claim: String(p?.value ?? '').slice(0, 120), at: step, state: 'open', misses: 0, hits: 0, by: null })
  }
  return out
}

/** 升级：猜错（预言失配）→ 这笔债只能用世界还。everEscalated 留痕（清偿后仍可查）。 */
export function escalateDebts(debts, keys = []) {
  const set = new Set((Array.isArray(keys) ? keys : []).map(claimKey))
  return (Array.isArray(debts) ? debts : []).map((d) => (set.has(d.claimKey) && d.state !== 'discharged' ? { ...d, state: 'escalated', everEscalated: true } : { ...d }))
}

/** 清偿：吻合（by='measure'）或带实证来源（by=<kind>）→ 这笔债消。 */
export function dischargeDebts(debts, keys = [], by = 'measure') {
  const set = new Set((Array.isArray(keys) ? keys : []).map(claimKey))
  return (Array.isArray(debts) ? debts : []).map((d) => (set.has(d.claimKey) ? { ...d, state: 'discharged', by, hits: (d.hits || 0) + 1 } : { ...d }))
}

/** 未清偿的债（open + escalated）。 */
export function openDebts(debts) {
  return (Array.isArray(debts) ? debts : []).filter((d) => d && d.state !== 'discharged')
}

/** 只能靠世界还的债。 */
export function worldDebts(debts) {
  return (Array.isArray(debts) ? debts : []).filter((d) => d && d.state === 'escalated')
}

/** 债闸：待声明的预测里，若有 claimKey 已升级且来源非实证 → 拒（第一次猜放行）。 */
export function refuseGuess(debts, predictions = []) {
  const world = new Set(worldDebts(debts).map((d) => d.claimKey))
  const items = []
  for (const p of (Array.isArray(predictions) ? predictions : [])) {
    if (isEvidential(p && p.source)) continue
    const k = claimKey(p && p.key)
    if (k && world.has(k)) items.push({ claimKey: k, key: String(p?.key ?? '') })
  }
  return { refuse: items.length > 0, items }
}

/** 一行读数（无债=空串，零注入）。 */
export function debtLine(debts) {
  const open = openDebts(debts)
  if (!open.length) return ''
  const esc = open.filter((d) => d.state === 'escalated').length
  return `⏳ 欠世界 ${open.length} 笔${esc ? `（已升级 ${esc}：只能用世界还）` : ''}——还债优先级 ${REPAY_ORDER.slice(0, 4).join(' > ')}`
}

/** 按来源形态给最便宜的还法（供拒绝语用；不产生建议文案，只给路径）。 */
export function cheapestRepay() { return REPAY_ORDER.join(' > ') }
