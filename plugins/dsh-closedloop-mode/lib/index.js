/**
 * index — dsh-closedloop-mode v0.4.0 插件入口（fiber/路由骨架继承 v0.2，注入面换血）。
 *
 * v0.3 注入纪律（既定规则 + 教育=违规事件）：
 *   - 讲课件全部废除；rolling 每步只注 propose-text.stateFace（盘档机械生成的最小状态面，
 *     幂等键=残差读数本身——closedCount/栈顶态变化才重注）；
 *   - weights 段注 weightsFace 评审单一次；
 *   - 「确认/修改」文本扫描**覆盖 weights 与 rolling 全段**（v0.2 只接 review 段的缺陷修复，a2）；
 *   - 栈顶 open/invalidated 的写闸提醒=一行编译器式短句（条款细节在工具拒绝文本里，不复读）；
 *   - v0.4.0 阻尼外环（THEORY §3.6）：rolling 段盘上 V 序列信号（平台 I/震荡 D/高 V P）触发时
 *     至多多注一行短句；无信号=静默（零仪式税）；幂等键=信号组合（dampingSignal 纯函数可测，触发留痕）；
 *     V 序列取每动作最终态读数（vAfterAudit ?? v——审后重锚优先，F5 同源）。
 *
 * v0.4.2 来源纪律（dogfood R1 分型数据驱动：18 条 重推 中预言失效 13/72%——
 * 先验估算/未先实测/源读不全/机制外推的共同形式=自由文本 source 冒充标准）：
 *   - 预测 source 四形式闸（declare 直拒+教语法）：read:<path>#L<n> 读锚点（引擎核验文件在位+行存在非空）
 *     / probe:<key> 探针台账（probe_record 实跑落 output，预测值数字必须出现于 output——伪造测量直修）
 *     / prior:<text> 显式先验（计数展示，不静默当标准）；自由文本=隐式先验直拒。
 *     / engram:<title> 图谱锚点（v0.4.6 学习环读路径：只读核验 engram-relay 盘档，confirmed 才放行——
 *     engram 确认制=记忆信任级免费闸 R15；回执带 summary 回显，引用时刻即核对时刻）。
 *   - v0.4.6 环铸记忆写路径：terminal 归零回执附蒸馏草稿（propose-text.distillDraft 机械成稿——
 *     引擎起草、模型誊写 engram_propose、确认制入图；观测者不代写记忆）。
 *   - 新工具 probe_record（十三名）：先实测后预测——探针台账=测量证据盘，declare 时引擎机械复验。
 *
 * v0.4.5 语义错配案底三补丁（R3/R4/R5 四次现场，用户拍板「先完善必要问题」）：
 *   - probe_record 携 stderr 尾（R3 案底：路径猜错→stdout 空、病因全在没抓的 stderr）
 *   - 彻底静默失败（exit≠0 且 std 皆空）回执当场提示直跑复现，别对着空台账猜
 *   - cost_set 挂 measure 时回执带 dry-run 纪律一行（四坑清单：路径实测/布尔vs计数/正则插入语/ESM file:///）——只在挂时出现，零仪式税
 *   （人工介入计数面按用户指令撤销）
 *
 * v0.4.1 dogfood R1 三修（全自动体验单实测摩擦，零用户确认跑通 18 条归因分型+fresh 另头审全链）：
 *   - F1 autoConfirm 直认优先（settings.autoConfirm=true → freeze 不弹窗直接确认开执行阶段，
 *     修 0.3.2「弹窗劫持授权」回归：autoConfirm 曾是弹窗被取消后的回退，授权被弹窗截胡）；
 *   - F2 测量读数失败诊断携脚本 stdout 尾行（真实 FAIL 原因入诊断，非截断命令）；
 *   - F5 audit_record 审后重测 V 并重锚（vAfterAudit 字段，条件展开防键漂移；
 *     redteam 审计翻转断言读数后 V 曲线讲真话——终态归零必须落锚）。
 */
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  initMode, loadState, saveState, serializeState, STAGE_SEMANTICS, controlSurface, treeText,
  trigger, deactivate, loadConceptLimit, loadVerifyMode, onWeightsConfirmed, onWeightsUnlock,
  stateFileFor, stateDirFor, readAutoConfirm,
} from './mode-state.js'
import { loadStack, stackTop, vLadderOf, optimalDir } from './optimal-engine.js'
import { gateWrite } from './write-gate.js'
import { noteFriction } from './friction-organ.js'
import { onWriteGateDeny, onWriteGateAllow } from './gate-wiring.js'
import { gateAmbientLine, PHASE_FOCUS } from './gate-ambient.js'
import { lqrReadout } from './lqr-organ.js'
import { getModelFingerprint } from './gate-core.js'
import { PERSONA } from './persona.js'
import { claim, release } from './quota-organ.js'
import { stateFace, weightsFace, stepReminder, batchConfirmLine } from './propose-text.js'
import { offReceipt, VERSION } from './inject-text.js'
import {
  costSetDefinition, decomposeDefinition, freezeDefinition, measureProposeDefinition, probeRecordDefinition, optimalDeclareDefinition,
  optimalConvergeDefinition, auditRecordDefinition, auditDispatchDefinition, optimalRollbackDefinition,
  optimalStackDefinition, reviseDoDefinition, deliveryFeedbackDefinition, terminalCheckDefinition, SEVERITY_W,
} from './tools.js'
import { detectPlateau, detectOscillation, detectHighV, dampingLine } from './v04-damping.js'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-closedloop-mode'

