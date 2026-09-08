/**
 * run-cmd — v0.6.29 刀一（导演定向「降低依赖」）：execFile 直跑（零 shell）+ 结构化错误分类。
 * 治的病：五处 execSync 字符串形态全走 cmd.exe——「跑不了」判定依赖本地化报错文案（GBK 乱码/
 * not recognized 失明，d3 案底）；跨平台脆弱。node 词头自动换宿主 process.execPath（零 PATH 依赖）。
 * 三态语义不变（v0.6.24）：green（exit0）/ red（能跑 exit≠0）/ broken（跑不了：ENOENT/超时/模块缺失）。
 * 结构信号优先（err.code/errno——零文案依赖）；文案匹配仅作 shell 兼容路径的 fallback。
 * 边界（诚实）：shell 语法命令（|&<>）与 EINVAL（.cmd 类需 shell）回落 execSync——协议文本已禁这些形态。
 */
import { execSync, execFileSync } from 'node:child_process'

/** 引号感知：引号内（如 node -e "a>=1&&b" 的 JS 代码）不算壳语法。 */
function hasShellSyntax(c) {
  const outside = String(c).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')
  return /[|&<>]/.test(outside)
}

/** argv 分词器（v0.8.20 单遍扫描）：零壳协议的**执行入口**——分词错=命令跑错。
 *  旧实现 `/"([^"]+)"|'([^']+)'|(\S+)` 两处缺陷：①`+` 要求非空，空引号参数 `""` 退化成带引号 token；
 *  ②双引号内转义引号 `"a\"b"` 被截断成两截。现按字符扫描：引号仅在**token 起点**生效（Windows 路径里的
 *  撇号如 C:\it's\x.mjs 保持单 token，旧行为不破），双引号内支持 \\ 与 \" 转义，空引号产出空串 token。 */
export function tokenize(s) {
  const out = []
  const src = String(s ?? '')
  let cur = '', q = null, started = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (q) {
      // 只认 \" 与 \\ 两种转义——其余反斜杠是字面量（Windows 路径 C:\a b\x.mjs 不被吃掉）
      if (q === '"' && ch === '\\' && (src[i + 1] === '"' || src[i + 1] === '\\')) { cur += src[++i]; continue }
      if (ch === q) { q = null; continue }
      cur += ch; continue
    }
    if ((ch === '"' || ch === "'") && !cur) { q = ch; started = true; continue }
    if (/\s/.test(ch)) { if (cur || started) { out.push(cur); cur = ''; started = false } continue }
    cur += ch
  }
  if (cur || started) out.push(cur)
  return out
}

/** 提取 pending 语义文本（clazz 已标或首判命中时共用——二次进入时 stderr 仍全量在）。 */
function pendingErr(errText) {
  const q = String(errText || '').match(/Cannot find module ['"]([^'"]+)['"]/)?.[1] || ''
  return q
    ? '物料未就位：' + q.slice(0, 120) + '（命令形态过·被引脚本/文件尚不存在，本步内创建后实跑核查）'
    : '物料未就位（命令形态过·目标尚不存在，本步内创建后实跑核查）'
}

/** 结构化分类（三态+物料三态）：err.clazz（execCmdSync 已标）> err.code（ENOENT/超时——零文案）> 文案 fallback。 */
export function classifyFailure(ex) {
  if (ex?.clazz) {
    if (ex.clazz === 'pending') return { state: 'pending', err: pendingErr(String(ex?.stderr || ex?.message || '')) }
    return { state: ex.clazz, err: String(ex?.stderr || ex?.message || '').split('\n')[0].slice(0, 120) }
  }
  const code = String(ex?.code || '')
  if (code === 'ENOENT') return { state: 'broken', err: 'ENOENT：可执行不存在（结构信号·零文案依赖）' }
  if (code === 'ETIMEDOUT' || ex?.killed || /ETIMEDOUT/.test(String(ex?.message || ''))) return { state: 'broken', err: '超时（结构信号）' }
  const errText = String(ex?.stderr || ex?.message || '')
  if (/Cannot find module|MODULE_NOT_FOUND|did not match any files/.test(errText)) {
    // v0.8.2 pending 态（6bc0cd62 案底：dry-run 死锁——判据指向本步内将创建的脚本，
    // 被误判 broken 拒→被迫人判妥协）：命令本体已解析成功，缺的是**被引用的物料**
    // （路径形/脚本形模块），形态过=允许挂账，落账时实跑核查。
    const q = errText.match(/Cannot find module ['"]([^'"]+)['"]/)?.[1] || ''
    if (q && (/[\\/]/.test(q) || /\.(mjs|cjs|js|ts)$/i.test(q))) {
      return { state: 'pending', err: pendingErr(errText) }
    }
    return { state: 'broken', err: errText.split('\n')[0].slice(0, 120) }
  }
  // v0.8.5：文案判定只剩 node 自有英文报错（Cannot find module 系）——OS 本地化文案不再参与分类
  return { state: 'red', err: (errText.split('\n')[0] || '').slice(0, 120) }
}

/** execSync 同形兼容（成功返 stdout，失败 throw——错误带 clazz 结构分类）。
 *  无 shell 语法的命令走 execFile 直跑（零 cmd.exe）；'node' 词头→process.execPath。 */
export function execCmdSync(cmd, opts = {}) {
  const timeout = opts.timeout ?? 20000
  const c = String(cmd || '').trim()
  // v0.8.5 零壳协议（开发者定向「判据/探针命令别堆正则阻力」）：命令只走 execFile 直跑；
  // 壳运算符（引号外）一票拒并指路，不再"猜要不要进壳"。.cmd/.bat 白名单显式进壳。
  if (hasShellSyntax(c)) {
    const err = new Error('协议禁壳：命令含壳运算符「| & < >」——用 write 工具落 .mjs 再 node 跑它，或分两次工具调用（判据与探针命令只走零壳直跑）')
    err.clazz = 'broken'
    throw err
  }
  const toks = tokenize(c)
  if (!toks.length) return ''
  let bin = toks[0]
  if (bin === 'node' || bin === 'node.exe') bin = process.execPath
  if (/\.(?:cmd|bat)$/i.test(bin) || /^(?:npm|npx)$/i.test(bin)) {
    try {
      return String(execSync(c, { timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(opts.cwd ? { cwd: opts.cwd } : {}) }) ?? '')
    } catch (e) { e.clazz = classifyFailure(e).state; throw e }
  }
  try {
    const out = execFileSync(bin, toks.slice(1), { timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(opts.cwd ? { cwd: opts.cwd } : {}) })
    return String(out ?? '')
  } catch (e) {
    if (String(e?.code || '') === 'EINVAL') {
      e.clazz = 'broken'
      e.stderr = '命令需经 cmd.exe 才能执行（.cmd/.bat 类）——请给完整路径（如 C:/.../node.exe）或改用 node 脚本'
      throw e
    }
    e.clazz = classifyFailure(e).state
    throw e
  }
}
