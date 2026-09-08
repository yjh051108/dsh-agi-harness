/**
 * falsify — v0.8.30 判据可证伪门 · 纯函数层（负对照生成 + 判定）
 *
 * 治的病（用户定向 2026-09-08，案卷 session-1f8c4faa/池核）：
 *   合同的 11 条断言全部由 `node check.mjs --gN` 这类**文本 grep**判定，而 check.mjs 是被审者
 *   自己在第一步写的。实测：把判据源码里的 48 个字面量拼成 **483 字节**的壳，33 组判据全绿
 *   （`[check:all] PASS exit=0`）。即「判据可被满足，而目标未被满足」——判据空转。
 *
 * 不变量（只有这一条，不点任何具体 token 名，因此不可能是针对性补丁）：
 *   **判据必须能对"假货"说不。** 把被审者写入面的产物替换成负对照再跑判据；
 *   判据若照样绿，这条判据就是空的，不许进合同、不许落账。
 *
 * 三态负对照（同尺寸，防体积门造成的"假敏感"）：
 *   empty   掏空版：零字节
 *   literal 字面壳版：判据命令 + 判据脚本源码里的**全部**字符串字面量，补到与原产物同字节
 *   inert   空转版：结构合法（按扩展名给最小骨架）但不做任何事，同字节
 *
 * 为什么字面壳要"过近似"：负对照必须含判据可能去找的全部字面量，宁可多不可漏——
 *   漏一个 = 判据看起来敏感（其实空转），比误判空转更坏。
 *
 * 本层零副作用：不读写文件（selectArtifacts 的探针可注入，默认 defaultProbe 只 stat 不修改）。
 * 真变异/还原在 runFalsifyGate（G2 执行层）。
 */

import { dirname, extname, resolve } from 'node:path'
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'

/** 二进制/不可文本替换的扩展名（变异它们无意义） */
export const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ico', '.svgz',
  '.zip', '.gz', '.tgz', '.7z', '.rar', '.tar', '.zst',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.mov', '.webm', '.avi',
  '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.exe', '.dll', '.node', '.so', '.dylib',
])

export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
export const MAX_ARTIFACTS = 20

/** 按扩展名给"结构合法但空转"的骨架（inert 负对照用） */
const INERT_HEAD = {
  '.mjs': 'export {}\n',
  '.js': 'export {}\n',
  '.cjs': 'module.exports = {}\n',
  '.ts': 'export {}\n',
  '.json': '{}\n',
  '.html': '<!DOCTYPE html>\n',
  '.htm': '<!DOCTYPE html>\n',
  '.py': 'pass\n',
  '.sh': 'exit 0\n',
  '.yml': '',
  '.yaml': '',
  '.md': '',
  '.txt': '',
  '.css': '',
}

/**
 * 抽取源码里的字符串字面量（单/双/反引号）。
 * 语义刻意与"文本 grep 判据"的取材面一致（含注释/正则里出现的引号对）——过近似，宁多勿漏。
 * @param {string} src
 * @param {{min?:number, cap?:number}} [opts] min=最小长度（默认 2，单字符无判别力）；cap=最多返回条数（0=不限）
 * @returns {string[]} 去重、保持出现顺序
 */
export function extractLiterals(src, opts = {}) {
  const min = Number.isFinite(opts.min) ? opts.min : 2
  const cap = Number.isFinite(opts.cap) ? opts.cap : 0
  const s = String(src ?? '')
  const out = []
  const seen = new Set()
  for (let i = 0; i < s.length; i++) {
    const q = s[i]
    if (q !== "'" && q !== '"' && q !== '`') continue
    let j = i + 1
    let buf = ''
    let closed = false
    for (; j < s.length; j++) {
      const c = s[j]
      if (c === '\\') { buf += c + (s[j + 1] ?? ''); j++; continue }
      if (c === q) { closed = true; break }
      if (c === '\n' && q !== '`') break // 单/双引号不跨行
      buf += c
    }
    if (!closed) continue
    i = j
    if (buf.length < min || seen.has(buf)) continue
    seen.add(buf)
    out.push(buf)
    if (cap > 0 && out.length >= cap) break
  }
  return out
}

/** 把文本补齐/截断到恰好 size 字节（补空格 0x20） */
export function fitBytes(text, size) {
  const n = Math.max(0, Math.floor(Number(size) || 0))
  const buf = Buffer.from(String(text ?? ''), 'utf8')
  if (buf.length === n) return buf
  if (buf.length > n) return buf.subarray(0, n)
  return Buffer.concat([buf, Buffer.alloc(n - buf.length, 0x20)])
}

