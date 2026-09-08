/**
 * ledger-stats — 变异账本统计纯函数（v0.8.22）。
 * 为什么独立成模块：审计脚本（scripts/mutation-audit.mjs）顶层有副作用（建沙箱、跑测试），
 * 不可被单测 import；把**判定与统计**抽出来，账本口径就能被合成数据单测。
 * 口径（与审计 summary 一致，单一真相）：counted = 未跳过 ∧ 语法有效 ∧ 非等价；killRate = killed/counted。
 */

/** 参与计分的账本行（跳过项/语法无效/等价变异不入分母）。 */
export function countedOf(ledger) {
  return (ledger || []).filter((x) => x && !x.skipped && x.syntaxOk !== false && !x.equivalent)
}

/** 杀死率（无计分行=null，不假装 0 或 1）。 */
export function killRateOf(ledger) {
  const c = countedOf(ledger)
  if (!c.length) return null
  return +(c.filter((x) => x.killed).length / c.length).toFixed(3)
}

/** 归因：目标文件 → { 测试文件: 杀死计数 }（只统计**被杀**的变异——幸存/等价不计入）。
 *  killedBy 缺失（旧账本）时从 note 里不猜，记为 '未知'。 */
export function attributionOf(ledger) {
  const out = {}
  for (const x of ledger || []) {
    if (!x || x.skipped || x.syntaxOk === false || !x.killed) continue
    const by = Array.isArray(x.killedBy) && x.killedBy.length ? x.killedBy : ['未知']
    out[x.file] = out[x.file] || {}
    for (const t of by) out[x.file][t] = (out[x.file][t] || 0) + 1
  }
  return out
}

/** 汇总：计分数/杀死/幸存/等价/杀死率 + 归因 + 单杀者（只被一个测试文件杀死的变异清单——最脆弱的守护点）。 */
export function summarizeLedger(ledger) {
  const c = countedOf(ledger)
  const killed = c.filter((x) => x.killed)
  const survived = c.filter((x) => !x.killed)
  const singleKiller = killed
    .filter((x) => Array.isArray(x.killedBy) && x.killedBy.length === 1)
    .map((x) => `${x.file} ${x.kind} ${x.from}→${x.to}（仅 ${x.killedBy[0]}）`)
  return {
    counted: c.length,
    killed: killed.length,
    survived: survived.length,
    equivalent: (ledger || []).filter((x) => x && x.equivalent).length,
    killRate: killRateOf(ledger),
    attribution: attributionOf(ledger),
    singleKiller,
  }
}
