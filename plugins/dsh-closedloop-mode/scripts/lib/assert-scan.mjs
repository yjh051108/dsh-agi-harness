/**
 * assert-scan — 弱断言分类（v0.8.23，P2 弱杀检测的第一块地基）。
 *
 * 为什么需要：变异审计只回答「测试有没有变红」，不回答「红是因为断言了行为，还是因为只断言了真值」。
 * 本模块给出**确定性**（无 IO、无随机）的分类，供报告使用——**不接入任何硬门**（NEXT.md 已记风险：
 * `assert.ok(x)` 有时正是正确的契约断言，静态判定会误伤，所以只报告不扣分）。
 *
 * 三档口径（判据全部来自表达式文本本身，可逐条复算）：
 *   strong  = 含比较/逻辑/取反/量词（=== !== <= >= < > && || ! 前缀 .includes( .match( .has( .length .size .test(）
 *   weak    = 裸标识或成员链（x / r.ok / s.groups[0].settled）——只证明「真值」，不证明值
 *   unknown = 其余（函数调用/模板/解构等，静态判不了）
 */

export const STRONG_MARKS = ['===', '!==', '<=', '>=', '&&', '||', '.includes(', '.match(', '.has(', '.length', '.size', '.test(', '.some(', '.every(', '.endsWith(', '.startsWith(']

/** 分类单个表达式文本。 */
export function classifyExpression(expr) {
  const e = String(expr || '').trim()
  if (!e) return 'unknown'
  // 取反断言（!x / !r.ok）也算强：它断言的是「假」这一具体性质
  if (/^!/.test(e)) return 'strong'
  for (const m of STRONG_MARKS) if (e.includes(m)) return 'strong'
  if (/[<>]/.test(e) && !/=>/.test(e)) return 'strong'
  // 裸标识 / 成员链 / 下标链（可含字符串下标与数字下标）
  if (/^[A-Za-z_$][\w$]*(?:\??\.\w+|\?\.\[[^\]]+\]|\[[^\]]+\])*$/.test(e)) return 'weak'
  return 'unknown'
}

/** 从源码里抽出 assert.ok(...) / assert(...) 的实参（括号配平；跳过字符串与注释）。 */
export function extractAssertArgs(text) {
  const src = String(text || '')
  const out = []
  const re = /(?:^|[^\w.])(?:assert\.ok|assert\.truthy|assert)\(/g
  let m
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length, depth = 1, q = null, arg = ''
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i]
      if (q) {
        arg += ch
        if (ch === '\\') { arg += src[++i] || ''; continue }
        if (ch === q) q = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; arg += ch; continue }
      if (ch === '(') depth++
      if (ch === ')') { depth--; if (!depth) break }
      arg += ch
    }
    out.push(arg.trim())
  }
  return out
}

/** 扫描一段测试源码：{total, strong, weak, unknown, weakList, ratio}（ratio=weak/total，四舍五入 3 位）。 */
export function scanAssertions(text) {
  const args = extractAssertArgs(text)
  const weakList = [], strongList = [], unknownList = []
  for (const a of args) {
    const k = classifyExpression(a)
    if (k === 'weak') weakList.push(a)
    else if (k === 'strong') strongList.push(a)
    else unknownList.push(a)
  }
  const total = args.length
  return { total, strong: strongList.length, weak: weakList.length, unknown: unknownList.length, weakList, strongList, unknownList, ratio: total ? +(weakList.length / total).toFixed(3) : null }
}

/** 聚合多文件扫描：{ files: [{file, ...scan}], totals: {total, weak, ratio}, worst: [{file, ratio, weak, total}] }。 */
export function weakReport(files) {
  const rows = (files || []).map((f) => ({ file: f.file, ...scanAssertions(f.text) }))
  const total = rows.reduce((s, r) => s + r.total, 0)
  const weak = rows.reduce((s, r) => s + r.weak, 0)
  const worst = rows.filter((r) => r.weak > 0).sort((a, b) => b.ratio - a.ratio || b.weak - a.weak).map((r) => ({ file: r.file, ratio: r.ratio, weak: r.weak, total: r.total }))
  return { files: rows, totals: { total, weak, ratio: total ? +(weak / total).toFixed(3) : null }, worst }
}