/** 掏空版：零字节 */
export function emptyStub() { return Buffer.alloc(0) }

/**
 * 字面壳版：判据取材面的全部字面量拼起来，补到与原产物同字节。
 * 若字面量总量已超过原尺寸，则不截断（宁可更大——体积下限类判据也不能因此拒收）。
 */
export function literalStub(literals, size) {
  const list = Array.isArray(literals) ? literals : []
  const body = list.join('\n')
  const buf = Buffer.from(body, 'utf8')
  const n = Math.max(0, Math.floor(Number(size) || 0))
  if (buf.length >= n) return buf
  return Buffer.concat([buf, Buffer.alloc(n - buf.length, 0x20)])
}

/** 空转版：按扩展名给最小骨架，补到与原产物同字节 */
export function inertStub(size, ext = '') {
  const head = INERT_HEAD[String(ext || '').toLowerCase()] ?? ''
  return fitBytes(head, size)
}

/** 默认探针：只 stat，不读内容、不修改 */
export function defaultProbe(p) {
  try {
    const st = statSync(p)
    return { exists: true, isFile: st.isFile(), size: st.size }
  } catch { return { exists: false, isFile: false, size: 0 } }
}

/** 运行时/外壳名（命令行里第一个脚本文件才是判据，运行时本身不是） */
const RUNTIMES = new Set([
  'node', 'node.exe', 'python', 'python.exe', 'python3', 'python3.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'bash', 'sh', 'deno', 'bun', 'cmd', 'cmd.exe',
])
const SCRIPT_EXT = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.cts', '.py', '.sh', '.ps1', '.bat', '.cmd'])

/**
 * 判据脚本（被执行的那支程序）：命令行里第一个"存在的脚本文件"。
 * 它不能被自己变异——那测的是判据本身，不是产物。
 * 兼容引擎的零转义形态 `execFile:node|D:/x.mjs|arg`。
 */
export function judgePath(cmd, cwd = process.cwd(), probe = defaultProbe) {
  const tokens = String(cmd ?? '').split(/[|\s]+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ''))
    .filter(Boolean)
  for (const t of tokens) {
    if (t.startsWith('-')) continue
    const low = t.toLowerCase().replace(/\\/g, '/')
    const base = low.split('/').pop()
    if (RUNTIMES.has(low) || RUNTIMES.has(base)) continue
    if (!SCRIPT_EXT.has(extname(low))) continue
    const p = resolve(cwd, t)
    if (probe(p)?.isFile) return p
  }
  return ''
}

/**
 * 产物集：**判据可达文件集**（本地 import 闭包 + 判据源码里的路径字面量，限工作区内）
 * ∪ 写入面，减去判据脚本自身，再过滤存在/文本/体积。
 *
 * v0.8.32 修门自身假阳性（自测案底）：旧口径只收「本会话写入面」，于是**自包含判据**
 * （自带 fixture、只 import 被测模块的脚本，如 scripts/check-falsify.mjs）永远绿——
 * 伪造别的文件不影响它，被判「空转」。正确定义是「判据的判定真正依赖谁，就伪造谁」。
 * @param {{cmd?:string, writeSet?:string[], cwd?:string, probe?:Function, extra?:string[]}} args
 * @returns {string[]} 绝对路径
 */
export function selectArtifacts(args = {}) {
  const cmd = String(args.cmd ?? '')
  const cwd = String(args.cwd ?? process.cwd())
  const probe = typeof args.probe === 'function' ? args.probe : defaultProbe
  const judge = judgePath(cmd, cwd, probe)
  const judgeKey = judge.replace(/\\/g, '/').toLowerCase()
  const out = []
  const seen = new Set()
  const push = (p) => {
    const key = p.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) return
    if (judgeKey && key === judgeKey) return
    if (BINARY_EXT.has(extname(p).toLowerCase())) return
    const info = probe(p)
    if (!info || !info.isFile) return
    if (info.size > MAX_ARTIFACT_BYTES) return
    seen.add(key)
    out.push(p)
  }
  for (const raw of (Array.isArray(args.extra) ? args.extra : [])) push(resolve(cwd, String(raw)))
  for (const raw of (Array.isArray(args.writeSet) ? args.writeSet : [])) {
    if (out.length >= MAX_ARTIFACTS) break
    push(resolve(cwd, String(raw)))
  }
  return out.slice(0, MAX_ARTIFACTS)
}

/** 判据可达文件集：从判据脚本出发，走本地相对/绝对 import 与源码里的路径字面量。
 *  深度上限 3（判据→被测模块→其依赖），路径字面量限**工作区内**（不碰工作区外的用户文件）。 */
