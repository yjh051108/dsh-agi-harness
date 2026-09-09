/**
 * tools — v0.3 接线三件套之工具面（薄封装：判定全在模块，本文件零闸逻辑拷贝）。
 *
 * 模块分工（#15-#19 已闭件）：
 *   mode-state      盘档 v3 状态迁移（onCostCommit / onGroupsEdit / onWeights 系 / recordClosed）
 *   optimal-engine  执行阶段栈与四闸（declareStep 硬化既定规则 / convergeStep / rollbackStep / vLadderOf）
 *   contract-merge  差分→物化（materialize：链式量直读，模型不抄）+ 第5闸准入判定
 *   propose-text    最小状态面（stateFace/weightsFace——常驻展示面）
 *   audit-dispatch  另头审（auditBrief 机械审材 / parseVerdict 引文硬验 / recordAuditVerdict 落账）
 *
 * Schema 形态约束（血泪坑，原样继承）：parameters 对象级 required 数组，属性级禁 required 键；
 * output={ok,text}。教育=违规事件：拒绝文本即条款（引擎/审核模块自产，此处不复读）。
 */
import {
  initMode, loadState, saveState, SEVERITIES, trigger,
  onCostCommit, onGroupsEdit, onWeightsFreeze, onWeightsConfirmed, onWeightsUnlock, recordClosed, markGroupSettled,
  controlSurface, terminalCheck, treeText, allGroupsSettled, readAutoConfirm, recordIOU, payIOU, openIOU,
} from './mode-state.js'
import { declareStep, convergeStep, rollbackStep, loadStack, stackText, stackTop, optimalFileFor, optimalDir, loadProbes, saveProbes, settleDirtyTail, baselineLine, deviationLine, agreedMatch } from './optimal-engine.js'
import { getJudge } from './judge.js'
import { noteFriction, frictionLine, frictionSummary } from './friction-organ.js'
import { materialize } from './contract-merge.js'
import { weightsFace, distillDraft } from './propose-text.js'
import { nearField } from './near-field.js'
import { auditBrief, parseVerdict, recordAuditVerdict } from './audit-dispatch.js'
import { dispatchCard } from './audit-rotation.js'
import { decideFreezeAnswer, parseSignEnvelope, parseDeliveryEnvelope, DELIVERY_RESULTS } from './intent.js'
import { loadSpec, commitSpec } from './v04-grader.js'
import { zOf, parseOutput, vCompute } from './v04-core.js'
import { computeC, rankTransition, demoteOnFake, rankLine, recoverRelaxed } from './rank-organ.js'
import { loadPricing, savePricing, recordSession, shadowC, evaluateSwitch, observeSession, evaluateHealth, learningContent, gBandOf, gBandName } from './pricing-organ.js'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execSync, execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { execCmdSync, execCmdAsync, classifyFailure } from './run-cmd.js'
import { onDeclareSuccess, onDeclareReject, onConvergeSuccess, onConvergeReject, onTerminalZero, onProbeSuccess, onProbeReject, onRollback } from './gate-wiring.js'
import { recordLesson, lessonSummary } from './learning-organ.js'
import { claimKey, recordDebts, escalateDebts, dischargeDebts, refuseGuess, debtLine, isEvidential, sourceKind, cheapestRepay } from './debt-ledger.js'
import { dispositionLine, recordTrust, trustSummary } from './trust-ledger.js'
import { runFalsifyGate, CONTROLS_FULL, falsifyKey } from './falsify.js'
import { recordAbility, abilitySummary, readAbilities } from './ability-organ.js'
import { bindActualAction, buildTaskState, recordBoundOutcome } from './task-value-core.js'
import { getModelFingerprint } from './gate-core.js'

const TEXT = (text) => ([{ type: 'text', text: String(text) }])
const OUT = {
  schema: { type: 'object', additionalProperties: false, required: ['ok', 'text'], properties: { ok: { type: 'boolean' }, text: { type: 'string' } } },
  render: (_a, v) => TEXT(String(v?.text || '')),
}
const sidOf = (exec) => {
  const sid = exec?.agent?.session?.id
  if (!sid) throw new Error('需要会话')
  return sid
}
const mustState = (sid) => {
  const s = loadState(sid)
  if (!s || s.stage === 'off') throw new Error('未激活（还没开环）：合同是写文件与判据的门——先 /optimal <任务> 或 cost_set 立合同。侦察期测量请用 probe_record（探针任何状态可用、落台账可引用）；要写实现文件，必须有合同在案（freeze 之后）')
  return s
}
const cut = (s, n) => {
  const x = String(s || '')
  return x.length > n ? x.slice(0, n) + '…' : x
}
/** 测量执行面与 PATH 解耦（V=4 案底同款防线）：裸 node 前缀→宿主自身二进制。duplicate 已于 v0.6.24 去重——统一走 resolveNodeCmd。 */
/** v0.5.9 生产红线：判别力闸在宿主进程内 execSync=阻塞事件循环——总预算封顶，慢测量改走 probe_record。 */
export const DISC_BUDGET_MS = 45000

/** v0.3.2 回执认领制：工具输出已携带的引导=静默登记幂等键，pre-step 注入只补回执没覆盖的缝（消灭双通道重复） */
const faceKeyOf = (s, top) => 'face:' + ((s && s.closed && s.closed.length) || 0) + ':' + (top ? top.n + top.status : 'idle')
function claimGuidance(sid, { terminal = false } = {}) {
  try {
    const s = loadState(sid)
    if (!s) return
    const top = stackTop(loadStack(sid))
    s.injected.add(faceKeyOf(s, top))
    if (terminal) s.injected.add('terminal')
    saveState(sid, s)
  } catch { /* 认领失败=最多多一次注入，不阻断 */ }
}

/** v0.4-S1 基数 V 读数：跑带 measure 的断言 → z → V=Σw(1−z)。
 *  无 measure 断言=返回 null（V 只覆盖已测投影——output feedback 诚实位，不装全知）。
 *  runner 可注入（测试用假读数；默认宿主 execSync）。执行失败→该 z 由 stdout 残值或 0 定，不阻断。 */
export const SEVERITY_W = { catastrophic: 4, major: 2, minor: 1 }
/** 裸 `node` 依赖 PATH——宿主进程 PATH 不保证有（V=4 首跑案底：沙箱绿/宿主 z=0）；
 *  统一解析为当前进程自身的 node 二进制，测量执行面与 PATH 解耦。v0.4.2 提为模块级：measureReads 与 probe_record 共用单一真相。 */