/** 工具集唯一真相（v0.5.4：十四名，audit_dispatch 入列——宿主轮转派发消选择偏差；注册漂移 warn 兜底）。 */
export const TOOL_NAMES = ['super_task_completion_mode', 'decompose', 'freeze', 'measure_propose', 'probe_record', 'optimal_declare', 'optimal_converge', 'audit_record', 'cost_audit', 'audit_dispatch', 'optimal_rollback', 'optimal_stack', 'revise_do', 'delivery_feedback', 'terminal_check']
export const inject = ['commands', 'userQuestions', 'webServer', 'tools', 'agents', 'sessions']
export const Config = z.object({ autoStart: z.boolean().default(true), writeGate: z.boolean().default(true) }) // r67 autoStart 默认开启：首条真人任务在发给模型前自动接管；仅显式 false 才关闭。writeGate 默认开。
/** 真人帧判类器（介入率同源）：kind=user+rpcId，排 goal 自动续单与 plugin 注入帧。 */
export function isHumanFrame(ev) {
  const s = ev?.data?.source
  return !!s && s.kind === 'user' && !!s.rpcId && !s.goalId
}

const defaultDshHome = () => join(process.env.HOME || process.env.USERPROFILE || '.', '.dsh')

function userMsg(text) {
  return {
    id: 'closedloop-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
    role: 'user',
    source: { kind: 'plugin', plugin: name },
    content: [{ type: 'text', text }],
  }
}

/** 截断显示（v0.4-S1 补定义——此前写闸短句引用未定义的 cut，ReferenceError 被
 *  外层 catch 静默吞掉 → saveState 永不执行 → face 幂等标记丢失 → 每步重注刷屏。
 *  案底：session b74630b0 用户实拍 face-spam，scanLog/injected 双证定谳）。 */
const cut = (s, n) => {
  const x = String(s || '')
  return x.length > n ? x.slice(0, n) + '…' : x
}

/** 在 decision.messages 最后一条真实 user 消息之后插入注入（前置位语义，继承 v0.2）。 */
function spliceInjection(decision, msg) {
  if (!decision || !Array.isArray(decision.messages)) return
  let at = decision.messages.length
  for (let i = decision.messages.length - 1; i >= 0; i--) {
    if (decision.messages[i] && decision.messages[i].role === 'user') { at = i + 1; break }
  }
  decision.messages.splice(at, 0, msg)
}

/** 最近活跃 v3 盘档（重启零等待恢复）。 */
function latestStateSid() {
  try {
    const dir = stateDirFor()
    let best = null, bestM = -1
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.closedloop.json'))) {
      const m = statSync(join(dir, f)).mtimeMs
      if (m > bestM) { bestM = m; best = f.replace(/\.closedloop\.json$/, '') }
    }
    return best
  } catch { return null }
}

/** 确认/修改意图（纯函数可测；修改优先——v0.2 语义继承）。导出供 a2 测例。 */
export function scanIntent(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const wantReject = /修改|拒绝|取消|不同意|建议|改成|改为|调整为|调整|reject/i.test(t)
  if (wantReject) return 'reject'
  if (/确认|通过|同意|确定|继续|开工|开始|approve|confirm|ok/i.test(t)) return 'approve'
  return null
}

/** v3 审统计（面板/审计共用，纯函数）：逐动作审轮次与 pending。 */
export function auditStat(s) {
  const rt = { rounds: 0, passed: 0, rejected: 0, pending: 0 }
  for (const c of s?.closed || []) {
    if (c.audit) {
      rt.rounds += c.audit.rounds || 0
      if (c.audit.last?.verdict === 'pass') rt.passed++
      if (c.audit.last?.verdict === 'reject') rt.rejected++
    }
  }
  for (const g of s?.groups || []) {
    if (g.verify !== 'redteam' || g.settled) continue
    rt.pending += (s.closed || []).filter((c) => c.group === g.title && !(c.audit && c.audit.last?.verdict === 'pass')).length
  }
  return rt
}

