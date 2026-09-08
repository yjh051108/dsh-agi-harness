/**
 * mutation-ops.mjs — 变异算子库（v2）
 *
 * v1 只有三类（比较符/布尔/字符串常量）且不查语法有效性——语法错的突变必被"杀死"，虚高分数。
 * v2 扩到九类，并把"语法无效的突变不入账"作为硬门（由审计器执行 node --check）。
 *
 * 算子按"意图边界"设计，不按语法糖：
 *   比较符翻转 / 逻辑符翻转 / 布尔翻转 / 数字 ±1 / return 常量翻转 /
 *   条件取反 / filter→map / .length+1 / 去 await
 */
export const OPS_VERSION = 'v2'

export const OPERATOR_KINDS = [
  'flip-cmp', 'flip-logic', 'flip-bool', 'num-plus1', 'return-const',
  'negate-cond', 'filter-map', 'length-plus1', 'drop-await',
]

const isComment = (src, idx) => {
  const s = src.lastIndexOf('\n', idx - 1) + 1
  const e = src.indexOf('\n', idx)
  const line = src.slice(s, e < 0 ? src.length : e)
  return /^\s*(\/\/|\*|\/\*)/.test(line)
}
const lineAt = (src, idx) => {
  const s = src.lastIndexOf('\n', idx - 1) + 1
  const e = src.indexOf('\n', idx)
  return src.slice(s, e < 0 ? src.length : e).trim().slice(0, 96)
}

/** 在 src 中找 pattern 的命中点，生成 {kind, at, len, from, to, line}；跳过注释行。 */
function sites(src, kind, re, repl, perKind) {
  const res = []
  let n = 0
  for (const m of src.matchAll(re)) {
    if (n >= perKind) break
    if (isComment(src, m.index)) continue
    const to = typeof repl === 'function' ? repl(m) : repl
    if (to == null || to === m[0]) continue
    res.push({ kind, at: m.index, len: m[0].length, from: m[0], to, line: lineAt(src, m.index) })
    n++
  }
  return res
}

const CMP = { '!==': '===', '===': '!==', '<=': '<', '>=': '>' }
const RET = { true: 'return false', false: 'return true', null: 'return undefined', undefined: 'return null' }

const OPS = [
  (s, k) => sites(s, 'flip-cmp', /!==|===|<=|>=/g, (m) => CMP[m[0]], k),
  (s, k) => sites(s, 'flip-logic', /&&|\|\|/g, (m) => (m[0] === '&&' ? '||' : '&&'), k),
  (s, k) => sites(s, 'flip-bool', /\btrue\b|\bfalse\b/g, (m) => (m[0] === 'true' ? 'false' : 'true'), k),
  (s, k) => sites(s, 'num-plus1', /\b(\d{1,4})\b/g, (m) => String(Number(m[1]) + 1), k),
  (s, k) => sites(s, 'return-const', /return (true|false|null|undefined)\b/g, (m) => RET[m[1]], k),
  (s, k) => sites(s, 'negate-cond', /if \(([^()\n]{1,80})\)/g, (m) => `if (!(${m[1]}))`, k),
  (s, k) => sites(s, 'filter-map', /\.filter\(/g, '.map(', k),
  (s, k) => sites(s, 'length-plus1', /\.length\b/g, '.length + 1', k),
  (s, k) => sites(s, 'drop-await', /await /g, '', k),
]

/** 派生突变集（跨算子去重）。perKind=每类最多取几处。 */
export function deriveMutations(src, { perKind = 2 } = {}) {
  const out = []
  for (const op of OPS) {
    for (const m of op(src, perKind)) {
      if (!out.some((x) => x.at === m.at && x.to === m.to)) out.push(m)
    }
  }
  return out
}

/** 应用单个突变（纯函数，原文可无损还原）。 */
export function applyMutation(src, m) {
  return src.slice(0, m.at) + m.to + src.slice(m.at + m.len)
}

/** 反向还原（审计器与测试用：确认突变可逆）。 */
export function revertMutation(mutated, m) {
  const at = m.at
  if (mutated.slice(at, at + m.to.length) !== m.to) return null
  return mutated.slice(0, at) + m.from + mutated.slice(at + m.to.length)
}