export const resolveNodeCmd = (cmd) => (/^node(?=[\s"'])/.test(cmd) ? process.execPath + cmd.slice(4) : cmd)

/** v0.6.25 环境事实探针（用户定向：依赖收敛到工具层）——部署真相注册时生成，跨平台可移植；
 *  协议文本不再携带本机死路径（C:\ 之类换机即谎）。三态说明是协议（住 description 静态部分），环境事实是数据（此处探）。 */
export const envFacts = () =>
  '环境事实（本机）：裸 node 由执行面自动解析为宿主自身 ' + process.execPath + '（与 PATH 解耦）' +
  (process.platform === 'win32' ? '；嵌套 & pwsh 工具层=宿主拒，直跑 pwsh -NoProfile -File' : '')

/** v0.6.24 判据执行器统一（摩擦报告 b7462c70 案底）：分解预检/组落账共用同一分类器。
 *  三态：green（exit0）/ red（能跑但 exit≠0）/ broken（跑不了：命令/模块不存在、超时——≠判据红）。
 *  broken 与 red 不可混同：broken=命令坏（结论未判定），red=条件未满足（结论红）。 */
export function classifyCmdError(ex) {
  const k = classifyFailure(ex) // v0.6.29 刀一：结构信号优先（err.clazz/ENOENT/超时——零文案依赖，GBK 免疫），文案为兼容 fallback
  return k
}

/** cmd: 值解析（b7462c70 案底：`node x.mjs（判据=…）` 全角注释拼进命令=Command failed 被误判判据红）。
 *  只许命令本体；注释/说明必须另开 人判: 项——错误信息自带改法。 */
export function parseAcceptCmd(x) {
  const v = String(x).slice(4).trim()
  if (v.includes('（') || v.includes('）') || v.includes('判据=')) throw new Error('【判据形态】cmd: 只许命令本体，注释/说明另开 人判: 项（案底 b7462c70：注释拼进命令=Command failed 被误判判据红）：「' + v.slice(0, 60) + '」')
  return v
}

/** v0.8.5 结构化判据入参（开发者定向「JSON 识别，别堆正则」）：
 *  对象形态 {kind:'cmd', command} / {kind:'human', text}；字符串 cmd:/人判: 兼容保留。
 *  前缀识别纯字符串操作（startsWith/slice），零正则。 */
export function normAcceptItem(x) {
  if (x && typeof x === 'object') {
    if (x.kind === 'cmd' && String(x.command || '').trim()) return 'cmd:' + String(x.command).trim()
    if (x.kind === 'human' && String(x.text || '').trim()) return '人判:' + String(x.text).trim()
    throw new Error('判据对象形态：{kind:"cmd",command:"node D:/x.mjs"} 或 {kind:"human",text:"浏览器实拍见主峰"}')
  }
  return String(x)
}
/** v0.8.6 会话工作区 cwd（判据/探针/测量命令的基准）：exec.agent.session.cwd 优先，宿主 cwd 兜底。
 *  v0.8.14 回退链（实测案底 probe-cwd-001：本部署 exec.agent.session.cwd 为空 → 判据/探针全部落在
 *  宿主 cwd C:\Users\Administrator，相对路径判据必红——v0.8.6 承诺「相对路径按会话工作区解析」未兑现）：
 *  v0.8.33（issue #15）：① 新增 env DSH_CLOSEDLOOP_CWD 显式覆盖（最高优先）；
 *  env DSH_SESSION_CWD/DSH_AGENT_CWD → 从 DSH_SESSION_JSONL 目录名解码（--D-dsh-- → D:/dsh）
 *  → workspaceFromSessionId（DSH_HOME 缺失时按 dshHome() 反推）→ 宿主 cwd。 */
export const sessionCwd = (exec, env = process.env) => {
  const c = String(exec?.agent?.session?.cwd || '').trim()
  if (c) return c
  // v0.8.33 显式覆盖（issue #15 建议 4）：工作区根 ≠ 工程根时，调用方可以直接指定基准目录
  const override = String(env?.DSH_CLOSEDLOOP_CWD || '').trim()
  if (override && existsSync(override)) return override
  // v0.8.21 实测案底（非 ASCII 工作区 /4.1flash大战fable5.1/月球撞击地球）：段解码未还原 ~XXXX 转义
  // → cwd 指向不存在路径 → 所有 execFile 直接 ENOENT（判据 dry-run/探针全线「跑不了」，非「判据红」）。
  // 双保险：解码已补转义还原（见 decodeWorkspaceSegment），此处再加存在性闸，坏候选逐级弃用。
  for (const cand of [decodeSessionCwd(env), workspaceFromSessionId(exec?.agent?.session?.id, env)]) {
    if (cand && existsSync(cand)) return cand
  }
  return process.cwd()
}

/** DSH_HOME 解析（v0.8.33 issue #15）：宿主进程里 DSH_HOME 常常不存在（DSH_SESSION_* 只注入
 *  命令子进程）→ ① env.DSH_HOME ② 从 DSH_SESSION_JSONL 的 …/sessions/<seg>/ 反推父目录
 *  ③ ~/.dsh 兜底。返回空串=无法确定。 */
export function dshHome(env = process.env) {
  const explicit = String(env?.DSH_HOME || '').trim()
  if (explicit) return explicit
  const p = String(env?.DSH_SESSION_JSONL || '').trim()
  const m = p.match(/[\\/]sessions[\\/]/)
  if (m && m.index > 0) return p.slice(0, m.index)
  try { return join(homedir(), '.dsh') } catch { return '' }
}

/** 工作区目录段解码（纯函数可测）：'--D-dsh--' → 'D:/dsh'；非编码段=空串。 */
export function decodeWorkspaceSegment(seg) {
  const s = String(seg || '')
  if (!s.startsWith('--') || !s.endsWith('--') || s.length <= 4) return ''
  const inner = s.slice(2, -2)
  const raw = inner.replace(/^([A-Za-z])-/, '$1:/').split('-').join('/')
  // v0.8.21：目录段对非 ASCII 用 ~XXXX（4 位十六进制码点）转义，旧实现不还原 → 解码出死路径。
  return raw.replace(/~([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** 会话工作区解码（纯函数可测）：env 显式值优先；否则从 DSH_SESSION_JSONL 的 sessions/<seg>/ 段还原。 */
export function decodeSessionCwd(env = process.env) {
  for (const k of ['DSH_SESSION_CWD', 'DSH_AGENT_CWD']) {
    const v = String(env?.[k] || '').trim()
    if (v) return v
  }
  const p = String(env?.DSH_SESSION_JSONL || '')
  const m = p.match(/[\\/]sessions[\\/]([^\\/]+)[\\/]/)
  return m ? decodeWorkspaceSegment(m[1]) : ''
}

/** 宿主侧兜底（v0.8.14 实测：宿主进程 env 里没有 DSH_SESSION_*——那些变量只注入命令子进程）：
 *  按会话 id 在 DSH_HOME 的 sessions 目录下逐段定位（sessions/<工作区段>/<sid>/），父目录段即工作区。
 *  找不到=空串（调用方兜底）。 */
export function workspaceFromSessionId(sid, env = process.env) {
  const id = String(sid || '').trim()
  const home = dshHome(env)
  if (!id || !home) return ''
  const base = join(home, 'sessions')
  try {
    for (const seg of readdirSync(base)) {
      if (!existsSync(join(base, seg, id))) continue
      const d = decodeWorkspaceSegment(seg)
      if (d) return d
    }
  } catch { /* 目录不可读=无兜底 */ }
  return ''
}

/** 组判据超时（v0.8.14）：旧值硬编码 20s——审计/构建类判据（实测 ~90s）必被误判红。
 *  默认 120s，env DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS 可调；低于 1s 的配置回默认（只放宽不收紧），上限 15min。 */
export function judgeTimeoutMs(env = process.env) {
  const n = Number(env?.DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS)
  if (!Number.isFinite(n) || n < 1000) return 120000
  return Math.min(n, 900000)
}

export function measureReads(s, runner, cwd = process.cwd()) {
  const run = runner || ((cmd) => execCmdSync(cmd, { timeout: 20000, cwd }))
  const withM = (s?.cost?.assertions || []).filter((a) => a.measure && a.measure.cmd)
  if (withM.length === 0) return null
  const measures = [], zs = [], errs = []
  for (const a of withM) {
    const mm = { id: a.text.slice(0, 24), w: SEVERITY_W[a.severity] ?? 1, kind: a.measure.kind, target: a.measure.target }
    let z = 0
    try { z = zOf(mm, parseOutput(mm, String(run(a.measure.cmd) ?? ''), 0)) }
    catch (ex) {
      try { z = zOf(mm, parseOutput(mm, String(ex?.stdout ?? ''), 1)) } catch { z = 0 }
      // v0.4.1-F2：诊断携测量脚本 stdout 尾行（真实 FAIL 原因）——此前只带截断的「Command failed: <命令>」，
      // 模型看到的是命令而非病因（dogfood R1 F2：读数失败诊断不可行动）。
      const tail = String(ex?.stdout ?? '').trim().split('\n').filter(Boolean).pop() || ''
      errs.push(`${mm.id.slice(0, 10)}:${String(ex?.message || ex).split('\n')[0].slice(0, 60)}${tail ? ' | ' + tail.slice(0, 80) : ''}`)
    }
    measures.push(mm); zs.push(Math.round(z * 100) / 100)
  }
  const v = vCompute(measures, Object.fromEntries(measures.map((mm, i) => [mm.id, zs[i]])))
  return { V: v.V, green: zs.filter((x) => x >= 1).length, total: withM.length, zs, errs }
}

/** 组落账机械门（converge/audit_record 共用）：closeRequested 的组，全部动作在栈 closed
 *  且（verify=redteam 时）逐动作有 pass 审 → settled；全组 settled → stage=final。
 *  判定输入全是盘档/栈实测——无模型口头空间。 */
/** 签名 token 规范化（v0.8.17）：剥掉包裹的标点/括号/引号，只留组名本体。
 *  旧实现直接取 `签收\s*([^\s，。,.]+)`——「签收：组A」拿到「：组A」、「签收「组A」」拿到「「组A」」，
 *  与组名逐字比对必然不中 = 真人签了字但门不开（假阴性，硬门误拦）。 */
export function normalizeSignToken(tok) {
  let s = String(tok || '').trim()
  const pairs = [['「', '」'], ['『', '』'], ['【', '】'], ['[', ']'], ['（', '）'], ['(', ')'], ['“', '”'], ['"', '"'], ["'", "'"]]
  for (let guard = 0; guard < 4; guard++) {
    let changed = false
    for (const [a, b] of pairs) {
      if (s.length > a.length + b.length - 1 && s.startsWith(a) && s.endsWith(b)) { s = s.slice(a.length, s.length - b.length).trim(); changed = true }
    }
    if (!changed) break
  }
  return s.replace(/^[:：·、\-—]+/, '').replace(/[:：·、\-—]+$/, '').trim()
}

/** 签收提取（v0.8.17 协议化）：① JSON 信封（{"closedloop":{"sign":"组A"}}，零散文猜测）
 *  ② 散文回退「签收 <组名>」——支持裸 token 与包裹形态（「组A」/（组A）/：组A），组名含空格须用括号。
 *  只解析文本，不做帧判类（帧判类在 collectUserSigns）。 */
export function extractSignsFromText(txt) {
  const t = String(txt || '')
  const env = parseSignEnvelope(t)
  if (env !== null) return env
  const out = []
  const re = /签收[\s·、:：\-—]*(?:[「『【[(（"']([^」』】\])）"'\n]+)[」』】\])）"']?|([^\s，。,.；;、\n]+))/g
  let m
  while ((m = re.exec(t))) {
    const tok = normalizeSignToken(m[1] ?? m[2] ?? '')
    if (tok) out.push(tok)
  }
  return out
}

/** 真人签收提取（r64 user 硬签收门）：只认转录帧 role=user 且 source.kind==='user'（带 rpcId 的客户端直连——介入率同款判类器），
 *  模型自写"用户已确认"在此撞墙。签名语法：「签收 <组名>」逐组（v0.8.17 起支持信封与包裹形态）；「签收全部」通配。帧不可得=空集（fail-closed，缺证据=未签收）。 */
export function collectUserSigns(messages) {
  const set = new Set()
  try {
    for (const m of messages || []) {
      if (!m || m.role !== 'user') continue
      if (m.source && m.source.kind !== 'user') continue
      const txt = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => c && c.text || '').join(' ') : ''
      for (const g of extractSignsFromText(txt)) set.add(g)
    }
  } catch { }
  return set
}

/** exec→真人签收集（异步容错；帧不可得=空集=fail-closed 未签收）。 */
export async function extractSigns(exec) {
  try { const ms = await exec?.agent?.session?.deriveMessages?.(); return collectUserSigns(ms) } catch { return new Set() }
}

/** v0.8.30 判据执行器（三态）：负对照门与组落账共用同一分类器——同命令同分类。
 *  v0.8.32 改异步（卡死修复）：用 execCmdAsync（spawn/事件环）而不是 execFileSync——
 *  同步执行器在工具调用里跑会把整个宿主停摆（用户实测：重判据一次落账卡死几分钟）。
 *  负对照（control=true）另有更短超时：判据在假货上跑 20s 还没完，本身就该判「跑不了」。 */
export function judgeRunner(cwd = process.cwd(), opts = {}) {
  const realMs = judgeTimeoutMs()
  const controlMs = Math.min(realMs, Number(opts.controlMs) || 20000)
  return async (cmd, meta = {}) => {
    try { await execCmdAsync(cmd, { timeout: meta.control ? controlMs : realMs, cwd }); return 'green' }
    catch (e) {
      const k = classifyCmdError(e)
      return k.state === 'green' ? 'green' : k.state === 'red' ? 'red' : 'broken' // broken/pending（跑不了）= 未判定
    }
  }
}

/** v0.8.32 负对照结果记忆（会话级）：键=判据 + 产物指纹（路径/大小/mtime）。
 *  为什么：同一判据在一次会话里会被反复落账（每步 closeGroup），不记忆就每次重跑 3 条负对照
 *  ——重判据上这是数分钟的重复阻塞。产物一变（指纹变）自动失效重跑。 */
const FALSIFY_MEMO = new Map()

/**
 * v0.8.30 判据可证伪门（合同期早警 + 组落账门共用）：对每条 cmd 判据跑负对照。
 * 不变量：判据必须能对假货说不。字面壳/空转壳仍绿 ⇒ vacuous ⇒ block。
 * 无产物（no-artifact）不拦（判据目标尚未创建或与写入面无关），只记 detail 供审计。
 * @returns {Promise<{block:boolean, notes:string[], details:object[]}>}
 */
export async function falsifyBlock(accept, args = {}) {
  const cwd = String(args.cwd || process.cwd())
  const writeSet = Array.isArray(args.writeSet) ? args.writeSet : []
  const run = typeof args.run === 'function' ? args.run : judgeRunner(cwd)
  const notes = []
  const details = []
  for (const x of (Array.isArray(accept) ? accept : [])) {
    if (!String(x).startsWith('cmd:')) continue
    let cmd
    try { cmd = parseAcceptCmd(String(x)) } catch { continue }
    let gate
    const key = falsifyKey(cmd, { writeSet, cwd })
    const memo = FALSIFY_MEMO.get(key)
    if (memo) gate = { ...memo, cached: true }
    else {
      try { gate = await runFalsifyGate({ cmd, writeSet, cwd, run, controls: CONTROLS_FULL }) }
      catch (e) {
        details.push({ cmd, verdict: 'unproven', reason: String(e?.message || e).slice(0, 120) })
        continue
      }
      FALSIFY_MEMO.set(key, { verdict: gate.verdict, reason: gate.reason, controls: gate.controls, artifacts: gate.artifacts })
      if (FALSIFY_MEMO.size > 200) FALSIFY_MEMO.delete(FALSIFY_MEMO.keys().next().value) // 上限：最旧的先淘汰
    }
    details.push({ cmd, verdict: gate.verdict, reason: gate.reason, artifacts: gate.artifacts.length, cached: gate.cached === true })
    if (gate.verdict === 'vacuous') {
      notes.push(`判据空转（负对照仍绿）：${cmd.slice(0, 100)}\n     ↳ ${gate.reason}；改法=换成真跑产物的行为型判据（读运行时读数/真实副作用），或改挂 人判:，或换一条独立通道的判据`)
    }
  }
  return { block: notes.length > 0, notes, details }
}

export async function trySettleGroups(s, steps, userSigns, cwd = process.cwd()) {
  const notes = []
  // v0.8.31 支付通道：本拍真人签收帧即付（组名精确或「全部」）——签了字的欠据不再阻塞归零
  s = payIOU(s, userSigns)
  for (const g of s.groups) {
    if (g.settled || !g.closeRequested) continue
    const acts = s.closed.filter((c) => c.group === g.title)
    if (acts.length === 0) { notes.push(`组「${g.title}」请求落账但零动作——先跑动作再 closeGroup`); continue }
    const noStep = acts.filter((a) => !steps.some((x) => x.status === 'closed' && x.title === a.title)).map((a) => a.title)
    if (noStep.length) { notes.push(`组「${g.title}」落账待栈闭合：${noStep.join('、')}`); continue }
    if (g.verify === 'redteam') {
      const unaudited = acts.filter((a) => !(a.audit && a.audit.last && a.audit.last.verdict === 'pass')).map((a) => a.title)
      if (unaudited.length) { notes.push(`组「${g.title}」redteam 门未过：逐动作 audit_record 过审后方可落账（待审 ${unaudited.join('、')}）`); continue }
    }
    // r64 user 硬签收门：verify=user 组必须有真人帧签收（组名精确或「全部」）——机器验"有没有人说过"，这是能做到的天花板
    if (g.verify === 'user') {
      const sig = userSigns || new Set()
      if (!sig.has(g.title) && !sig.has('全部')) { notes.push(`组「${g.title}」user 门未过：需导演真发「签收 ${g.title}」（或「签收全部」）——模型自写签收在此撞墙（帧判类只认 rpcId 真人面）`); continue }
    }
    // v0.8.30 判据可证伪门（落账前）：把写入面产物替换成负对照再跑判据——判据若照样绿，它是空的，不许落账。
    //   位置刻意在实跑 cmd 判据**之前**：先证明这把尺子有刻度，再看它读数。
    const fb = await falsifyBlock(g.accept, { writeSet: s.writeSet, cwd })
    if (fb.block) {
      notes.push(`组「${g.title}」判据不可证伪，不落账：\n${fb.notes.map((n) => '  ✗ ' + n).join('\n')}`)
      continue
    }
    // v0.5.8 组判据挂账：cmd: 项落账时实跑（红=不落账）；人判: 项入落账回执（可见，供审计）
    // v0.6.24 三态分类（b7462c70 案底）：broken（跑不了）与 red（判据红）显式区分，不混同
    const cmdFails = [], honorNotes = []
    for (const x of g.accept || []) {
      const ax = String(x)
      if (ax.startsWith('cmd:')) {
        let cmd
        try { cmd = parseAcceptCmd(ax) } catch (e) { cmdFails.push('形态坏：' + e.message); continue }
        try { await execCmdAsync(cmd, { timeout: judgeTimeoutMs(), cwd }) }
        catch (e) {
          const k = classifyCmdError(e)
          cmdFails.push(k.state === 'broken'
            ? '跑不了（命令坏，非结论红——修形态：注释入人判项/绝对路径后重跑）: ' + k.err
            : k.state === 'pending'
              ? '跑不了（物料未就位：判据目标本应在本步创建——未创建=不落账）: ' + k.err
              : '判据红（exit≠0，条件未满足）: ' + k.err + '（cwd=' + cwd + '）')
        }
      } else if (ax.startsWith('人判:')) honorNotes.push(ax.slice(3).trim())
    }
    if (cmdFails.length) { notes.push(`组「${g.title}」判据未全绿，不落账：\n${cmdFails.map((f) => '  ✗ ' + f).join('\n')}`); continue }
    const r = markGroupSettled(s, g.title, 'mechanical-settle')
    if (r.ok) {
      s = r.state
      // v0.8.31 欠据：人判项登记为欠据（不再当"挂账"放行）——未付欠据阻止终端归零。
      //  口径改动的原因（池核案底）：机器看不见的项恰恰决定质量，挂账=可放行的放过。
      if (honorNotes.length) s = recordIOU(s, g.title, honorNotes)
      const iouLine = honorNotes.length
        ? `；⏳ 人判欠据 ${honorNotes.length} 条（待开发者签收——回「签收 ${g.title}」或「签收全部」）：${honorNotes.join('；')}`
        : ''
      notes.push(`组「${g.title}」落账 ✓（动作×${acts.length}，栈闭合齐${g.verify === 'redteam' ? '，审全 pass' : ''}${(g.accept || []).filter((x) => String(x).startsWith('cmd:')).length ? '，cmd 判据全绿' : ''}${iouLine}）`)
    }
  }
  if (allGroupsSettled(s) && s.stage !== 'final') { s = { ...s, stage: 'final' }; notes.push('全组落账 → 终端校验态：terminal_check 出归零报告。') }
  return { state: s, notes }
}

/* ============================ 合同阶段（用户主权段） ============================ */

export function costSetDefinition({ name = 'cost_set' } = {}) {
  return {
    name,
    description: '启动超级任务完成模式（内部兼容标识 cost_set）：先不要直接生成或写文件。先查看可用工具与工作区，主动索取缺料；然后说清你要完成什么、什么算做好、拿什么验证。purpose=一句话目的（≥12字）；assertions=完成条件列表 {text,severity,source}——每条带来源依据；measure 可选（挂一条可跑的验证命令）。模式启动后你可以自由写代码、逐步实现、逐步验证——每一步都是成长记录。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['purpose'],
      properties: {
        purpose: { type: 'string', description: '目的宣言（一句话）' },
        assertions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'severity', 'source'], properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['minor', 'major', 'catastrophic'] }, source: { type: 'string', description: '公式/条款/用户确认原话（空=拒）' }, measure: { type: 'object', additionalProperties: false, properties: { cmd: { type: 'string', description: 'v0.4-S1 测量函数：机械可执行的读数命令（如 npm test / node scripts/build.mjs）。' + envFacts() + '；命令失败三态=绿（exit0）/红（能跑 exit≠0）/跑不了（命令坏）——跑不了≠结论红' }, kind: { type: 'string', enum: ['bool', 'ratio', 'count'], description: 'z 读数语义：bool=exit0；ratio/count=÷target 截断 [0,1]' }, target: { type: 'number' } } } } } },
        nonGoals: { type: 'array', items: { type: 'string' } },
        nonGoalsConfirmed: { type: 'boolean' },
        assumptions: { type: 'array', items: { type: 'string' } },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      if (args && ('requirements' in args || 'mode' in args)) throw new Error('超级任务完成模式：requirements/mode 已废——断言走 assertions[{text,severity,source}]。')
      let s = loadState(sid) || initMode()
      if (s.stage === 'final' && allGroupsSettled(s)) { // v0.3.1③ final 自启动正式化：已终结旧单→新单（trigger 语义，账本栈不抹）
        s = trigger(s, String(args?.purpose || '').slice(0, 60))
        console.log('[closedloop] final→新单自启动（超级任务完成模式正式通道）')
      }
      if (s.weightsLocked) throw new Error('合同已锁（单一锁点）——开发中改口发文本『修改』解锁重排。')
      const p = String(args?.purpose || '').trim()
      if (!p || p.length < 12) throw new Error('purpose 必填且 ≥12 字（有信息量的目的宣言，非口号）')
      const assertions = Array.isArray(args?.assertions) ? args.assertions : []
      if (assertions.length === 0) throw new Error('assertions 至少 1 条 {text,severity,source}——无断言=无代价函数')
      for (const [i, a] of assertions.entries()) {
        if (!String(a?.text || '').trim()) throw new Error(`assertions[${i}].text 缺失`)
        if (!SEVERITIES.includes(a?.severity)) throw new Error(`assertions[${i}] 缺合法档位（minor|major|catastrophic）`)
        if (!String(a?.source || '').trim()) throw new Error(`assertions[${i}] 缺来源——无来源=断言无效（既定规则，防"自造 0.02"）`)
      }
      // v0.5.8 判别力闸（体感实测案底：node --test 校准前已绿=V 谎报完成）：
      // 挂合同时实跑每条 measure——报错=拒（dry-run 纪律从文本升闸）；已绿无 rationale=拒（无判别力）。
      const noDisc = [], cmdErr = []
      const t0 = Date.now()
      for (const [i, a] of assertions.entries()) {
        if (!a?.measure?.cmd) continue
        const left = DISC_BUDGET_MS - (Date.now() - t0)
        if (left <= 0) { cmdErr.push(`[${i}] 总预算 ${DISC_BUDGET_MS}ms 耗尽——慢测量先 probe_record 独立跑再挂合同（宿主事件循环保护）`); break }
        const mm = { id: 'a' + i, kind: a.measure.kind || 'bool', target: a.measure.target }
        try {
          const out = execCmdSync(a.measure.cmd, { timeout: Math.min(20000, left) })
          const z = zOf(mm, parseOutput(mm, String(out ?? ''), 0))
          if (z >= 1 && !String(a.rationale || '').trim()) noDisc.push(i)
        } catch (ex) {
          // Windows 经 cmd 跑不存在的命令=exit1+stderr"not recognized"——以此辨"跑不了"（报错）vs"跑了红"（可挂）
          const errText = String(ex?.stderr || ex?.message || '')
          if (/not recognized|不是内部或外部命令|ETIMEDOUT|ENOENT/.test(errText)) cmdErr.push(`[${i}] ${errText.slice(0, 60)}（tips：①路径实测勿猜仓根 ②ESM import 要 file:///）`)
          else { try { const z2 = zOf(mm, parseOutput(mm, String(ex?.stdout ?? ''), 1)); if (z2 >= 1 && !String(a.rationale || '').trim()) noDisc.push(i) } catch { /* exit红=有判别力，放行 */ } }
        }
      }
      if (cmdErr.length) throw new Error(`measure 报错不可挂（跑不了≠跑了红——绿红皆可、报错不可）：${cmdErr.join(' | ')}——先独立跑通再挂合同`)
      if (noDisc.length) throw new Error(`判别力闸：assertions[${noDisc.join(',')}] 的 measure 挂合同时已绿——绿在干活前=无判别力（体感实测案底：node --test 校准前就绿）。measure 应指向本单增量；确属护栏断言（变红即事故）则在**该断言对象内**补 rationale 字段（不是顶层——E2E 案底 r46：文案不指位置逼模型读源码）说明理由，重发 cost_set`)
      const ng = Array.isArray(args?.nonGoals) ? args.nonGoals : []
      if (ng.length > 0 && args?.nonGoalsConfirmed !== true) throw new Error('既定规则：nonGoals 须用户确认（选择题/原话）并携 nonGoalsConfirmed=true——AI 单方不做清单=拒')
      s = s.stage === 'off' ? { ...s, stage: 'brainstorm', task: p.slice(0, 60) } : s
      // v0.5.1 WAL 脏尾结算：开局即净（醒来看见干净账，不靠人肉收尸）
      let dirty = 0
      try { dirty = settleDirtyTail(sid) } catch { /* 结算失败不阻断开单（诚实位：脏尾下轮再清） */ }
      s = onCostCommit(s, args)
      saveState(sid, s)
      const dist = ['catastrophic', 'major', 'minor'].map((sv) => s.cost.assertions.filter((a) => a.severity === sv).length)
      // v0.6.31（导演定向「绝对的入口」）：persona 移至环开首注（index.js，幂等一/会话）——回执不再携带；
      // 回执任务语化：Q_N 定稿→合同已立；severity 代码→关键/重要/一般；下一步指路说人话。
      return { ok: true, text: `✅ 超级任务完成模式已启动：${cut(p, 80)}\n完成条件 ${s.cost.assertions.length} 条（关键 ${dist[0]} · 重要 ${dist[1]} · 一般 ${dist[2]}）${s.cost.nonGoals.length ? `；不做的事 ${s.cost.nonGoals.length} 项` : ''}${s.cost.assumptions.length ? `；假设 ${s.cost.assumptions.length} 条` : ''}。\n下一步：decompose 把完成条件整理成几个大类（每组判据写可跑命令或人判项），然后 freeze 开始干活。${lessonSummary(3, undefined, sid)}${s.rank ? '\n' + rankLine(s.rank, { C: (s.rank.C ?? 0), n: (s.rank.n ?? 0) }) : ''}${dirty ? `\n🧹 上单有 ${dirty} 步未收尾，已自动作废归档（不影响你的信誉）。` : ''}` }
    },
  }
}

export function decomposeDefinition() {
  return {
    name: 'decompose',
    description: '【分解·组级·合同阶段】一次全量提交大类 groups=[{title,spec,accept,verify,do?}]（组判据 accept 必填≥1；每条可用两类形态：字符串「cmd:<本机可跑命令>」（提交时 dry-run、落账时实跑）/「人判:<内容>」（挂账可审计），或结构对象 {kind:"cmd",command} / {kind:"human",text}——裸判据=拒）。verify=组核对形态 self|subagent|redteam|user。**无块级 items**——动作由执行阶段每步实时提议（cost-to-go 最小），冻结锁的是权重与组结构，不是轨迹（既定规则）。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['groups'],
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['title'],
            properties: {
              title: { type: 'string', description: '大类名' },
              spec: { type: 'string', description: '组任务描述（必填）' },
              accept: { type: 'array', items: { type: 'string' }, description: '组判定标准 ≥1（可核对）' },
              verify: { type: 'string', enum: ['self', 'subagent', 'redteam', 'user'], description: '组核对形态。强制力分级如实：redteam/user=硬门（redteam 逐动作 audit pass；user 需导演真人帧「签收 <组名>」或「签收全部」——只认转录 source.kind=user 带 rpcId 帧，模型自写签收撞墙，r64 实装兑现 r58 承诺）；self/subagent=声明式（落账附核对承诺与挂账文，面板可见可审计，机器不拦）' },
              do: { type: 'string', enum: ['self', 'subagent', 'workflow', 'daemon', 'mixed'], description: '组默认执行形态（动作提议时可覆写）' },
            },
          },
        },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      if (s.weightsLocked) throw new Error('权重已锁——『修改』解锁后重排。')
      if (!s.cost?.aligned) throw new Error('先启动超级任务完成模式并说明完成标准（内部工具 cost_set；合同顺序：目标先于结构）')
      const groups = (Array.isArray(args?.groups) ? args.groups : []).map((g) => ({ ...g, accept: Array.isArray(g?.accept) ? g.accept.map(normAcceptItem) : g?.accept }))
      if (groups.length === 0) throw new Error('groups 为空')
      const titles = groups.map((g) => String(g?.title || '').trim())
      if (titles.some((t) => !t)) throw new Error('存在空组名')
      if (new Set(titles).size !== titles.length) throw new Error('组名重复')
      // v0.8.5：accept 先规范化（对象形态→字符串前缀形态），后续全部纯字符串判断
      for (let i = 0; i < groups.length; i++) groups[i] = { ...groups[i], accept: (Array.isArray(groups[i].accept) ? groups[i].accept : []).map(normAcceptItem) }
      const pendingNotes = [] // v0.8.2 dry-run 挂账标注（execute 级作用域，回执引用）
      for (const g of groups) {
        if (!String(g?.spec || '').trim()) throw new Error(`组「${g.title}」缺 spec`)
        if (!(Array.isArray(g?.accept) && g.accept.length > 0)) throw new Error(`组「${g.title}」缺 accept（至少一条完成判据）`)
        // v0.5.8 组判据挂账（体感案底：accept 非机械判据可空转落账）：每条必须 cmd: 或 人判: 前缀
        const bad = (g.accept || []).filter((x) => !String(x).startsWith('cmd:') && !String(x).startsWith('人判:'))
        // v0.6.24 判据形态闸（b7462c70 案底）：cmd: 只许命令本体——注释/说明另开 人判: 项
        for (const x of (g.accept || [])) {
          if (!String(x).startsWith('cmd:')) continue
          parseAcceptCmd(String(x))
        }
// v0.5.11-P0 判据 dry-run（体感案底：形态坏的判据落账时才红——应在写入合同当天暴露；红判据允许，跑不了禁止）
// v0.8.2 死锁修复（6bc0cd62 案底）：pending=命令形态过、物料未就位（脚本本步内创建）→允许挂账并标注，
//   落账仍实跑、未绿=组不落账；broken=命令本体坏→拒并留教训（judge-dryrun）。
// v0.6.24 统一执行器：与组落账共用 resolveNodeCmd+classifyCmdError（同命令同分类，预检=真跑语义）
for (const g of groups) {
  for (const [gi, x] of (g.accept || []).entries()) {
    if (!String(x).startsWith('cmd:')) continue
    let cmd
    try { cmd = parseAcceptCmd(String(x)) } catch (e) { throw new Error('【dry-run】组「' + g.title + '」判据 #' + (gi + 1) + ' ' + e.message) }
    try {
      execCmdSync(cmd, { timeout: 2500, cwd: sessionCwd(exec) })
    } catch (ex) {
      const k = classifyCmdError(ex)
      if (k.state === 'broken') {
        recordLesson('judge-dryrun', '组「' + g.title + '」判据 #' + (gi + 1) + ' 命令形态坏：' + k.err.slice(0, 60), 'tools:decompose', undefined, sid);
        throw new Error('【dry-run】组「' + g.title + '」判据 #' + (gi + 1) + ' 本机跑不了：' + k.err + '（' + String(ex?.message || '').slice(0, 80) + '）——判据命令形态坏了，改到本机可跑再提交（判据红=能跑但条件未满足，允许；跑不了=命令坏，禁止）')
      }
      if (k.state === 'pending') {
        pendingNotes.push(`组「${g.title}」判据 #${gi + 1}：${k.err.slice(0, 90)}`)
      }
    }
  }
}
        if (bad.length) throw new Error(`组「${g.title}」accept 前缀闸：每条判据须「cmd:<可跑命令>」（落账时实跑，红=不落账）或「人判:<内容>」（落账回执挂账可见，供审计）——裸判据=可空转（体感实测案底）`)
      }
      // v0.8.30 判据可证伪门（合同期早警）：写入面已有产物时，当场把产物替换成负对照再跑判据——
      //   空转判据（判据被字符串本身满足）在写合同的当天就拒收，而不是等落账时才拦。
      //   无产物=不拦（判据目标尚未创建），落账门会再拦一次。
      {
        const accepts = groups.flatMap((g) => g.accept || [])
        const fb = await falsifyBlock(accepts, { writeSet: s.writeSet, cwd: sessionCwd(exec) })
        if (fb.block) {
          for (const n of fb.notes) { try { recordLesson('vacuous-judge', n.slice(0, 120), 'tools:decompose', undefined, sid) } catch { /* 教训记账失败不阻断拒收 */ } }
          throw new Error('【判据空转】负对照仍绿=这条判据能被假货满足（不是尺子，是摆设）：\n' + fb.notes.map((n) => '  ✗ ' + n).join('\n')
            + '\n负对照=把本会话写入面的产物换成「字面壳（只含判据要匹配的字符串）/空转壳（结构合法但什么都不做）」再跑你的判据。')
        }
      }
      // v0.5.12 引导体系v2 自主档驱动行为（敢走开第一落地）：T≥2 时 verify=user 自动降级 self（可回退——降档即收回）
      const rankT0 = (s.rank && s.rank.T) || 0
      for (const g of groups) {
        if (rankT0 >= 2 && g.verify === 'user') { g.verify = 'self'; g.autoRelaxed = true }
      }
      // v0.6.0 防滑抽审（引导体系三旋钮）：T1+ 时原始 self 组每 3 取 1 转 redteam（autoRelaxed 不叠抽）
      let selfIdx = 0
      for (const g of groups) {
        if (rankT0 >= 1 && g.verify === 'self' && !g.autoRelaxed) {
          if (selfIdx % 3 === 2) { g.verify = 'redteam'; g.auditSampled = true }
          selfIdx++
        }
      }
      const r = onGroupsEdit(s, groups)
      if (!r.ok) throw new Error(r.error)
      saveState(sid, r.state)
      return { ok: true, text: `组结构落盘（${groups.length} 组，无块级序列）：\n${treeText(r.state)}\n下一步=freeze（锁权重+组结构 → 用户确认后开执行阶段）
⚠ 自主档降级：T≥2 user 组已转为 self（autoRelaxed——降档即收回）${(() => { const u = [...new Set(pendingNotes)]; const fold = u.length > 3 ? u.slice(0, 3).concat([`…另有 ${u.length - 3} 条同类判据挂账（同上原因）`]) : u; return fold.length ? `\n⏳ 判据挂账（命令形态过·物料未就位——本步内创建后实跑核查，落账未绿=组不落账）：\n- ` + fold.join('\n- ') : '' })()}` }
    },
  }
}