/** 面板体（v3 形状，纯函数可测——effect 与测试同一源，防"测的是副本"）。只读聚合，零写盘。 */
export function panelBody(sid, s, stack) {
  if (!sid || !s || s.stage === 'off') return { ok: false, error: '无激活会话' }
  const ladder = vLadderOf(stack.steps)
  const os = (stack.steps || []).filter((x) => x.status === 'open').pop()
  const surf = controlSurface(s)
  return {
    ok: true, v: 3, sid, stage: s.stage, weightsLocked: s.weightsLocked,
    openStep: os ? { n: os.n, title: os.title } : null,
    vLadder: { run: ladder.run, dipPending: ladder.dipPending },
    residual: surf.residual, groupsBrief: surf.groups.map((g) => ({ ...g, closedActs: s.closed.filter((c) => c.group === g.title).length })),
    audit: auditStat(s),
    modelState: { model: null, paramsSource: '内置默认（模型层参数接线=后续参数块）' },
  }
}

/** 注入幂等决策（v0.3.1 提取为可测纯函数）：键=残差读数本身，同键不重注。 */
export function faceDecision(s, top) {
  const key = 'face:' + ((s && s.closed && s.closed.length) || 0) + ':' + (top ? top.n + top.status : 'idle')
  return { key, inject: !(s && s.injected && s.injected.has(key)) }
}

/** v0.4.0 阻尼信号面（纯函数可测）：V 序列=盘档 closed[] 机械直读（模型无口头空间）。
 *  v0.4.1-F5 同源：每动作取最终态读数（vAfterAudit ?? v——审后重锚优先；v=闭合时刻历史值）。
 *  IOU 借据账本尚未入盘档（v0.4 探针暂纯函数）→ iouSurge 静默=诚实位，无信号不装。
 *  幂等键=信号组合本身——同态不重注（face-spam 案底纪律：键=状态读数，非步数）。 */
export function dampingSignal(s) {
  const vs = (s?.closed || []).filter((c) => typeof c.v === 'number' || typeof c.vAfterAudit === 'number').map((c) => (typeof c.vAfterAudit === 'number' ? c.vAfterAudit : c.v))
  if (vs.length === 0) return null
  const totalW = (s?.cost?.assertions || []).filter((a) => a.measure && a.measure.cmd).reduce((acc, a) => acc + (SEVERITY_W[a.severity] ?? 1), 0)
  const plateau = detectPlateau(vs).plateau
  const oscillating = detectOscillation(vs).oscillating
  const highV = detectHighV(vs[vs.length - 1], totalW).high
  const line = dampingLine({ plateau, oscillating, iouSurge: false, highV })
  if (!line) return null
  return { line, key: 'damp:' + (plateau ? 1 : 0) + (oscillating ? 1 : 0) + (highV ? 1 : 0) }
}

// readAutoConfirm 单一真相已移 mode-state.js（v0.4.1-F1：index 与 tools freeze 共用——授权读取零拷贝）