export function reachableFiles(entry, opts = {}) {
  const cwd = String(opts.cwd ?? process.cwd())
  const probe = typeof opts.probe === 'function' ? opts.probe : defaultProbe
  const readFile = typeof opts.readFile === 'function' ? opts.readFile : defaultReadFile
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 3
  const out = []
  const seen = new Set()
  const norm = (p) => p.replace(/\\/g, '/').toLowerCase()
  const inCwd = (p) => norm(resolve(p)).startsWith(norm(resolve(cwd)))
  const walk = (file, depth) => {
    if (depth > maxDepth || seen.has(norm(file))) return
    seen.add(norm(file))
    let src = ''
    try { src = String(readFile(file)) } catch { return }
    const specs = []
    const re = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g
    let m
    while ((m = re.exec(src))) specs.push(m[1])
    for (const lit of extractLiterals(src)) if (/[\\/]/.test(lit) && /\.[a-z0-9]{1,6}$/i.test(lit)) specs.push(lit)
    for (const spec of specs) {
      let p = ''
      if (/^\.{1,2}[\\/]/.test(spec)) p = resolve(dirname(file), spec)
      else if (/^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('/')) p = resolve(spec)
      else continue
      if (!inCwd(p)) continue
      if (!probe(p)?.isFile) continue
      if (!out.includes(p)) out.push(p)
      walk(p, depth + 1)
    }
  }
  walk(resolve(cwd, entry), 0)
  return out
}

/**
 * 判定（纯函数）：负对照的绿/红 → 判据是否可证伪。
 * @param {{kind:string, state:'green'|'red'|'broken'}[]} runs 每条负对照上判据的结局
 * @param {string[]} artifacts 参与变异的产物
 * @returns {{verdict:'vacuous'|'sensitive'|'no-artifact'|'unproven', reason:string}}
 */
export function falsifyVerdict(runs = [], artifacts = []) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return {
      verdict: 'no-artifact',
      reason: '写入面里没有该判据判定的产物——无法用负对照证伪（换行为型判据、让判据指向真实产物，或改挂人判）',
    }
  }
  const rs = Array.isArray(runs) ? runs : []
  const REASON = {
    literal: '字面壳版负对照仍绿——判据被字符串本身满足（判据空转）',
    anchored: '锚定壳版负对照仍绿——判据只认产物里本来就有的字符串（判据空转）',
    inert: '空转版负对照仍绿——判据不依赖产物行为（判据空转）',
    empty: '掏空版负对照仍绿——判据不依赖产物存在（判据空转）',
  }
  const hit = rs.find((r) => r && r.state === 'green')
  if (hit) return { verdict: 'vacuous', reason: REASON[hit.kind] || `${hit.kind} 版负对照仍绿——判据空转` }
  const red = rs.filter((r) => r && r.state === 'red').length
  if (red === 0) {
    return { verdict: 'unproven', reason: '全部负对照跑不了（broken）——敏感性未判定，按未验证处理（≠通过）' }
  }
  return { verdict: 'sensitive', reason: '负对照全被拒——判据对产物敏感' }
}

/* ============================ 执行层（变异 → 真跑 → 还原） ============================ */

/** 负对照种类（默认两态：判据词汇壳 + 空转壳） */
export const CONTROLS = ['literal', 'inert']

/**
 * 落账门用三态：加「锚定壳」。
 * 为什么需要它（池核案实测）：判据源码里的字面量并不都是**正向要求**——check.mjs 里
 * `txt.includes('TODO')` 是反向检查，把 'TODO' 拼进字面壳反而让判据红，判据就被误判成"敏感"。
 * 锚定壳只取「真实产物里本来就出现的判据字面量」=判据的正向要求集，既排除反向字面量，
 * 又不掺入判据自己的词汇，是比字面壳更干净的"文本可满足性"探针。
 */
export const CONTROLS_FULL = ['literal', 'anchored', 'inert']

/** 锚定字面量：判据词汇 ∩ 真实产物文本 */
export function anchoredLiterals(literals, text) {
  const t = String(text ?? '')
  return (Array.isArray(literals) ? literals : []).filter((l) => t.includes(l))
}

/** 按种类给假货内容（同尺寸；literal 过近似不截断） */
export function stubFor(kind, literals, size, ext = '') {
  if (kind === 'empty') return emptyStub()
  if (kind === 'literal') return literalStub(literals, size)
  return inertStub(size, ext)
}

/** 命令行 token（含 execFile: 的 | 分隔）——命令里也可能夹着判据要比对的字面量 */
export function cmdTokens(cmd) {
  return String(cmd ?? '').split(/[|\s]+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ''))
    .filter((t) => t.length >= 2)
}