export function freezeDefinition(deps) {
  return {
    name: 'freeze',
    description: '【冻结·单一锁点·合同阶段】锁 Q_N 权重 + 组结构 + 约束（非轨迹）。回执=合同评审单（weightsFace）；确认优先级：settings.autoConfirm 直认（不弹窗）→ 结构化弹窗（多选可附补充）→ 文本『确认』回退。',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
    output: OUT,
    async execute(_args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      const r = onWeightsFreeze(s)
      if (!r.ok) throw new Error(r.error)
      let st = r.state
      saveState(sid, st)
      const sheet = [weightsFace(controlSurface(st)), '', treeText(st)].join('\n')
      // v0.4.1-F1：autoConfirm 直认优先（用户授权通道，凭据=graded-settings.json autoConfirm）——
      // 0.3.2「弹窗劫持授权」回归修复：autoConfirm=true 不再弹窗，本调用内直接确认开执行阶段（零阻塞项）
      if (readAutoConfirm()) {
        st = { ...onWeightsConfirmed(st), scanLog: { at: Date.now(), intent: 'autoConfirm', stage: 'weights', head: 'freeze-direct' }, freezeAck: { at: Date.now(), via: 'autoConfirm-direct' } }
        saveState(sid, st)
        console.log('[closedloop] freeze auto-confirm 直认（provenance=settings.autoConfirm，用户授权「跳过确认环节完全自主」）')
        return { ok: true, text: sheet + '\n✅ autoConfirm 直认（settings.autoConfirm=true，跳过弹窗通道）→ 执行阶段已开\n📋 合同摘要如上（weightsFace+组结构）——导演要反驳请发文本『修改』解锁重排（已闭账分毫不动）' }
      }
      // v0.3.2 确认=结构化 UI 控件（ask_user_question 多选+补充文本同交）；无 UI 通道时回退文本
      if (deps?.askUser) {
        let ans = { answers: [] }
        try { ans = await deps.askUser(exec?.agent, st) || ans } catch (e) { ans = { answers: [], error: String(e?.message || e) } }
        if (ans.error) return { ok: true, text: sheet + `\n⚠ 弹窗通道异常（回退文本/autoConfirm）：${String(ans.error).slice(0, 160)}` }
        const a = (ans.answers || [])[0] || {}
        const selected = a.selected || []
        const custom = String(a.custom || '').trim()
        // v0.8.13 弹窗决策结构化（案底：旧实现 /确认/.test(label) 子串匹配——「暂不确认」「确认修改」
        // 都含「确认」→ 误 approve=直接锁合同；且补充文字走一套重复正则，修了文本道没修弹窗道）。
        // 现走 intent.js 单一真相：显式结构化值 > 选项标签前缀逐字 > 补充文字否定感知；未识别一律 fail-closed。
        const dec = decideFreezeAnswer(a)
        const okGo = dec.intent === 'approve'
        const noGo = dec.intent === 'reject'
        if (okGo) {
          st = { ...onWeightsConfirmed(st), reviewNote: custom || undefined, freezeAck: { at: Date.now(), via: 'ui-confirm' } }
          saveState(sid, st)
          return { ok: true, text: sheet + `\n✅ UI 确认（${selected.join('+') || custom}）→ 执行阶段已开${custom ? `；补充已落 reviewNote：「${custom.slice(0, 40)}」` : ''}` }
        }
        if (noGo) {
          st = { ...onWeightsUnlock(st), reviewNote: (custom || selected.join(' ')) || undefined }
          saveState(sid, st)
          return { ok: true, text: sheet + `\n↩️ UI 反驳（${(custom || selected.join(' ')).slice(0, 40) || '修改'}）→ 已解锁回标定态（已闭账不丢），按补充意见重排后重新 freeze` }
        }
        return { ok: true, text: sheet + `\n⚠ 弹窗未获明确选择（via=${dec.via}）——保持待确认：可再 freeze 重弹，或文本回复『确认』/『修改』。` }
      }
      return { ok: true, text: sheet + '\n（无 UI 通道：文本『确认』/『修改』或 settings.autoConfirm 回退路径生效）' }
    },
  }
}