export function apply(ctx, config) {
  let activeSid = null
  const offArmed = new Map() // off 双确认窗口（v0.3.1⑥：单条命令误触不清账）
  function backupPersisted(sid) {
    try {
      const f = stateFileFor(sid)
      if (existsSync(f)) writeFileSync(f.replace(/\.closedloop\.json$/, '') + '.closedloop.bak-' + Date.now() + '.json', readFileSync(f))
    } catch { /* 备份失败不阻断 */ }
  }
  const state = (sid) => loadState(sid) || initMode()
  const setState = (sid, s) => saveState(sid, s)

  function clearPersisted(sid) {
    try {
      mkdirSync(stateDirFor(), { recursive: true })
      writeFileSync(stateFileFor(sid), JSON.stringify(serializeState(initMode())), 'utf-8')
    } catch { /* 幂等 */ }
  }

  /* ---------- 只读端点（v3 形状；旧键尽量映射保面板不白屏——#24 全面板适配） ---------- */

  ctx.effect(() => {
    const d = ctx.webServer.register({
      kind: 'prefix', path: '/graded-mode/api',
      handler: async (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams.get('sid')
        const sid = q || activeSid || latestStateSid()
        const s = sid ? state(sid) : initMode()
        const surf = controlSurface(s)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          ok: true, sid, v: 3,
          stage: s.stage, task: s.task, cost: s.cost, stageSemantics: STAGE_SEMANTICS[s.stage] || null,
          weightsLocked: s.weightsLocked, residual: surf.residual, closed: surf.closed,
          groups: surf.groups, audit: auditStat(s),
          fingerprint: createHash('sha1').update(JSON.stringify(serializeState(s))).digest('hex').slice(0, 16),
          total: s.groups.length, done: s.groups.filter((g) => g.settled).length,
          sidShort: sid ? String(sid).replace(/^session-/, '').slice(0, 8) : null,
        }))
      },
    }, 'closedloop: state api')
    return () => d()
  })

  ctx.effect(() => {
    const d = ctx.webServer.register({
      kind: 'prefix', path: '/graded-mode/api/panel',
      handler: async (req, res) => {
        const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)) }
        try {
          const q = new URL(req.url, 'http://x').searchParams.get('sid')
          const sid = q || activeSid || latestStateSid()
          const s = sid ? state(sid) : null
          const body = sid && s && s.stage !== 'off' ? panelBody(sid, s, loadStack(sid)) : { ok: false, error: '无激活会话' }
          send(body) // 恒 200：前端只看 body.ok，404 化会在每个未激活会话的 console 刷红字噪音
        } catch (e) { send({ ok: false, error: String(e?.message || e) }, 500) }
      },
    }, 'closedloop: panel api')
    return () => d()
  })

  ctx.effect(() => {
    const d = ctx.webServer.register({
      kind: 'prefix', path: '/graded-mode/api/audit',
      handler: async (req, res) => {
        const q = new URL(req.url, 'http://x').searchParams.get('sid')
        const sid = q || activeSid || latestStateSid()
        const s = sid ? state(sid) : initMode()
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          ok: true, sid, v: 3,
          fingerprint: createHash('sha1').update(JSON.stringify(serializeState(s))).digest('hex').slice(0, 16),
          closed: s.closed.length, groups: s.groups.length, settled: s.groups.filter((g) => g.settled).length,
          audit: auditStat(s),
          settings: { conceptLimit: loadConceptLimit(sid), verifyMode: loadVerifyMode(sid) },
        }))
      },
    }, 'closedloop: audit api')
    return () => d()
  })

  ctx.effect(() => {
    const d = ctx.webServer.register({
      kind: 'prefix', path: '/graded-mode/api/sessions',
      handler: async (_req, res) => {
        try {
          const dir = stateDirFor()
          const list = readdirSync(dir).filter((f) => f.endsWith('.closedloop.json')).map((f) => {
            const id = f.replace(/\.closedloop\.json$/, '')
            const s = state(id)
            return { sid: id, stage: s.stage, task: (s.task || '').slice(0, 40), mtime: statSync(join(dir, f)).mtimeMs }
          }).sort((a, b) => b.mtime - a.mtime)
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, sessions: list }))
        } catch (e) { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: String(e) })) }
      },
    }, 'closedloop: sessions api')
    return () => d()
  })

  /* ---------- 工具注册（十二名全局常驻；execute 磁盘权威；v0.4.0：measure_propose 补位——S1 曾声明 12 名而 defs 只挂 11，启动即 drift warn） ---------- */

  const deps = {
    getState: state,
    setState,
    // v0.6.24 废除程序化派发（摩擦报告 F6 案底：audit-11024c5e 新建会话无绑定代理=零 token 挂死+谎报
    // launched——v0.5.4 R17 的 dispatch 函数整体移除；审计走单卡+subagent 工具转交（回执=子代理最终消息回流）。
    // v0.3.2 确认=结构化弹窗：多选 + 补充文本同交；无 UI 通道时回退文本/autoConfirm
    // Bug（session 06dcbf00 turn 4）: subagent 调用 askUser → runtime 抛 CALLER_NOT_LIVE
    // 修复：调用前检查 agent.session——subagent 直接走文本回退，不触发 runtime 异常
    async askUser(agent, s) {
      // CALLER_NOT_LIVE 硬验：subagent/DELEGATED 不出弹窗，直接回退
      if (!agent || agent.session?.id === undefined) {
        return { answers: [], error: 'CALLER_NOT_LIVE（无活跃会话）' }
      }
      try {
        return await ctx.userQuestions.ask({
          questions: [{
            id: 'closedloop-contract-review',
            question: `合同已锁：Q_N×${(s.cost?.assertions || []).length}·组×${(s.groups || []).length}·非目标×${(s.cost?.nonGoals || []).length}。确认开执行阶段，还是反驳重排？（可点选并在补充框写具体意见）`,
            header: '闭环合同评审',
            detail: [weightsFace(s ? controlSurface(s) : {}), treeText(s)].join('\n'),
            options: [
              { label: '确认·开执行阶段', description: '按此权重进入每步实时定序' },
              { label: '反驳·解锁重排', description: '回标定态改权重/组结构，已闭账不丢' },
            ],
            multi_select: true,
            intent: { kind: 'plan-review', approve: '确认·开执行阶段' },
          }],
          agent,
        })
      } catch (e) {
        const msg = String(e?.message || e)
        console.warn('[closedloop] askUser failed（回退文本/autoConfirm 通道）:', msg)
        return { answers: [], error: msg }
      }
    },
  }

  // 真人帧会话登记（v0.8.1 绕环免费闸）：有真人帧=主会话，未入环写盘要拦；
  // 无真人帧=委派干活（子代理），照旧免闸。pre-step 每拍先于模型动作跑，写盘时必已登记。
  const humanTurnSids = new Set()

  ctx.effect(() => {
    const disposers = []
    const defs = [costSetDefinition({ name: 'super_task_completion_mode' }), decomposeDefinition(), freezeDefinition(deps), measureProposeDefinition(), probeRecordDefinition(), optimalDeclareDefinition(), optimalConvergeDefinition(), auditRecordDefinition('audit_record'), auditRecordDefinition('cost_audit'), auditDispatchDefinition(), optimalRollbackDefinition(), optimalStackDefinition(), reviseDoDefinition(), deliveryFeedbackDefinition(), terminalCheckDefinition()]
    const got = defs.map((d) => d.name)
    if (got.join(',') !== TOOL_NAMES.join(',')) console.warn('[closedloop] 注册清单与 TOOL_NAMES 漂移:', got.join(','))
    for (const def of defs) {
      try { const d = ctx.tools.register(def); if (d) disposers.push(d) } catch (e) { console.warn('[closedloop] tool register failed:', def.name, e?.message || e) }
    }
    // v0.6.27 写闸（导演拍板「一起上」）：全局 pre-execute 守卫——写类工具（write/edit）仅当
    // 「rolling+已冻结+有 open 步」放行；无盘档会话（子代理干活）不闸；闸自身异常=放行不砖人。
    // 宿主接口：ctx.tools.guard(exec=>reason?)（dsh-tools 单调守卫，effect 托管重载即清）。
    if (config.writeGate !== false) {
      try {
        const dGuard = ctx.tools.guard((exec) => {
          try {
            const sid = exec?.agent?.session?.id
            if (!sid) return undefined
            const reason = gateWrite({
              toolName: exec.name,
              state: loadState(sid),
              hasOpenStep: stackTop(loadStack(sid))?.status === 'open',
              hasHumanTurn: humanTurnSids.has(sid),
              autoStartDisabled: config.autoStart === false,
            })
            if (reason) {
              try { noteFriction(sid, 'write-gate', reason) } catch { /* 记账失败不打断 */ }
              try { onWriteGateDeny({ tool: exec.name, reason: reason.slice(0, 60) }) } catch { /* 闸记录失败不影响拦截 */ }
            } else {
              try { onWriteGateAllow({ tool: exec.name }) } catch { /* 闸记录失败不影响放行 */ }
            }
            return reason
          } catch (e) { console.warn('[closedloop] 写闸内部异常（放行不砖人）:', String(e?.message || e).slice(0, 80)); return undefined }
        })
        if (dGuard) disposers.push(dGuard)
      } catch (e) { console.warn('[closedloop] 写闸注册失败（本进程无闸）:', String(e?.message || e).slice(0, 80)) }
    }
    return () => { for (const d of disposers) { try { d() } catch { /* 幂等 */ } } }
  }, 'closedloop: global tools')

  ctx.on('dispose', () => { activeSid = null })

  /* ---------- 命令 /graded（名字保留=用户肌肉记忆；v0.3 语义） ---------- */

  ctx.commands.register({
    name: 'optimal',
    description: '最优律闭环：/optimal <任务> 开单（Q_N→组冻结→执行阶段实时定序）；off/status。',
    input: { hint: '[<任务描述>|off|status]' },
    handler: (invocation) => {
      const agent = invocation.agent
      if (!agent?.session?.id) return { kind: 'error', text: 'no agent session' }
      const sid = agent.session.id
      activeSid = sid
      const raw = String(invocation.rawInput || '').trim()
      const first = raw.split(/\s+/)[0] || ''
      if (first === 'off') {
        const cur = state(sid)
        if (cur.stage === 'off') return { kind: 'success', text: '已是关闭态（零副作用）。' }
        if (!offArmed.has(sid)) {
          offArmed.set(sid, Date.now())
          console.log(`[closedloop] OFF armed sid=${String(sid).slice(-8)} stage=${cur.stage}（v0.3.1⑥双确认，10s 窗口）`)
          return { kind: 'success', text: `⚠ 关闭将清状态面（当前 stage=${cur.stage}；账本栈保留，状态面自动备份）。确认请 10 秒内再发一次 /optimal off。` }
        }
        offArmed.delete(sid)
        backupPersisted(sid)
        setState(sid, deactivate()); clearPersisted(sid)
        try { release(optimalDir(), String(sid)) } catch { /* 配额自清兜底 */ }
        console.log(`[closedloop] OFF executed sid=${String(sid).slice(-8)} via=command（已备份）`)
        try { agent.followup(userMsg(offReceipt())) } catch { /* 不阻断 */ }
        return { kind: 'success', text: `闭环协议已关闭（v${VERSION}）。账本保留，状态面已备份可恢复。` }
      }
      if (first === 'status') {
        const s = state(sid)
        return { kind: 'success', text: `闭环 v${VERSION}: ${s.stage}（${STAGE_SEMANTICS[s.stage] || '?'}｜权重${s.weightsLocked ? '已锁' : '未锁'}｜动作 closed ${s.closed.length}/${s.groups.length} 组）` }
      }
      const task = raw.replace(/^(?:[\\/|@])?(?:optimal|graded|分级)\s*[:：]?\s*/, '').trim()
      setState(sid, trigger(state(sid), task))
      const taskHint = task.length > 0 ? `\n任务：${task}` : ''
      try { agent.followup(userMsg('【超级任务完成模式·启动】先停一下，不要直接生成或写文件。第一拍先查看工具与工作区，确认已有材料和缺失信息；然后说明目标、完成标准和验证方式，再开始推进。若缺信息、权限或判断，先向开发者索取，不要猜。' + taskHint)) } catch { /* 不阻断 */ }
      return { kind: 'success', text: `闭环协议触发（v${VERSION}）：标定→组冻结→确认→执行阶段每步实时定序。任务：${task.slice(0, 60)}` }
    },
  })

  /* ---------- 文本通道触发（@graded / 分级任务:） ---------- */

  ctx.on('session/event', (session, event) => {
    if (!session?.id || event?.type !== 'user/message') return
    let txt = ''
    for (const x of (event.data?.content || [])) if (x?.type === 'text') txt += x.text || ''
    const m = txt.match(/^(?:[\\/@])(?:optimal|graded|分级)\s*[:：]?\s*(.+)/s)
    if (m && state(session.id).stage === 'off' && !['off', 'status'].includes(m[1].trim())) {
      setState(session.id, trigger(state(session.id), m[1].trim()))
    } else if (config.autoStart && isHumanFrame(event) && state(session.id).stage === 'off' && txt.trim().length >= 12) {
      // r67 完全体：预设开环——真人首条消息即入环（任务=消息本身；≥12 字防空话误开；goal/plugin 帧不触发）
      setState(session.id, trigger(state(session.id), txt.trim().slice(0, 200)))
    }
  })

  /* ---------- pre-step：触发 / off / 全段确认-修改扫描（a2 修复主体） / 最小状态面注入 ---------- */

  ctx.on('agent/pre-step', async ({ agent, messages }, next) => {
    const sid = agent?.session?.id
    let offJustNow = false
    let startupNeeded = false
    const startupGuidance = '【超级任务完成模式·第一拍】任何任务先做这一件事：调用工具 super_task_completion_mode 立合同——说明目的、什么算完成、拿什么验证（断言逐条带来源；缺信息/权限/判断先向开发者索要，不要猜）。然后 decompose 分组（判据写可跑命令 cmd: 或人判:）+ freeze 开执行。之后每步：先 optimal_declare 声明这一步的预测数字与验证方式，再实现，最后 optimal_converge 真实对账。侦察（read/probe/搜索）全程随时可用。'
    if (sid !== undefined) {
      activeSid = sid
      let s = state(sid)
      // 真人帧登记：写闸据此区分「主会话绕环裸写」与「子代理委派干活」
      if ((messages || []).some((m) => m && m.role === 'user' && m.source && m.source.kind === 'user' && m.source.rpcId)) humanTurnSids.add(sid)
      // 首轮防漏接管：若 session/event 未及时送达，pre-step 仍在模型生成前补开环。
      // 只认真实开发者消息，且只在空态、非命令、非插件/目标续单帧触发。
      if (config.autoStart !== false && s.stage === 'off') {
        const firstHuman = [...(messages || [])].reverse().find((m) => m && m.role === 'user' && !(m.source && m.source.kind === 'plugin') && !m.goalId)
        let firstText = ''
        if (typeof firstHuman?.content === 'string') firstText = firstHuman.content
        else for (const x of (firstHuman?.content || [])) if (x && typeof x === 'object' && x.type === 'text') firstText += x.text || ''
        const clean = firstText.trim()
        if (clean.length >= 12 && !/^(?:[\\/@])(?:optimal|graded|分级)\b/i.test(clean)) {
          setState(sid, trigger(s, clean.slice(0, 200)))
          s = state(sid)
          startupNeeded = true
          console.log(`[closedloop] autoStart pre-step fallback sid=${String(sid).slice(-8)}（首轮生成前接管）`)
        }
      }
      let task = null
      // v0.3.1 幻影 off 真凶修复：只评估最近一条真实用户消息（旧版全史扫描——命令回显永久滞留，
      // 每步重扫到就重执行 off，两次清账皆源于此）；off 双确认与命令通道同闸
      for (let i = (messages || []).length - 1; i >= 0; i--) {
        const m = messages[i]
        if (!m || m.role !== 'user' || (m.source && m.source.kind === 'plugin')) continue
        let txt = ''
        if (typeof m.content === 'string') txt = m.content
        else for (const x of (m?.content || [])) if (x && typeof x === 'object' && x.type === 'text') txt += x.text || ''
        const hit = txt.match(/^(?:[\\/@])(?:optimal|graded|分级)\s*[:：]?\s*(.+)/s) // 正/反斜杠 & @ & 中英触发；graded 兼容别名
        if (hit) {
          const arg = hit[1].trim()
          if (arg === 'off') {
            if (offArmed.has(sid) && Date.now() - offArmed.get(sid) < 10000) {
              offArmed.delete(sid); backupPersisted(sid)
              setState(sid, deactivate()); clearPersisted(sid); offJustNow = true
              try { release(optimalDir(), String(sid)) } catch { /* 配额自清兜底 */ }
              console.log(`[closedloop] OFF executed sid=${String(sid).slice(-8)} via=text（已备份）`)
            } else {
              offArmed.set(sid, Date.now())
              console.log(`[closedloop] OFF armed sid=${String(sid).slice(-8)} via=text（双确认窗口）`)
            }
          } else if (s.stage === 'off') { task = arg }
        }
        break
      }
      if (task !== null) setState(sid, trigger(state(sid), task))
      // 全段可逆扫描（v0.2 缺陷修复：不只 review 段）——weights 与 rolling 都接确认/修改
      const st = state(sid)
      if (st.stage === 'weights' || st.stage === 'rolling' || st.stage === 'final') {
        for (let i = (messages || []).length - 1; i >= 0; i--) {
          const m = messages[i]
          if (!m || m.role !== 'user' || (m.source && m.source.kind === 'plugin')) continue
          let txt2 = ''
          if (typeof m.content === 'string') txt2 = m.content
          else for (const x of (m?.content || [])) if (x && typeof x === 'object' && x.type === 'text') txt2 += x.text || ''
          const t = txt2.trim()
          const intent = (!t || t.length > 200) ? null : scanIntent(t)
          // scanLog：扫描看见了什么落盘可查（v0.3.1④——「继续」不翻转这类问题从猜测变成读账）
          setState(sid, { ...state(sid), scanLog: { at: Date.now(), len: t.length, intent, stage: st.stage, head: t.slice(0, 24) } })
          if (intent === 'reject' && st.stage !== 'final') {
            setState(sid, onWeightsUnlock(state(sid)))
            console.log('[closedloop] weights/rolling unlocked by text (a2)')
          } else if (intent === 'approve' && st.stage === 'weights') {
            setState(sid, onWeightsConfirmed(state(sid)))
            console.log('[closedloop] contract confirmed by text')
          }
          break
        }
      }
      // autoConfirm（v0.3.1 用户授权「完全自主」通道）：weights 段 + settings.autoConfirm=true → 自动确认留痕
      if (state(sid).stage === 'weights' && readAutoConfirm()) {
        setState(sid, { ...onWeightsConfirmed(state(sid)), scanLog: { at: Date.now(), intent: 'autoConfirm', stage: 'weights', head: 'settings.autoConfirm' }, freezeAck: { at: Date.now(), via: 'autoConfirm-prescan' } })
        console.log('[closedloop] auto-confirmed（provenance=settings.autoConfirm，用户授权 2026-09-04「跳过确认环节完全自主」）')
      }
    }
    const decision = await next()
    try {
      if (agent?.session?.id === undefined) return decision
      const sid2 = agent.session.id
      let s = state(sid2)
      if (s.stage === 'off') {
        if (offJustNow) { offJustNow = false; spliceInjection(decision, userMsg(offReceipt())) }
        return decision
      }
      // v0.6.31 绝对入口（开发者定向）：环一开（任意通道：autoStart / /optimal / 启动模式）→
      // 启动人格首注一次/会话（幂等键 persona-entry）——persona 不再藏在 cost_set 回执里。
      if (!s.injected.has('persona-entry')) {
        s.injected.add('persona-entry')
        spliceInjection(decision, userMsg(PERSONA))
        console.log(`[closedloop] persona-entry sid=${String(sid2).slice(-8)}（绝对入口首注）`)
      }
      if (startupNeeded || (s.stage === 'brainstorm' && !s.injected.has('startup-guidance'))) {
        s.injected.add('startup-guidance')
        spliceInjection(decision, userMsg(startupGuidance))
        console.log(`[closedloop] startup-guidance sid=${String(sid2).slice(-8)}（第一拍指引）`)
      }
      // weights 评审单一次
      if (s.stage === 'weights' && !s.injected.has('weights-review')) {
        s.injected.add('weights-review')
        spliceInjection(decision, userMsg(weightsFace(controlSurface(s)) + '\n（回复『确认』开执行阶段；『修改』解锁重排）'))
      }
      // rolling 最小状态面：幂等键=残差读数本身（faceDecision 纯函数可测；标记落盘=持久）
      if (s.stage === 'rolling') {
        const top = stackTop(loadStack(sid2))
        const fd = faceDecision(s, top)
        if (fd.inject) {
          // v0.5.5 协作式配额：face 字节先记账，超总预算该拍不注（节流留痕；防模型不防插件，诚实位）
          let faceText = stateFace(controlSurface(s))
          // v0.7.2 Phase4 学习环闭合：读三层权重→低命中闸一行成长提醒（无则零注入；失败静默不碰主路）
          try {
            const _top = stackTop(loadStack(sid2))
            const _phase = _top && _top.status === 'open' ? 'converge' : 'declare'
            const gline = gateAmbientLine({ model: getModelFingerprint(), focusGates: PHASE_FOCUS[_phase], phase: _phase === 'converge' ? '对账前' : '声明前' })
            if (gline) faceText = faceText + '\n' + gline
          } catch { /* 学习环读侧失败=零注入，绝不影响主面 */ }
          // v0.7.3 Phase7 任务级 LQR 读数：候选+依据+预期供模型自选（不替选；冷启动标未校准；失败静默）
          try {
            const _lqr = lqrReadout({ sid: sid2, state: controlSurface(s), stack: loadStack(sid2), model: getModelFingerprint(), purpose: s.cost?.purpose, assertions: s.cost?.assertions, recordSnapshot: true })
            if (_lqr) faceText = faceText + '\n' + _lqr
          } catch { /* LQR 读数失败=零注入 */ }
          // v0.8.3 批确认诚实行：连续 at→at 时把「批量贴标签」摆到台面（只事实，不拦）
          try {
            const _bc = batchConfirmLine(loadStack(sid2))
            if (_bc) faceText = faceText + '\n' + _bc
          } catch { /* 批确认行失败=零注入 */ }
          const qr = claim(optimalDir(), String(sid2), Buffer.byteLength(faceText, 'utf8'))
          if (qr.granted) {
            s.injected.add(fd.key)
            console.log(`[closedloop] face inject ${fd.key} sid=${String(sid2).slice(-8)} markers=${s.injected.size}`)
            spliceInjection(decision, userMsg(faceText))
          } else {
            console.log(`[closedloop] face THROTTLED sid=${String(sid2).slice(-8)} ${qr.note}`)
          }
        }
        // 写闸/回滚义务：一行短句（v0.6.28 任务语——stepReminder 纯函数，条款细节在工具拒绝文本里，不复读）
        if (top && (top.status === 'open' || top.status === 'invalidated')) {
          const sKey = 'gate:' + top.status + ':' + top.n
          if (!s.injected.has(sKey)) {
            s.injected.add(sKey)
            spliceInjection(decision, userMsg(stepReminder(top)))
          }
        }
        // v0.4.0 阻尼外环（THEORY §3.6）：盘上信号触发才注（无信号=静默，零仪式税）；
        // 幂等键=信号组合本身（face-spam 案底纪律：键=状态读数，非步数）；触发留痕一行。
        const ds = dampingSignal(s)
        if (ds && !s.injected.has(ds.key)) {
          s.injected.add(ds.key)
          console.log(`[closedloop] damping inject ${ds.key} sid=${String(sid2).slice(-8)}`)
          spliceInjection(decision, userMsg(ds.line))
        }
      }
      if (s.stage === 'final' && !s.injected.has('terminal')) {
        s.injected.add('terminal')
        spliceInjection(decision, userMsg('【终端】terminal_check 归零（唯一 throw 位）。'))
      }
      if (s.stage !== 'off') saveState(sid2, s)
    } catch (e) {
      // v0.4-S1 修：注入失败不阻断——但**必须留痕**，否则这正是让"cut undefined 静默吃 saveState"等真 bug
      // 长期隐身的面板（每步重注刷屏事件案底：session b74630b0，2026-09-04）。
      console.warn('[closedloop] post-step inject failed（不应阻断，详情见下）:', e?.message || e)
    }
    return decision
  })
}

export default { apply, name, inject, Config }