/**
 * 跑判据可证伪门：把产物替换成假货 → 真跑判据 → finally 还原 → 字节级校验。
 *
 * 设计要点（诚实位）：
 *  - `run` 必填、返回 'green'|'red'|'broken'（由调用方用引擎既有的三态分类器构造）——
 *    本层不 import 引擎其它模块，避免环依赖，也让测试能注入假执行器。
 *  - 变异**全部产物一起**做（"产物被掏空的世界"），每种负对照跑一次判据。
 *  - 还原在 finally；还原后逐文件字节比对，不一致即抛 `restore-failed`（绝不留下假货态）。
 *  - 判据脚本自身不参与变异（selectArtifacts 已剔）——变异它测的是判据不是产物。
 *
 * @param {{cmd:string, writeSet?:string[], cwd?:string, run:Function,
 *          readFile?:Function, writeFile?:Function, judgeSource?:string,
 *          controls?:string[], probe?:Function}} args
 * @returns {Promise<{verdict:string, reason:string, artifacts:string[], controls:{kind:string,state:string}[], restored:boolean}>}
 */
export async function runFalsifyGate(args = {}) {
  const cmd = String(args.cmd ?? '')
  const cwd = String(args.cwd ?? process.cwd())
  const run = args.run
  if (typeof run !== 'function') throw new Error('runFalsifyGate：缺 run（三态执行器）——由调用方注入')
  const readFile = typeof args.readFile === 'function' ? args.readFile : defaultReadFile
  const writeFile = typeof args.writeFile === 'function' ? args.writeFile : defaultWriteFile
  // 判据脚本先定位（产物集与字面池都要用它）
  let judgeSource = String(args.judgeSource ?? '')
  const jp = judgePath(cmd, cwd, args.probe)
  if (!judgeSource && jp) { try { judgeSource = String(readFile(jp)) } catch { judgeSource = '' } }
  // v0.8.32 产物集 = 判据可达文件集（import 闭包 + 源码路径字面量，限工作区）∪ 写入面
  const reach = jp ? reachableFiles(jp, { cwd, probe: args.probe, readFile }) : []
  const artifacts = selectArtifacts({ cmd, writeSet: args.writeSet, cwd, probe: args.probe, extra: reach })
  if (artifacts.length === 0) {
    return { ...falsifyVerdict([], artifacts), artifacts, controls: [], restored: true }
  }
  // 字面池：判据脚本源码 + 命令本体（命令里也可能带判据要匹配的字面量）
  const literals = [...new Set([...extractLiterals(judgeSource), ...extractLiterals(cmd), ...cmdTokens(cmd)])]

  const controls = []
  let restored = true
  for (const kind of (Array.isArray(args.controls) ? args.controls : CONTROLS)) {
    // v0.8.33 不留痕：临时变异必须连**时间戳**一起还原——否则账本快检按 mtime 判「源码更新」= stale
    // （自测案底：门刚跑完，账本快检立刻报过期）；进程被杀时同样少一层残留风险。
    const backups = artifacts.map((p) => {
      let st = null
      try { st = statSync(p) } catch { st = null }
      return { p, buf: readFile(p), atime: st ? st.atime : null, mtime: st ? st.mtime : null }
    })
    let state = 'broken'
    try {
      for (const b of backups) {
        const ext = extname(b.p).toLowerCase()
        const lits = kind === 'anchored' ? anchoredLiterals(literals, Buffer.from(b.buf).toString('utf8')) : literals
        writeFile(b.p, stubFor(kind === 'anchored' ? 'literal' : kind, lits, b.buf.length, ext))
      }
      state = await run(cmd)
    } catch {
      state = 'broken'
    } finally {
      for (const b of backups) {
        try { writeFile(b.p, b.buf) } catch { restored = false }
        if (b.mtime) { try { utimesSync(b.p, b.atime, b.mtime) } catch { /* 时间戳还原失败=不阻断（内容已还原） */ } }
      }
    }
    for (const b of backups) {
      let cur = null
      try { cur = readFile(b.p) } catch { cur = null }
      if (!cur || !Buffer.from(cur).equals(Buffer.from(b.buf))) restored = false
    }
    if (!restored) {
      throw Object.assign(new Error('restore-failed：负对照变异后产物未还原为原文（已停止，请人工检查）'), {
        code: 'restore-failed', artifacts,
      })
    }
    controls.push({ kind, state })
  }
  const v = falsifyVerdict(controls, artifacts)
  return { ...v, artifacts, controls, restored }
}

function defaultReadFile(p) { return readFileSync(p) }
function defaultWriteFile(p, buf) { writeFileSync(p, buf) }