/* ============================ 探针台账（v0.4.2 来源纪律·测量证据盘） ============================ */
/** audit_dispatch（v0.6.24 单卡执行）：轮转选 auditor 槽位 + 固定模板（hash 入回执，内置盘档审材）。
 *  v0.6.24 改（摩擦报告 F6）：程序化拉起废除（案底 audit-11024c5e：新建会话无绑定代理=零 token 挂死
 *  +谎报 launched；回执不回流=审计磨损 ~15 调用）。单卡=模板+审材全文随下，用 subagent 工具转交
 *  fresh 会话；子代理最终消息=回执（天然回流），原样交 audit_record 硬验（引文逐字）。 */
export function auditDispatchDefinition() {
  return {
    name: 'audit_dispatch',
    description: '【审计·单卡派发 v0.6.24】轮转槽位选 auditor（被审者不可选）+固定 prompt 模板（hash 可验，内置盘档审材）；读不到盘档文件时凭卡内审材审（不许拒审）；用 subagent 工具转交本卡（fresh 会话直读盘档）——subagent 通道不可用即降级派发卡形态照走；子代理最终消息=回执，原样交 audit_record 硬验——回执即回流（无需镜像文件）。',
    parameters: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: { type: 'string', description: '被审动作名（与 closed[].title 一致）' } } },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      const title = String(args?.title || '').trim()
      if (!(s.closed || []).some((c) => c.title === title) && !stackTop(loadStack(sid))) return { ok: false, text: '无此动作可审（closed 里没有且栈空）' }
      let briefText = ''
      try {
        const stackRaw = readFileSync(optimalFileFor(sid), 'utf8')
        const b = auditBrief({ stackRaw, targetTitle: title, cost: s.cost, stackPath: optimalFileFor(sid) })
        briefText = b.ok ? b.brief : ''
      } catch { /* 审材不可得：模板自带「未生成」行，卡面如实标注 */ }
      const card = dispatchCard(sid, title, optimalDir(), briefText)
      return { ok: true, text: `【审计派发】槽位=${card.slot}(第${card.counter}轮) 模板hash=${card.promptHash} 审计会话=${card.auditSid}\n⚠ 单卡执行：用 subagent 工具转交本卡（fresh 会话直读盘档+内置审材）；子代理最终消息=回执，原样交 audit_record——回执即回流（无需镜像文件）：\n---\n${card.prompt}\n---\n回执交 audit_record(title, verdictText)，引文逐字硬验不变` }
    },
  }
}
export function probeRecordDefinition() {
  return {
    name: 'probe_record',
    description: '【探针台账 v0.5】实跑 cmd，output 尾 1000 字+exit 落台账；predict 引 probe:<key> 时数字必须出现在实跑 output（declare 时引擎机械复验）。先实测后预测——台账是测量证据不是日记。用法要点（零壳协议）：①命令零壳直跑，最稳形态 `node <绝对路径.mjs> [args]`（正斜杠路径、参数走 argv）；**相对路径按会话工作区 cwd 解析**（判据/探针与工作区同基准，v0.8.6）；`node -e "..."` 引号内运算符（>= && 等）安全可用，但命令**含壳运算符「| & < >」（引号外）会一票拒（协议禁壳）**——管道/重定向请在 .mjs 内实现或分两次调用；②要写文件用 write 工具落 .mjs 再 node 跑它，勿用 echo/heredoc 重定向；③绿/红/跑不了三态在诊断里点名区分——跑不了=命令本身坏。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['key', 'cmd'],
      properties: {
        key: { type: 'string', description: '台账 key（1-40 字，[a-zA-Z0-9_-]）' },
        cmd: { type: 'string', description: '探针命令（机械可执行，≤20s；输出尾 1000 字落档）。零转义形态：execFile:node|D:/x.mjs|arg1|arg2（不经 shell；别用 -e 内联引号）。' + envFacts() + '；命令失败三态=绿/红/跑不了（跑不了≠结论红）' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      // v0.5.11 行为层：探针=测量账本，任何状态可跑（侦察先探后签；防伪在 declare 引用复验，不在探针门槛）
      const key = String(args?.key || '').trim()
      const cmd = String(args?.cmd || '').trim()
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(key)) throw new Error('probe_record key：1-40 字 [a-zA-Z0-9_-]（台账引用键）')
      if (!cmd) throw new Error('probe_record cmd：需机械可执行的探针命令（实跑落 output，非手算）')
      let out = '', code = 0
      // v0.5.11-P1：argv 形态（execFile:node|D:/x.mjs|a|b——零 shell 转义）+ 跨平台预检
      if (cmd.startsWith('execFile:')) {
        const parts = cmd.slice(9).split('|')
        if (parts.slice(1).map((x) => x.trim()).includes('-e')) { recordLesson('probe-e-inline', '探针用 execFile -e 内联形态（截断误导案底）', 'tools:probeRecord', undefined, sid); throw new Error('probe_record execFile 形态不支持 -e（P3-2 案底：内联脚本被截断、报错指向脚本误导排障）——用 write 工具落 .mjs 再 node 跑它，或字符串形态 「node <绝对路径.mjs> [args]」') }
        const bin = (parts[0] || '') === 'node' ? process.execPath : (parts[0] || '')
        try { out = String(execFileSync(bin, parts.slice(1), { timeout: 20000, encoding: 'utf8', cwd: sessionCwd(exec) }) ?? '') }
        catch (ex) {
          out = String(ex?.stdout ?? '') + (ex?.stderr ? '\n[stderr] ' + String(ex.stderr).slice(-400) : '')
          code = ex?.status ?? 1
        }
      } else {
        const ux = cmd.match(/^(head|ls|grep|cat|tail|rm|cp|mv|touch|sort|uniq|wc|sed|awk|find|xargs|diff|pwd|chmod)\b/)
        if (ux) { recordLesson('cmd-crossplatform', '探针命令用 Unix 命令「' + ux[0] + '」', 'tools:probeRecord', undefined, sid); throw new Error('probe_record 跨平台预检：「' + ux[0] + '」不是 Windows cmd 内建命令——换 node 内置实现（write 工具落 .mjs 再 node 跑）或 execFile: 形态（零 shell 转义）：execFile:node|D:/x.mjs|arg1') }
        try { out = String(execCmdSync(cmd, { timeout: 20000, cwd: sessionCwd(exec) }) ?? '') }
        catch (ex) {
          out = String(ex?.stdout ?? '') + (ex?.stderr ? '\n[stderr] ' + String(ex.stderr).slice(-400) : '')
          code = ex?.status ?? 1
        }
      }
      const book = loadProbes(sid)
      book[key] = { cmd, at: Date.now(), exit: code, output: out.slice(-1000) }
      saveProbes(sid, book)
      // v0.4.3 口径对齐辅助（R3-F-R3-2 直修：includes() 布尔 vs 计数）：列可解析 key=value，引全键防抄错键
      const tokens = probeTokens(out)
      const silentFail = code !== 0 && String(out).trim() === '' ? '\n⚠ 彻底静默失败（stdout/stderr 皆空）=命令大概率没跑起来（路径/引号/编码）——先 pwsh 直跑该命令复现定位，别对着空台账猜' : ''
      onProbeSuccess({ key, exit: code })
      try {
        const ss = loadState(sid)
        if (ss) {
          const taskState = buildTaskState({ sid, model: getModelFingerprint(), state: ss, stack: loadStack(sid), purpose: ss.cost?.purpose, assertions: ss.cost?.assertions })
          bindActualAction({ taskState, actionKind: 'probe', actionTitle: key })
        }
      } catch { /* 归因账故障不影响探针台账 */ }
      return { ok: true, text: `🔍 探针「${key}」实跑 exit=${code}，output 尾 1000 字已落台账。引用：probe:${key}（predict.value 含数字则必须出现于 output）\n—— output 尾：\n${cut(out, 400)}${silentFail}${tokens.length ? '\n可解析值（引用用完整 key=value；裸数字易抄错键——R3 案底）: ' + tokens.slice(0, 8).join(', ') : ''}` }
    },
  }
}

/* ============================ 判分器棘轮（v0.4-S1 上工具面） ============================ */

export function measureProposeDefinition() {
  return {
    name: 'measure_propose',
    description: '【判分器·棘轮单向阀 v0.4】提交 measure-spec（判分器集，宿主侧 graded-state/measures/ 落盘带 sha 历史链）：新增断言/升权重/升阈值=收紧，自动生效；删除/降权/降阈=机拒（判分器不可被被审者放松）；改测量命令或 kind=语义越权→人审队列，人工确认后携 humanApproved=true 重提。Everitt 因果分离的最小落地：策略可写判分器，但只有拧紧权。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['measures'],
      properties: {
        measures: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'cmd'], properties: { id: { type: 'string' }, w: { type: 'number' }, cmd: { type: 'string' }, kind: { type: 'string', enum: ['bool', 'ratio', 'count'] }, target: { type: 'number' } } } },
        humanApproved: { type: 'boolean', description: '仅在人审通过后置 true（cmd/kind 语义变更通道）' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      mustState(sid)
      const cur = loadSpec(sid)
      const draft = { v: 4, measures: (Array.isArray(args?.measures) ? args.measures : []).map((x) => ({ ...x, w: typeof x.w === 'number' ? x.w : 1 })) }
      const r = commitSpec(sid, draft, { humanApproved: args?.humanApproved === true })
      if (!r.ok && r.needHuman) return { ok: true, text: `👤 人审队列（未落盘）：${r.queue.join('；')}\n语义变更超出棘轮机判权限——人工确认后人审重提携 humanApproved=true。` }
      if (!r.ok) throw new Error(`棘轮机拒：${r.violations.join('；')}`)
      return { ok: true, text: `✅ 判分器棘轮 ${r.verdict} 生效（sha=${r.sha}，measures ${draft.measures.length} 条，历史链 +1 宿主侧落盘）` }
    },
  }
}

/* ============================ 执行阶段（实时定序段） ============================ */

export function optimalDeclareDefinition() {
  return {
    name: 'optimal_declare',
    description: '【闭环·声明·差分面 v0.3】args=diff：title+group（提议归属）+predict[{key,value,source}]（**source 两形态**：字符串 read:<path>#L<n> / probe:<key> / prior:<文本> / engram:<标题>，或对象 {kind:"probe",key} / {kind:"read",path,line?} / {kind:"prior",text} / {kind:"engram",title}——对象免正则歧义）+channels[≥2]（不足按第5闸重流程）+可选覆写 invariants/law/cost/vExpect/dipPlan/confidence/right/wrong。链式量（beforeBand=盘档 lastBand）/Q_N 成本投影/法基行由引擎物化——模型不抄。物化全量交 declareStep 同一道闸（无源=拒、≥2通道、dip 回升、签名局部化）。**vExpect 三段用法（v0.8.26 起可省略——引擎按当前档推导：at→maintain，否则→improve；只有 dip 必须显式声明）**：① 默认/增量→省略（或显式 improve，严格提升）；② 基建/暂平段（档位平或暂劣）→显式 dip+必填 dipPlan 回升计划；③ 当前档=at 的验证/保持步→省略（推导为 maintain，测后仍 at 即闭合，掉档=倒退直拒）。⚠ 显式写错仍拒（at 档写 improve=maintainGate 直拒，那是逃避保持义务）。⚠ 两条高频拒因前置：①引 probe:<key> 的预测——值内数字必须出现在该探针实跑 output（引旧探针=拒，拒语自带台账尾供换引）；②回滚后同签名重 declare 直拒——改 title/来源/不变式任一再宣。兼容 v0.2 全量形状（含 measure/law 直传）。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title'],
      properties: {
        title: { type: 'string', description: '本动作名（闭合按此落账）' },
        group: { type: 'string', description: '归属组（合同内标题；动作不预排——归属即组落账口径）' },
        predict: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' }, source: { type: 'string' } } }, description: '先算出来的预测（source 缺=declareStep 既定规则 直拒）' },
        channels: { type: 'array', items: { type: 'string' }, description: '测量通道标识（<2 → 第5闸重流程判定，非绕闸）' },
        invariants: { type: 'array', items: { type: 'string' } },
        law: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['signal', 'action'], properties: { signal: { type: 'string' }, action: { type: 'string' } } } },
        cost: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['failure', 'defense'], properties: { failure: { type: 'string' }, defense: { type: 'string' }, weight: { type: 'string' } } } },
        right: { type: 'string' }, wrong: { type: 'string' },
        vExpect: { type: 'string', enum: ['improve', 'dip', 'maintain'] },
        dipPlan: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      // v0.5.12 方案A 自动立项（声明即合同）：无合同→首个声明物化合同；有合同→目标锁校验
      let s = loadState(sid) || initMode()
      let auto = false
      if (!s.cost || !s.cost.aligned) {
        const preds = Array.isArray(args?.predict) ? args.predict : []
        const purpose = '自动立项（声明即合同）：' + String(args?.title || '未名声明')
        const assertions = preds.map((p) => ({ text: String(p.key) + '=' + String(p.value), severity: 'major', source: String(p.source || 'prior:自动立项') }))
        s = { ...s, cost: { purpose, assertions, nonGoals: [], assumptions: [], aligned: true }, groups: [], stage: 'rolling', lockedPromises: preds.map((p) => ({ key: String(p.key), value: String(p.value) })) }
        saveState(sid, s)
        auto = true
      } else {
        for (const p of (args?.predict || [])) {
          const hit = (s.lockedPromises || []).find((l) => l.key === String(p.key))
          if (hit && String(hit.value) !== String(p.value)) throw new Error('目标漂移：承诺 ' + hit.key + '=' + hit.value + ' 不可改（改=回滚重推；新增键/同值允许）')
        }
      }
      if (s.stage !== 'rolling') throw new Error(`declare 仅在执行阶段段（rolling）——当前=${s.stage}；先 freeze+确认`)
      const top = stackTop(loadStack(sid))
      if (top && top.status === 'open' && top.title !== String(args?.title || '').trim()) throw new Error(`栈顶「${top.title}」未闭合——闭合即推进，禁开新动作（写闸）`)
      const fullForm = args?.measure && Array.isArray(args.measure.channels) && Array.isArray(args?.law) && Array.isArray(args?.predictions || args?.predict) && (args?.predictions || args?.predict).every((p) => p.source)
      let contract, admission = 'full', notes = []
      if (fullForm) {
        contract = { ...args, predictions: args.predictions || args.predict }
      } else {
        const m = materialize(controlSurface(s), args)
        if (!m.ok) throw new Error(m.error)
        contract = m.contract
        admission = m.admission
        notes = m.notes
      }
      contract.ticketBand = controlSurface(s).residual.lastBand || null // r48 定界：闸只看本票合同内权威档
      // v0.8.36 债闸：已升级的债（猜错过）只能用世界还——同 claimKey 的非实证来源直拒（第一次猜放行）
      const _dg = refuseGuess(s.debts || [], contract.predictions || [])
      if (_dg.refuse) {
        noteFriction(sid, 'declare', 'world-debt')
        onDeclareReject({ reason: 'world-debt' })
        throw new Error(`这笔债只能用世界还：${_dg.items.map((x) => x.key).join('、')}——去拿实证（还债优先级 ${cheapestRepay()}）`)
      }
      const r = declareStep(sid, contract)
      if (!r.ok) {
        noteFriction(sid, 'declare', r.error)
        onDeclareReject({ reason: String(r.error || '').slice(0, 60) })
        // v0.5.2 索取单落盘：来源纪律拒=缺料清单入 s.demands（跨拍续追，醒来不重发明问题）
        if (/来源纪律/.test(r.error || '')) {
          try {
            const sd = loadState(sid)
            if (sd && sd.stage !== 'off') {
              const list = sd.demands || []
              if (!list.some((x) => x.text === r.error)) list.push({ text: String(r.error).slice(0, 200), at: Date.now(), age: list.length ? (list[list.length - 1].age || 0) + 1 : 0 })
              saveState(sid, { ...sd, demands: list.slice(-5) })
            }
          } catch { /* 索取单落盘失败不阻断拒回执 */ }
        }
        // v0.8.37 诚信留痕：伪造测量/冒充证据=硬边界违规（落盘提交开发者）
        if (/探针台账缺 key|伪造|冒充/.test(r.error || '')) { try { recordTrust({ sid, kind: 'violation', detail: String(r.error).slice(0, 200) }) } catch { /* 留痕失败不阻断拒回执 */ } }
        throw new Error(r.error + (/来源纪律/.test(r.error || '') ? `\n⏳ 索取单已挂账（缺料清单落盘，后续回执续追）` : ''))
      }
      // v0.8.36 债账：非实证来源建债；带实证来源的断言清偿同 claimKey 旧债（债由「拿到的东西」还）
      try {
        const sd0 = loadState(sid)
        if (sd0 && sd0.stage !== 'off') {
          let db = recordDebts(sd0.debts || [], r.step.predictions, Date.now())
          const evid = (r.step.predictions || []).filter((p) => isEvidential(p && p.source))
          if (evid.length) db = dischargeDebts(db, evid.map((p) => p.key), sourceKind(evid[0].source))
          saveState(sid, { ...sd0, debts: db })
        }
      } catch { /* 债账失败不阻断声明 */ }
      // 索取单解决位：declare 通过=料齐了，销单并在回执记数（不静默）
      let demandNote = ''
      try {
        const sd2 = loadState(sid)
        if (sd2 && sd2.demands && sd2.demands.length) { demandNote = `\n✓ 索取单销账×${sd2.demands.length}（declare 通过=缺料已补）`; saveState(sid, { ...sd2, demands: [] }) }
        else if (sd2 && sd2.demands && sd2.demands.length === 0 && sd2.lastDemandCleared) { /* noop */ }
      } catch { /* 销单失败不阻断 */ }
      const lowNote = r.step.confidence === 'low' ? '\n⚠ 可辨识性=低：停下交分歧点，不得硬实现。' : ''
      const dipNote = r.step.vExpect === 'dip' ? '\n⚠ dip 已登记：回升义务挂账，下一闭合步必须改善。' : ''
      const maintainNote = r.step.vExpect === 'maintain' ? '\n⚠ maintain 已登记：本步闭合条件=测后仍 at（保持目标态验证，无回升义务；测后掉档=倒退直拒）。' : ''
      // v0.8.26 推导来源明示（省略 vExpect 时引擎按档位推导——不再是猜）
      const veNote = r.step.vExpectSource === 'derived' ? `\nvExpect=${r.step.vExpect}（未填→引擎按当前档推导；想改判就显式写，写错仍拒）` : `\nvExpect=${r.step.vExpect}（显式声明）`
      const ss = r.sourceStats || { read: 0, probe: 0, prior: 0, engram: 0 }
      const srcLine = `来源：read×${ss.read} probe×${ss.probe} engram×${ss.engram || 0} prior×${ss.prior}` + (ss.prior > 0 ? `（⚠ 显式先验×${ss.prior}：诚实先验可引，预言失效风险自负——能升 read:/probe:/engram: 就升）` : '') + ((r.sourceHits || []).length ? `\n${r.sourceHits.join('\n')}` : '')
      // v0.8.36 债读数：非实证断言=欠世界的债（无债零注入）
      let debtNote = ''
      try { const _dl = debtLine(loadState(sid)?.debts || []); if (_dl) debtNote = '\n' + _dl } catch { /* 债账不可读=零注入 */ }
      // v0.4.3 口径对齐辅助（引 probe: 时现场出示台账证据——引用时刻即核对时刻，防上下文漂移后抄错键/错位值）
      const probeEvi = []
      for (const p of r.step.predictions) {
        const src = String(p.source || '')
        if (src.startsWith('probe:')) { // key 语义与引擎闸同一真相（probe: 后 trim 全串）
          const e = loadProbes(sid)[src.slice(6).trim()]
          const key = src.slice(6).trim()
          const out = String(e?.output || '')
          const hit = out.includes(String(p.value))
          probeEvi.push(hit ? `探针 ${key} ✓（引用值「${p.value}」在案）` : `探针 ${key} ✗（引用值「${p.value}」未在 output——闸应已拒）: …${String(out).slice(-160)}`)
        }
      }
            const mism = []
      for (const p of r.step.predictions) {
        const src = String(p.source || '')
        if (src.startsWith('probe:')) {
          const e = loadProbes(sid)[src.slice(6).trim()]
          if (e?.output && !String(e.output).includes(String(p.value))) mism.push(src.slice(6).trim() + '「' + p.value + '」')
        }
      }
      const eviLine = probeEvi.length ? '\n' + probeEvi.join('\n') + (mism.length ? '\n⚠ 引用值没有出现在探针实跑输出里（' + mism.join('；') + '）——引用值必须逐字来自实跑 output；注意证据只留尾 160 字，可对 probe_record 台账全文核对' : '') : ''
      // v0.6.29 刀三师傅行：同型基线（有史才出，无史零注入——引导税花在交互时刻）
      let masterLine = ''
      try { const bl = baselineLine(loadStack(sid).steps, r.step.predictions); if (bl) masterLine = '\n' + bl } catch { /* 基线不可得=零注入 */ }
      // v0.6.4 近场锚 live 案底修：引擎 step 无 group 字段（活卡逮到组名/判据渲染空）——组名从 args 补进锚视图
      const nf = nearField(s, { ...r.step, group: String(args?.group || '').trim() || r.step.group }, (s.closed || []).length ? s.closed[s.closed.length - 1] : null)
      onDeclareSuccess({ predictions: r.step.predictions.length, channels: r.step.measure.channels.length })
      try {
        const latest = loadState(sid) || s
        const taskState = buildTaskState({ sid, model: getModelFingerprint(), state: latest, stack: loadStack(sid), purpose: latest.cost?.purpose, assertions: latest.cost?.assertions })
        bindActualAction({ taskState, actionKind: 'declare', actionTitle: r.step.title })
      } catch { /* 归因账故障不影响真实 declare */ }
      return { ok: true, text: (auto ? `✅ 已自动立项（声明即合同）：承诺 ${(s.cost.assertions || []).length} 条。
` : '') + `✅ 动作「${r.step.title}」已声明（open·准入=${admission}）。预测 ${r.step.predictions.length}、通道 ${r.step.measure.channels.length}、law ${r.step.law.length}（含基行）、beforeBand=${controlSurface(s).residual.lastBand || 'far'}（引擎直读）。${srcLine}${debtNote}${demandNote}${notes.length ? '\n' + notes.join('\n') : ''}${eviLine}${lowNote}${dipNote}${maintainNote}${veNote}${masterLine}\n${nf}` }
    },
  }
}

export function optimalConvergeDefinition() {
  return {
    name: 'optimal_converge',
    description: '【闭环·收敛 v0.8 结构判定】对账入参：**只用 agreedPairs[{key,measured,predicted,channel}]**（全结构化，零格式战）；agreed 字符串仅兼容旧账本写法（新写法一律对象入参）。吻合判定=按 key 抽实测值并与**声明值**核数（含该 key、实测有数字、与声明数值相等；空话/占位词=无数值实证即拒，行内复述换数=拒）。② ΔV 严格降（beforeBand=引擎实读，at 档保持步须 declare 时 vExpect=maintain→闭合条件=测后仍 at）× ③ dv.channels≥2 且 **ref 互不相同**：独立性看真实测量对象，换标签不算异源（同源即拒）；ref 对上探针台账/路径/命令者入栈记 evidenced。⚠ discrepancies 语义（r68 误用案底）：**只装"预测与实测不符"的误差报告**——塞入任何一条即本步预言作废触发回滚义务，它不是备注栏；过程说明放文本汇报，判据修订走『修改』通道。可选 group+closeGroup（机械门：栈闭合齐+cmd 判据落账时全绿+redteam 逐动作审 pass 才 settled；坏判据在 decompose 提交时已 dry-run 预检，此处不复查格式只跑红绿）。closed → recordClosed 自动续账；redteam 组回执携机械审材→fresh 子代理审后 audit_record 回账。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['dv'],
      properties: {
        agreed: { type: 'array', items: { type: 'string' } },
        agreedPairs: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'measured', 'predicted'], properties: { key: { type: 'string', description: '预测 key（逐字对应 declare 的 predict[].key）' }, measured: { type: 'string', description: '真实读数（左值）' }, predicted: { type: 'string', description: 'declare 时的预测值' }, channel: { type: 'string', description: '测量通道（可选）' } } }, description: 'v0.6.29 结构化对账（推荐——零格式战）：工具自渲染合规行「key: 实测 A ≠ 预测 B（通道）」，格式错误从可能变不可能' },
        discrepancies: { type: 'array', items: { type: 'string' }, description: '⚠ 作废申报（不是备注栏）：只装「预测与实测不符」的误差报告——塞入任何一条=本步预言作废+回滚义务（r68 案底×8）。过程说明放你的文本汇报，判据修订走『修改』通道' },
        group: { type: 'string', description: '本动作归属组（recordClosed 口径）' },
        closeGroup: { type: 'boolean', description: '该组由本动作收尾（触发机械落账门）' },
        dv: { type: 'object', additionalProperties: false, required: ['beforeBand', 'measuredBand', 'channels'], properties: { beforeBand: { type: 'string', enum: ['far', 'near', 'at'] }, measuredBand: { type: 'string', enum: ['far', 'near', 'at'] }, channels: { type: 'array', items: { type: 'string' } } } },
        disposition: { type: 'string', enum: ['continue', 'turn', 'repair', 'stop'], description: '偏差处置（自评，v0.8.37）：continue=继续 / turn=拐弯 / repair=下一步修 / stop=暂停；有偏差时必须给——偏差是观察不是判决，处置权在你' },
        reason: { type: 'string', description: '处置理由（一句话，记入账本）' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      // r60 修复注入：band 闸的 V 权威值=收敛前对合同断言的实时测量（跑不了=null 不拦，宁放不误伤同 ticketBand 纪律）
      try { const mv = measureReads(mustState(sid), undefined, sessionCwd(exec)); args.ticketV = mv && Number.isFinite(mv.V) ? mv.V : undefined } catch { }
      // v0.6.32 刀二：converge 语义裁判（混合三路）——正则失败行问一次裁判（match 则补渲染合规行，
      // 标注原句供审计）；无 key/裁判故障=正则保底（引擎零感知）。证据锚不豁免（declare 时已机械验）。
      try {
        const j = getJudge()
        if (j && Array.isArray(args?.agreed) && args.agreed.length) {
          const top = stackTop(loadStack(sid))
          if (top && top.status === 'open') {
            const extras = []
            for (const p of (top.predictions || []).filter((x) => /\d/.test(String(x.value)))) {
              const item = args.agreed.find((a) => String(a).includes(p.key))
              if (!item) continue
              if (agreedMatch(String(item), p.key, p.value).ok) continue // 正则快路已过，零成本
              const v = await j({ key: String(p.key), value: String(p.value), line: String(item) })
              if (v && v.match) extras.push(`${p.key}: 实测 ${p.value} ≠ 预测 ${p.value}（通道: 语义裁判——原句「${String(item).slice(0, 30)}」${v.reason ? '；裁判：' + v.reason : ''}）`)
            }
            if (extras.length) args = { ...args, agreed: [...extras, ...args.agreed] }
          }
        }
      } catch { /* 裁判层故障=正则保底 */ }
      const r = convergeStep(sid, { ...(args || {}), selfScore: true })
      if (!r.ok) { noteFriction(sid, 'converge', r.error); onConvergeReject({ reason: String(r.error || '').slice(0, 60) }); throw new Error(r.error) }
      // v0.8.36 债的清偿与升级：吻合/带实证→清偿；失配→升级（这笔债只能用世界还）
      try {
        const sd = loadState(sid)
        if (sd && sd.stage !== 'off' && Array.isArray(sd.debts) && sd.debts.length) {
          const keys = (r.step.predictions || []).map((p) => p.key)
          // v0.8.37：有偏差=这批断言没被测量兑现 → 债升级（与是否闭合无关）；无偏差=清偿
          if ((r.step.deviations && r.step.deviations.length) || (r.step.discrepancies && r.step.discrepancies.length)) saveState(sid, { ...sd, debts: escalateDebts(sd.debts, keys) })
          else if (r.step.status === 'closed') saveState(sid, { ...sd, debts: dischargeDebts(sd.debts, keys, 'measure') })
        }
      } catch { /* 债账失败不阻断对账 */ }
      if (r.step.status !== 'closed') {
        const list = (r.step.discrepancies || []).map((x) => '  ✗ ' + x).join('\n')
        // v0.5.0 档位即时降（风险不对称：声称被测量证伪=装完成案底，直降 T0 不隔夜）
        try {
          const sd = loadState(sid)
          if (sd && sd.stage !== 'off') { saveState(sid, { ...sd, rank: { ...demoteOnFake(sd.rank), at: Date.now() } }); }
        } catch { /* 降档失败不阻断预言失效主回执（诚实位：留痕于 rank 缺位） */ }
        return { ok: true, text: `⚠️ 动作「${r.step.title}」预言失效（${r.step.discrepancies.length} 不吻合）：\n${list}\nrollback 重推 → 重 declare（同签名直拒）。禁止修补冲刺。\n${rankLine({ T: 0, demoted: true }, null)}${(() => { const eg = (r.step.predictions || []).map((p) => String(p.source || '')).filter((x) => x.startsWith('engram:')).map((x) => x.slice(7).trim()); return eg.length ? `\n📌 本步引了图谱锚点 ${eg.join('、')} 且被测量证伪——建议图侧标 disputed（模型誊写 engram_update，协议不直写图 R15；记忆是先验从不是证据，冲突测量赢）` : '' })()}` }
      }
      let s = mustState(sid)
      const gTitle = String(args?.group || '').trim()
      s = { ...s, dipPending: loadStack(sid).steps.some((x) => x.pendingDip && x.dv && x.dv.after !== 'at') } // #B 修复：顶层挂账位与栈同步（饱和 dip 不计）
      let vr = null
      try { vr = measureReads(s, undefined, sessionCwd(exec)) } catch { vr = null } // v0.4-S1：基数 V 并显（测量失败=不显不阻断）
      const rc = recordClosed(s, { title: r.step.title, group: gTitle, band: r.step.dv?.after, v: vr ? vr.V : undefined, at: Date.now() })
      if (rc.ok) {
        s = rc.state
        // v0.6.0 J_hat 影子账本：每闭分录 {dtMin, v, tok:盲区标注}——ΔV 走测量内核，tok 腿批算后补（诚实位）
        const last = s.closed[s.closed.length - 1]
        if (last) last.J = { dtMin: Math.max(0, Math.round((Date.now() - (r.step.at || Date.now())) / 6000) / 10), v: vr ? vr.V : null, tok: 'blind(batch)' }
      }
      const g = s.groups.find((x) => x.title === gTitle)
      let briefNote = ''
      if (g && g.verify === 'redteam') {
        try {
          const stackRaw = readFileSync(optimalFileFor(sid), 'utf8')
          const b = auditBrief({ stackRaw, targetTitle: r.step.title, cost: s.cost, stackPath: optimalFileFor(sid) })
          briefNote = b.ok ? `\n【另头审·引擎备材】派 fresh 子代理直读栈文件审推导链（审材如下），回执原样交 audit_record(title, verdictText)：\n---\n${b.brief}\n---` : `\n【另头审备材异常】${b.error}`
        } catch (e) { briefNote = `\n【另头审备材异常】${e.message}` }
      }
      const notes = []
      if (args?.closeGroup && gTitle) {
        const tgt = s.groups.find((x) => x.title === gTitle)
        if (tgt) { tgt.closeRequested = true; notes.push(`组「${gTitle}」请求落账`) }
        // v0.8.15 漏传 cwd 案底：此处曾走 trySettleGroups 的默认 process.cwd()（宿主目录），
        // 判据里的相对路径必然落到 C:\Users\Administrator —— 与 terminal_check 的调用点不一致。
        const tr = await trySettleGroups(s, loadStack(sid).steps, await extractSigns(exec), sessionCwd(exec))
        s = tr.state
        notes.push(...tr.notes)
      }
      saveState(sid, s)
      claimGuidance(sid, { terminal: s.stage === 'final' }) // 回执含残差+下一步指引：认领之，注入不再重复
      const surf = controlSurface(s)
      const head = `✅ 动作「${r.step.title}」closed（吻合 ${r.step.agreed.length} + ΔV ${r.step.dv.before}→${r.step.dv.after}）= 账面锚点 · 剩余未落账组=${surf.residual.groupsOpen.length}·已闭=${surf.residual.closedCount}`
      const dispLine = dispositionLine((r.step.deviations || []).length, r.step.disposition && r.step.disposition.call, r.step.disposition && r.step.disposition.reason)
      const vLine = vr ? `📏 实测计分=${vr.V}（已测断言 ${vr.green}/${vr.total}·z=[${vr.zs.join(', ')}]${vr.errs && vr.errs.length ? `·⚠ 读数失败诊断: ${vr.errs.join(' | ')}` : ''}——未测投影不入 V，output feedback 诚实位）` : ''
      let devLn = ''
      try { devLn = deviationLine(r.step) } catch { /* 偏差不可算=零注入 */ }
      // v0.6.34 P2-1：组内动作全闭合但未 closeRequested → 收尾提示（机械可判，防「组永不落账」静默陷阱）
      let closeHint = ''
      try {
        if (!args.closeGroup) {
          const stk = loadStack(sid)
          const gs = (loadState(sid)?.groups || []).filter((g) => g && !g.settled && !g.closeRequested)
          for (const g of gs) {
            const inG = stk.steps.filter((x) => x.group === g.title)
            if (inG.length && inG.every((x) => x.status === 'closed') && !inG.some((x) => x.status !== 'closed')) { closeHint = `\n⚑ 组「${g.title}」动作已全闭合——若本步即该组收尾：下步 converge 带 closeGroup=true 落账（组不落账的静默陷阱由此提示防住）`; break }
          }
        }
      } catch { /* 提示不可算=零注入 */ }
      // v0.6.34 档位进度行（P2-3 激励面：样本/距 T1 线可见——攒信任的曲线不再隐形）
      let rankProg = ''
      try {
        const cc2 = computeC(s, loadStack(sid))
        if (cc2 && typeof cc2.C === 'number') { const gap = Math.max(0, 45 - cc2.C); rankProg = `\n📈 档位进度：样本 ${cc2.n || 0}/8 · C=${cc2.C} · 距 T1 线（C≥45）${gap ? `差 ${gap}` : '已达标'}（再犯罚已含）${cc2.slips ? `；措辞层回炉 ${cc2.slips} 不计信誉` : ''}` }
      } catch { }
      onConvergeSuccess({ step: r.step.title, dv: r.step.dv ? `${r.step.dv.before}→${r.step.dv.after}` : 'n/a' })
      return { ok: true, text: [head, dispLine, vLine, devLn, rankProg, closeHint, briefNote, notes.join('\n'), s.stage === 'final' ? '全链落账 → terminal_check 归零。' : ''].filter(Boolean).join('\n') }
    },
  }
}

export function auditRecordDefinition(name = 'audit_record') {
  return {
    name,
    description: name === 'audit_record'
      ? '【审·回账】fresh 子代理审毕，原样回执交此硬验：引文必须是栈文件**逐字子串**（伪造即拒）+ verdict pass|reject（reject 必附 issues）+ ≤1KB。pass → 落账 closed[].audit；redteam 组的落账门据此放行。手动自演（cost_audit 别名）同形同闸——审方也得真读盘。'
      : '【审·手动修订道】与 audit_record 同形同闸（引文硬验不豁免自演）：scope 已废——title 精确匹配动作名。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['title', 'verdictText'],
      properties: {
        title: { type: 'string', description: '被审动作名' },
        verdictText: { type: 'string', description: '审方回执原文（含 JSON：verdict/issues/quotes）' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      let stackRaw = ''
      try { stackRaw = readFileSync(optimalFileFor(sid), 'utf8') } catch { throw new Error('栈文件不可读——审材不存在') }
      const p = parseVerdict({ stackRaw, verdictText: String(args?.verdictText || '') })
      if (!p.ok) throw new Error(`回执不合审契约：${p.error}`)
      const rec = recordAuditVerdict(s, String(args?.title || '').trim(), p.verdict)
      if (!rec.ok) throw new Error(rec.error)
      let s2 = rec.state
      const notes = [`审落账：「${args.title}」verdict=${p.verdict.verdict}（rounds=${s2.closed.find((c) => c.title === args.title)?.audit?.rounds}）`]
      if (p.verdict.verdict === 'reject') notes.push('打回义务：修复后**再审**（新引文），过审前该组落账门不开。')
      const tr = await trySettleGroups(s2, loadStack(sid).steps, await extractSigns(exec), sessionCwd(exec))
      s2 = tr.state
      notes.push(...tr.notes)
      saveState(sid, s2)
      // v0.4.1-F5：审后 V 重锚——审计 verdict 翻转审类断言读数（z 0→1），不重测则 V 曲线冻结在审前值
      // （dogfood R1 F5：终态 V=0 未落锚，曲线讲「卡死在 4」的假话）。重测在盘档落账后执行（测量脚本读盘）。
      // 至多两通：第 1 通写入锚、第 2 通在锚已写状态重测——bootstrap 边缘（锚自身断言依赖锚在位，
      // 单通会留下「锚值含自身未满足权重」；两通=稳定值。已稳定时第 2 通重写同值无副作用，成本=测量命令 2 次）。
      const hitT = String(args?.title || '').trim()
      if (s2.closed.some((c) => c.title === hitT)) {
        let lastVr = null
        for (let pass = 1; pass <= 2; pass++) {
          const vr = measureReads(s2, undefined, sessionCwd(exec))
          if (!vr) break
          s2 = { ...s2, closed: s2.closed.map((c) => (c.title === hitT ? { ...c, vAfterAudit: vr.V } : c)) }
          saveState(sid, s2)
          lastVr = vr
        }
        if (lastVr) notes.push(`📏 V 重锚=${lastVr.V}（审后重测 z=[${lastVr.zs.join(', ')}]——V 曲线以重测值为锚，闭合值 v=${s2.closed.find((c) => c.title === hitT)?.v ?? '?'} 留作历史）`)
      }
      claimGuidance(sid, { terminal: s2.stage === 'final' })
      return { ok: true, text: notes.join('\n') + (s2.stage === 'final' ? '\n全链落账 → terminal_check 归零。' : '') }
    },
  }
}

export function optimalRollbackDefinition() {
  return {
    name: 'optimal_rollback',
    description: '【闭环·回滚】撤销栈顶（open/invalidated；closed=锚点不可撤）。reason=重推 产物（哪个推导错了）；cause=结构化归因（model=推理/措辞错·计入信誉与返工；external=外部变更；process-death=进程被杀；deliberate=故意验闸——后三者不计）；同签名重 declare 直拒（既定规则 局部式——引擎位）。',
    parameters: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', description: '≥8 字：错在哪层（预测来源/权重/状态定义/偏差策略）' }, cause: { type: 'string', enum: ['model', 'external', 'process-death', 'deliberate'], description: '结构化归因（缺省=model，计入）。别再靠 reason 里写「外部」二字让下游正则识别' } } },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const reason = String(args?.reason || '').trim()
      if (reason.length < 8) throw new Error('rollback 需要 reason ≥8 字（可审计——看不出为何撤=白滚）')
      const r = rollbackStep(sid, reason, args?.cause)
      if (!r.ok) throw new Error(r.error)
      onRollback()
      return { ok: true, text: `↩️「${r.step.title}」已撤（原=${r.step.status}）。重 declare 须带新模型签名（来源/权重/不变式至少一易）。` }
    },
  }
}

export function optimalStackDefinition() {
  return {
    name: 'optimal_stack',
    description: '【栈】动作栈+V 时间线+回炉史（审材邻域切片的数据源；全量展示仍是可用通道，常驻面已不依赖它）。',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
    output: OUT,
    async execute(_args, exec) {
      const sid = sidOf(exec)
      return { ok: true, text: stackText(loadStack(sid)) }
    },
  }
}

export function reviseDoDefinition() {
  return {
    name: 'revise_do',
    description: '【形态修订·组级 v0.3】开发期改组默认执行形态 do（登记 doHistory 轨迹）；verify（核对承诺）只读——审强度不因形态变化打折。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['group', 'do'],
      properties: {
        group: { type: 'string' },
        do: { type: 'string', enum: ['self', 'subagent', 'workflow', 'daemon', 'mixed'] },
        reason: { type: 'string' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      const g = s.groups.find((x) => x.title === String(args?.group || '').trim())
      if (!g) throw new Error('组不在合同内')
      if (!['self', 'subagent', 'workflow', 'daemon', 'mixed'].includes(args?.do)) throw new Error('do 枚举无效：self|subagent|workflow|daemon|mixed（输入门面拒，不入库）')
      const from = g.do || 'self'
      g.do = args.do
      g.doHistory = [...(g.doHistory || []), { at: Date.now(), from, to: args.do, reason: String(args?.reason || '') }]
      saveState(sid, { ...s, groups: s.groups.map((x) => (x.title === g.title ? g : x)) })
      return { ok: true, text: `组「${g.title}」执行形态 ${from}→${args.do}（verify 未动，审史在账）` }
    },
  }
}

/** 探针 token 提取（v0.8.18 协议化）：列 `key=value` 供模型对齐语义。
 *  旧正则 `(\d+(?:\.\d+)?)` 不含符号位与指数——`x=-0.5` / `y=1e3` 取不到（台账漏值，模型照抄错）。
 *  返回 ['key=value', ...]（值原样保留，不做数值归一——这里只负责「看见」。 */
export function probeTokens(out) {
  const toks = []
  const s = String(out ?? '')
  // ① `key=value`（任意键）；② `key: value`（键须以字母/下划线/CJK 开头——避免把时间戳 12:30 当 token）
  for (const m of s.matchAll(/([^\s=:：,，。;；()（）\[\]【】]+)=([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g)) toks.push(`${m[1]}=${m[2]}`)
  for (const m of s.matchAll(/([A-Za-z_\u4e00-\u9fa5][^\s=:：,，。;；()（）\[\]【】]*)[:：]\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g)) toks.push(`${m[1]}=${m[2]}`)
  return toks
}

/** 交付反馈取证（v0.8.18 协议化）：返回 { result, via } 或 { error }。
 *  ① JSON 信封 {"closedloop":{"delivery":"accepted"}}——零散文猜测；
 *  ② 散文「交付反馈 accepted」——取**全部**命中并归一大小写/分隔符（旧实现 first-match-wins + 保留原大小写：
 *     「交付反馈 Accepted」拿到 'Accepted' 与参数 'accepted' 不等=误拒；「不是交付反馈 accepted，而是 rejected」
 *     取到 accepted=记错质量）。多个不同结果词=含混，拒收不猜。 */
export function parseDeliveryAttestation(text) {
  const t = String(text || '')
  const env = parseDeliveryEnvelope(t)
  if (env) return { result: env, via: 'json' }
  const hits = new Set()
  for (const m of t.matchAll(/(?:交付反馈)[\s:：=]*([A-Za-z_]+)/g)) {
    const w = String(m[1] || '').toLowerCase()
    if (!DELIVERY_RESULTS.includes(w)) continue
    // 否定式前缀（「不是交付反馈 accepted」）=该命中作废，不当作证据
    const before = t.slice(Math.max(0, m.index - 6), m.index)
    if (/不|非|没|未|\bnot\b|\bno\b/i.test(before)) continue
    hits.add(w)
  }
  if (hits.size === 0) return { result: null, via: null }
  if (hits.size > 1) return { error: `交付反馈取证含混：真人帧里出现多个结果词（${[...hits].join('、')}）——请明确只留一个（或改用信封 {"closedloop":{"delivery":"accepted"}}）` }
  return { result: [...hits][0], via: 'text' }
}

/** 开发者交付反馈：工具参数不是证据，必须有同会话最近真人帧的固定结果语法。 */export function deliveryFeedbackDefinition() {
  return {
    name: 'delivery_feedback',
    description: '记录开发者对已终验交付的真实结果：result=accepted|needed_fix|rejected，可选 postDeliveryDefect/note。模型参数不是开发者结果证据：调用前最近一条真人消息必须逐字含「交付反馈 accepted」「交付反馈 needed_fix」或「交付反馈 rejected」之一，且结果必须一致；无真人帧、未终验或不一致一律拒绝。未收到反馈的终验只记 self_checked，不冒充 accepted。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['result'],
      properties: {
        result: { type: 'string', enum: ['accepted', 'needed_fix', 'rejected'], description: '开发者实际交付结果，必须与最近真人帧中的固定结果词一致' },
        postDeliveryDefect: { type: 'boolean', description: '交付后发现缺陷时为 true' },
        note: { type: 'string', description: '开发者补充说明，最多 500 字' },
      },
    },
    output: OUT,
    async execute(args, exec) {
      const sid = sidOf(exec)
      const s = mustState(sid)
      if (s.stage !== 'final' || !s.terminalReport?.zero) throw new Error('交付反馈只能关联已 terminal_check 归零的当前任务——未终验不能写结果账本')
      const requested = String(args?.result || '')
      let latest = ''
      try {
        const messages = await exec?.agent?.session?.deriveMessages?.()
        for (const m of [...(messages || [])].reverse()) {
          if (!m || m.role !== 'user' || m.source?.kind !== 'user' || !m.source?.rpcId) continue
          latest = typeof m.content === 'string' ? m.content : (m.content || []).map((x) => x?.text || '').join(' ')
          break
        }
      } catch { /* 无真人帧=下面 fail closed */ }
      // v0.8.18 取证协议化：信封优先；散文取全部命中并归一大小写/分隔符；含混=拒收（不猜）
      const att = parseDeliveryAttestation(latest)
      if (att.error) throw new Error(att.error)
      const attested = att.result
      if (!attested) throw new Error('交付反馈缺真人证据：开发者先发「交付反馈 accepted」或「交付反馈 needed_fix/rejected」（亦可发信封 {"closedloop":{"delivery":"accepted"}}），模型不能替开发者确认结果')
      if (attested !== requested) throw new Error(`交付反馈结果不一致：真人帧=${attested}，工具参数=${requested}——只认真人帧`)
      const taskState = buildTaskState({ sid, model: getModelFingerprint(), state: s, stack: loadStack(sid), purpose: s.cost?.purpose, assertions: s.cost?.assertions })
      const rec = recordBoundOutcome({ taskState, finalQuality: requested, postDeliveryDefect: args?.postDeliveryDefect === true, note: args?.note || '' })
      if (!rec) throw new Error('交付反馈缺实际动作绑定：本单尚无已采取候选，不能把开发者结果广播给候选快照')
      return { ok: true, text: `✅ 开发者交付反馈已入账：${rec.finalQuality}${rec.postDeliveryDefect ? '；交付后缺陷=是' : ''}。该结果优先于系统自检，已关联实际动作 ${rec.candidateId}。` }
    },
  }
}

export function terminalCheckDefinition() {
  return {
    name: 'terminal_check',
    description: '终端归零检查：全部组落账+栈无未闭动作+无挂账——通过则出归零报告，不通过给处置。',
    parameters: { type: 'object', additionalProperties: false, required: [], properties: {} },
    output: OUT,
    async execute(_args, exec) {
      const sid = sidOf(exec)
      let s = mustState(sid) // v0.5.0 案底修：档位评估需回写 s，const 重赋值=TypeError（E2E 抓，catch 曾吞成"评估异常"）
      // v0.8.31 支付通道：终检时先把本会话真人签收帧入账（「签收 <组名>」/「签收全部」）
      s = payIOU(s, await extractSigns(exec))
      const enterRank = s.rank // 进场档位：本单规则（归档/面板/自动放行）由开环时的信任档决定，与 verify 降级口径一致
      const rep = terminalCheck(s.cost, loadStack(sid), s, s.stage)
      // v0.5.0 档位器官：单末评估（C 从盘账复算非自评；滞回升降；碎拍冻结；T3 提示位）
      let rankNote = ''
      try {
        const cc = computeC(s, loadStack(sid))
        const next = rankTransition(s.rank, cc.C, s, cc.n)
        s = { ...s, rank: { ...next, C: cc.C, at: Date.now() } } // s 非 const（E2E 案底：const 重赋值 TypeError 被 catch 吞成"评估异常"）
      if ((next.T ?? 0) < (((s.rank && s.rank.T) || 0)) && ((loadState(sid) || {}).groups || []).some((g) => g && g.autoRelaxed)) { s = recoverRelaxed(s, next); saveState(sid, s); rankNote += '\n⚠ 降档即收回：autoRelaxed 组恢复 user 硬门' }
      if (rep.ok) recordAbility({ closed: ((s.closed || []).length), groups: ((s.groups || []).length), weight: ((s.cost && (s.cost.assertions || []).reduce((x, a) => x + ({ catastrophic: 4, major: 2, minor: 1 }[a.severity] || 1), 0)) || 0) })
        rankNote = `\n${rankLine(s.rank, cc.C)}`
      } catch (e) { rankNote = `\n🎖 档位评估异常（不阻断归零主回执）：${String(e && e.message || e).slice(0, 80)}` } // 留痕不静默（face-spam 纪律）
      saveState(sid, { ...s, terminalReport: { at: Date.now(), ...rep } })
      let head = rep.zero
        ? `✅ 终端归零：断言 ${(s.cost.assertions || []).length} 条·闭合动作=${rep.closedSteps}·组落账=齐`
        : `⚠ 终端未归零（交处置）：未落账组=${rep.unsettledGroups.join('、') || '无'}；未闭动作=${rep.openSteps.join('、') || '无'}；dip=${rep.dipPending}`
      // v0.6.35 摩擦账本实况行（隐形税首次可测——终检时读一手读数；v0.6.36 修：head 须 let——const 重赋值被 try 吞=账实不符案底）
      try { const fl = frictionLine(sid); if (fl) head = head + '\n' + fl } catch { /* 账本不可读=零注入 */ }
      // v0.8.37 诚信台账（开发者可见）：伪造/绕过/误判落盘并在归零回执汇总
      try { const ts = trustSummary({ sid }); if (ts) head = head + '\n' + ts } catch { /* 台账不可读=零注入 */ }
      // v0.7.0 闸接线：归零→progress 闸正效果 + 质量账本自动记录
      if (rep.zero) { try { onTerminalZero({ s, stack: loadStack(sid), frictionSummary: frictionSummary(sid), sid }) } catch { /* 闸记录失败不影响归零 */ } }
      // v0.4.6 环铸记忆写路径：归零即出蒸馏草稿；r29 学习含量门（判定住 pricing-organ）：仪式单免提
      const hasLearning = learningContent(s, loadStack(sid))
      const draft = rep.zero ? (hasLearning ? distillDraft(s, loadStack(sid)) : '🧪 本单无新案（仪式单草稿免提——经验已走 DESIGN-LOG/案底链；誊写只候多步或带回炉的单）') : null
      // v0.5.5 归零自动盖章：spawn 独立 stamper 进程（R18 层2 接线；红/缺/败全部留痕不静默）
      let stampNote = ''
      let priceNote = '' // v0.6.0 影子定价外层声明（if 内 IIFE 赋值；非归零保持空串不显示）
      if (rep.zero) {
        const stamper = process.env.DSH_STAMPER_JS || ''
        try {
          if (!stamper || !existsSync(stamper)) stampNote = '\n🔏 stamper 缺席——无外部凭证（装法：DSH_STAMPER_JS 指向签名脚本）'
          else stampNote = '\n🔏 ' + String(execFileSync(process.execPath, [stamper, 'stamp', sid], { timeout: 15000, encoding: 'utf8' })).trim()
        } catch (e) { stampNote = `\n🔏 盖章被拒（链红=篡改信号，交人审）：${String(e?.stdout || e?.message || e).trim().slice(0, 120)}` }
      }
      // v0.6.0 影子定价：观测计算归位 pricing-organ.observeSession（判定不住接线层），此处纯接线
      priceNote = (() => {
        if (!rep.zero) return '\n🧮 影子定价：未归零不记账（残差会话不进成本账——测量内核说了算）'
        try {
          const dir = optimalDir()
          const pr = loadPricing(dir)
          const obs = observeSession(s, loadStack(sid))
          const rec = recordSession(pr, obs)
          if (rec.rejected) return `\n🧮 影子定价：观测被拒（${rec.rejected}）`
          const sc = shadowC(pr, obs.g, obs.dtMin, obs.dV)
          pr.pairs = (pr.pairs || []).concat([{ shadowC: sc ?? 0, trueQ: obs.dV / obs.dtMin, at: Date.now(), band: gBandName(gBandOf(obs.g)) }]).slice(-400) // r30 分层门水管：band/at 戳从入账起就在
          const sw = evaluateSwitch(pr, pr.pairs)
          // ④活体半区：已实价且体检不过 → 自动回影子止血（案底计数，重新达标可再切——双向都无人闸）
          let demoNote = ''
          if (pr.real) {
            const hh = evaluateHealth(pr)
            if (!hh.ok) { pr.real = false; pr.demotions = (pr.demotions || 0) + 1; pr.demotionLog = [...(pr.demotionLog || []), { at: Date.now(), why: hh.note }].slice(-10); demoNote = ` ｜⟲回影子止血：${hh.note}（第${pr.demotions}次，达标可再切）` }
          }
          // 每 50 单触发离线再校准（analyze-real→双制重跑；detached 不卡 terminal）
          if (pr.gates.records % 10 === 0 && process.env.DSH_RECALIBRATE_JS) { try { spawn(process.execPath, [process.env.DSH_RECALIBRATE_JS], { detached: true, stdio: 'ignore' }).unref() } catch { /* 缺脚本=下次 */ } }
          savePricing(dir, pr)
          return `\n🧮 ${sw.real ? '定价已切实（判据达标）' : '影子定价'}：g=${obs.g}步 ΔV≈${obs.dV.toFixed(1)} 时距${obs.dtMin.toFixed(0)}min 炉${obs.rbCount} frag=${obs.fragRed ? '红' : '净'} | C_shadow=${sc ?? '冷启动'} | ${sw.note}${demoNote}`
        } catch (e) { return `\n🧮 影子定价异常（不阻断归零）：${String(e?.message || e).slice(0, 60)}` }
      })()
      const archiveNote = (enterRank && enterRank.T >= 2) ? '\n✅ 已自动归档（T2：导演可回望，无需签收）' : ''
      const panelLine = '\n🎛 导演面板：档位 T' + ((enterRank && enterRank.T) || 0) + '·能力 ' + readAbilities().length + ' 单·抽审 ' + ((s.groups || []).filter((g) => g && g.auditSampled).length) + ' 组'
      const honorLine = (() => {
        // v0.8.31 口径换血：人判项=欠据（必须真人签收），不再是"挂账可审计"（池核案底）
        const open = (rep.openIOU || [])
        const total = (s.groups || []).reduce((n, g) => n + ((g.accept || []).filter((x) => String(x).startsWith('人判:')).length), 0)
        if (total === 0) return ''
        if (open.length === 0) return `\n✅ 人判欠据 ${total} 条已由开发者签收（可追：state.iou.paidAt）`
        return `\n⏳ 未归零：${open.length} 条人判欠据待开发者签收——机器部分已齐，人判部分不许自认通过：\n`
          + open.map((e) => `  · [${e.group}] ${cut(e.text, 70)}`).join('\n')
          + `\n  付清方式：回「签收全部」或「签收 <组名>」（真人帧；模型自写不算）`
      })()
      const head2 = (() => {
        const open = (rep.openIOU || [])
        if (rep.zero || open.length === 0) return head
        if (rep.unsettledGroups.length || rep.openSteps.length || rep.dipPending) return head
        return `⏸ 未归零：${open.length} 条人判欠据待开发者签收（机器部分已齐）`
      })()
      return { ok: true, text: head2 + `\n目的：${cut(rep.purpose, 60)}` + archiveNote + panelLine + honorLine + rankNote + stampNote + priceNote + (draft ? `\n\n${draft}` : '') }
    },
  }
}