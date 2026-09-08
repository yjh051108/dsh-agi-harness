/**
 * 最优律控制循环 v3 盘档层（THEORY-v0.3：策略驻留引擎，轨迹涌现回路）。
 *
 * v3 心智模型（既定规则 策略/轨迹分离）：
 *   - 合同阶段合同常驻：cost（终端代价 Q_N：断言+权重+来源 / nonGoals / assumptions）+ groups（组级结构）。
 *   - 轨迹不入合同：块级序列、backward 档链、双锁、审核位全部废除——
 *     演进量只存「实测残差读数（lastBand）+ 已闭集（closed[]）」，每步由盘档直读，模型不抄。
 *   - 单一锁点：weightsLocked（freeze=锁权重与组结构，非锁轨迹）。
 *   - stage：off|brainstorm|weights|rolling|final（weights=合同已锁待确认，rolling=执行阶段实时定序）。
 *   - 盘档=唯一真相源：跨引擎代际可读；v2/v1 旧档经 migrateLegacy 只读映射（零回写）。
 *
 * 本模块=纯状态迁移 + 序列化（可单测）；IO 与 fiber 生命周期解耦（代际免疫，v0.2 遗产继承）。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_DSH_HOME = () => join(homedir(), '.dsh')

/** v3 盘档（.closedloop.json）与旧代文件（.json= v2/.v1 混合史）分离——A/B 双引擎各写各档，互不污染。 */
export function stateDirFor() {
  return join(process.env.DSH_HOME || DEFAULT_DSH_HOME(), 'graded-state')
}
const sanitize = (sid) => String(sid || '').replace(/[^a-zA-Z0-9-]/g, '_')
export function stateFileFor(sid) { return join(stateDirFor(), sanitize(sid) + '.closedloop.json') }
export function legacyFileFor(sid) { return join(stateDirFor(), sanitize(sid) + '.json') }

/** v0.4.1-F1：autoConfirm 读取（用户授权通道：settings.autoConfirm，凭据在设置文件 provenance 字段）。
 *  freeze 直认优先=授权高于弹窗——0.3.2「弹窗劫持授权」回归修复（dogfood R1 F1：
 *  autoConfirm=true 仍弹 UI 需手动取消才落 autoConfirm 回退）。index.js 与 tools.js freeze 共用本函数（单一真相）。 */
export function readAutoConfirm() {
  try {
    const f = join(stateDirFor(), '..', 'graded-settings.json')
    return JSON.parse(readFileSync(f, 'utf8')).autoConfirm === true
  } catch { return false }
}

export function saveState(sid, s) {
  try {
    mkdirSync(stateDirFor(), { recursive: true })
    writeFileSync(stateFileFor(sid), JSON.stringify(serializeState(s)), 'utf-8')
    return true
  } catch (e) {
    console.warn('[closedloop] saveState failed:', sid, e?.message || e)
    return false
  }
}

/** 磁盘权威加载：v3 档优先；无 v3 档则读旧档做**内存态**只读迁移（绝不回写旧文件——对照组保护）。 */
export function loadState(sid) {
  try {
    const f = stateFileFor(sid)
    if (existsSync(f)) {
      const s = deserializeState(JSON.parse(readFileSync(f, 'utf-8')))
      return s.stage === 'off' ? null : s
    }
    const lg = legacyFileFor(sid)
    if (existsSync(lg)) {
      const s = migrateLegacy(JSON.parse(readFileSync(lg, 'utf-8')))
      return s.stage === 'off' ? null : s
    }
    return null
  } catch {
    return null
  }
}

/** v3 stage 集（五态；旧六字串只出现在迁移映射，不再驻留）。 */
export const STAGES = ['off', 'brainstorm', 'weights', 'rolling', 'final']
export const STAGE_SEMANTICS = {
  off: 'idle',
  brainstorm: 'cost-calibrate',
  weights: 'contract-locked-review',
  rolling: 'fast-loop-realtime',
  final: 'terminal-zero-check',
}
export const SEVERITIES = ['minor', 'major', 'catastrophic']
const BANDS = ['far', 'near', 'at']

/* ============================ 写面（v3 形状）——此标记之上禁现旧轨迹键 ============================ */

/** 合同阶段合同规范化（cost 语义与 v2 一致：断言逐条 severity+source，nonGoals 确认制位）。
 *  v0.4-S1：断言可选携 measure={cmd,kind,target}（测量函数）——条件展开防键漂移（round-trip 严格等值纪律）。 */
export function normalizeCost(cost) {
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : [])
  const normMeasure = (x) => (x && typeof x === 'object' && String(x.cmd || '').trim()
    ? { cmd: String(x.cmd).trim(), kind: ['bool', 'ratio', 'count'].includes(x.kind) ? x.kind : 'bool', target: typeof x.target === 'number' ? x.target : null }
    : null)
  const assertions = Array.isArray(cost?.assertions)
    ? cost.assertions
        .map((a) => (typeof a === 'string'
          ? { text: a, severity: 'major', source: '旧盘档继承' } // 字符串条目=遗留形态（工具门只收对象），继承标记不冒充新立断言
          : { text: String(a?.text || '').trim(), severity: SEVERITIES.includes(a?.severity) ? a.severity : '', source: String(a?.source || '').trim(), ...(normMeasure(a?.measure) ? { measure: normMeasure(a.measure) } : {}) }))
        .filter((a) => a.text)
    : []
  return {
    purpose: typeof cost?.purpose === 'string' ? cost.purpose.trim() : '',
    assertions,
    nonGoals: strs(cost?.nonGoals),
    assumptions: strs(cost?.assumptions),
    nonGoalsConfirmed: cost?.nonGoalsConfirmed === true,
    aligned: cost?.aligned === true,
  }
}

/** 组级结构规范化（v3 只有组；verify=组核对验证方，settled=核对落账记录或 null）。 */
const VERIFY_GROUP = ['self', 'subagent', 'redteam', 'user']
export function normalizeGroup(g) {
  const strs = (a) => (Array.isArray(a) ? a.map((x) => String(x).trim()).filter(Boolean) : [])
  const DOS = ['self', 'subagent', 'workflow', 'daemon', 'mixed']
  return {
    title: String(g?.title || '').trim(),
    spec: typeof g?.spec === 'string' ? g.spec : '',
    accept: strs(g?.accept),
    verify: VERIFY_GROUP.includes(g?.verify) ? g.verify : 'self',
    ...(g && g.autoRelaxed === true ? { autoRelaxed: true } : {}),
    ...(g && g.auditSampled === true ? { auditSampled: true } : {}),
    do: DOS.includes(g?.do) ? g.do : '', // 组级默认执行形态（动作级可在提议时覆写；revise_do 修订面）
    // 形态修订轨迹（revise_do 登记面）——仅有史时添键（防 deepEqual 键集漂移）
    ...(Array.isArray(g?.doHistory) && g.doHistory.length ? { doHistory: g.doHistory } : {}),
    // 组落账请求位（机械门在 tools.trySettleGroups 消费）——仅在位时添键（防 deepEqual 键集漂移）
    ...(g?.closeRequested === true ? { closeRequested: true } : {}),
    settled: g?.settled && typeof g.settled === 'object' ? { at: g.settled.at ?? null, verdict: String(g.settled.verdict || '') } : null,
  }
}

export function initMode() {
  return {
    v: 3,
    stage: 'off',
    task: null,
    cost: normalizeCost(null),
    groups: [],
    weightsLocked: false,
    closed: [],
    lastBand: null,
    dipPending: false,
    injected: new Set(),
  }
}

/** v0.8.30 写入面台账上限（判据可证伪门的数据源：本会话 write/edit 产出的文件） */
export const MAX_WRITE_SET = 50

/**
 * 写入面台账（纯函数）：记录本会话 write/edit 的产物路径。
 * 空值/重复不添键——保持 round-trip 键纪律（无写入面时不出现 writeSet 键）。
 */
export function recordWrite(prev, p) {
  const s = prev || initMode()
  const v = String(p || '').trim()
  if (!v) return s
  const cur = Array.isArray(s.writeSet) ? s.writeSet : []
  if (cur.includes(v)) return s
  return { ...s, writeSet: [...cur, v].slice(-MAX_WRITE_SET) }
}

/* ---------------- v0.8.31 欠据账（人判项=只能人判的项，真人签收才付清） ----------------
 * 治的病（池核案底 session-1f8c4faa）：11 条断言里 7 条人判项被 terminal_check 记成
 * 「未机械验证（挂账可审计）」，交付口径仍是「11 条断言全绿·交付完成」——而机器看不见的
 * 恰好是决定质量的视觉/听觉/尺度项。「我测不了」被翻译成了「通过」。
 * 语义：① 只有人判项入欠据（cmd 判据有机器读数，不入）；② 欠据不阻断推进，只阻断「完成」口径；
 *       ③ 支付=真人帧「签收 <组名>」/「签收全部」（模型自写在此撞墙，帧判类同 r64 硬签收门）。 */

/** 登记欠据（落账时调用）：同组旧的**未付**项被本次替换（重复落账不累积），已付项保留为史。 */
export function recordIOU(prev, groupTitle, items) {
  const s = prev || initMode()
  const g = String(groupTitle || '').trim()
  if (!g) return s
  const list = (Array.isArray(items) ? items : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (list.length === 0) return s
  const at = Date.now()
  const kept = (Array.isArray(s.iou) ? s.iou : []).filter((e) => !(e && e.group === g && !e.paidAt))
  return { ...s, iou: [...kept, ...list.map((text) => ({ group: g, text, at, paidAt: null }))] }
}

/** 支付欠据（真人签收帧集合：组名精确或「全部」）。无变化=返回原状态（幂等）。 */
export function payIOU(prev, signs) {
  const s = prev || initMode()
  const cur = Array.isArray(s.iou) ? s.iou : []
  if (cur.length === 0) return s
  const set = signs instanceof Set ? signs : new Set(Array.isArray(signs) ? signs : [])
  if (set.size === 0) return s
  const at = Date.now()
  let changed = false
  const next = cur.map((e) => {
    if (!e || e.paidAt) return e
    if (set.has(e.group) || set.has('全部')) { changed = true; return { ...e, paidAt: at } }
    return e
  })
  return changed ? { ...s, iou: next } : s
}

/** 未付欠据（终端归零的唯一新增阻塞条件）。 */
export function openIOU(s) {
  return (Array.isArray(s?.iou) ? s.iou : []).filter((e) => e && !e.paidAt)
}

/** 序列化：injected 转数组；输出键集即 v3 合同（零轨迹键）。 */
export function serializeState(s) {
  return {
    v: 3,
    stage: STAGES.includes(s.stage) ? s.stage : 'off',
    task: s.task ?? null,
    cost: s.cost,
    groups: s.groups,
    weightsLocked: s.weightsLocked === true,
    closed: s.closed,
    lastBand: BANDS.includes(s.lastBand) ? s.lastBand : null,
    dipPending: s.dipPending === true,
    terminalReport: s.terminalReport || undefined,
    scanLog: s.scanLog || undefined, // v0.3.1④ 扫描诊断落盘（看见了什么可查账）
    reviewNote: s.reviewNote || undefined, // v0.3.2 确认弹窗的补充意见（随 face 常驻可见）
    freezeAck: s.freezeAck || undefined, // v0.4.1-F1 补：freeze 确认留痕独立字段——scanLog 单槽每 pre-step 扫描被覆盖，直认留痕需独立持久（不随扫描冲掉）
    rank: s.rank || undefined, // v0.5.0 档位器官（LANDING：T/C/flags——信任是资产跨会话，缺位=T0）
    demands: Array.isArray(s.demands) && s.demands.length ? s.demands : undefined, // v0.5.2 索取单（跨拍续追，空=无键 round-trip 等值）
    lockedPromises: s.lockedPromises || undefined, // v0.5.12 方案A 目标锁承诺槽（自动立项：首个声明的键值承诺集）
    writeSet: Array.isArray(s.writeSet) && s.writeSet.length ? s.writeSet : undefined, // v0.8.30 写入面台账（空=无键）
    iou: Array.isArray(s.iou) && s.iou.length ? s.iou.map((e) => ({ group: String(e?.group || ''), text: String(e?.text || ''), at: typeof e?.at === 'number' ? e.at : null, paidAt: typeof e?.paidAt === 'number' ? e.paidAt : null })) : undefined, // v0.8.31 欠据账（空=无键）
    injected: [...(s.injected || [])],
  }
}

/** 反序列化：v3 直通校验；旧形状（含 plan/无 v 标记）走迁移读面。 */
export function deserializeState(obj) {
  if (!obj || typeof obj !== 'object') return initMode()
  if (obj.v !== 3) return migrateLegacy(obj)
  if (!STAGES.includes(obj.stage)) return initMode()
  const s = {
    ...initMode(),
    stage: obj.stage,
    task: typeof obj.task === 'string' ? obj.task : null,
    cost: normalizeCost(obj.cost),
    groups: (Array.isArray(obj.groups) ? obj.groups : []).map(normalizeGroup),
    weightsLocked: obj.weightsLocked === true,
    ...(Array.isArray(obj.lockedPromises) ? { lockedPromises: obj.lockedPromises.map((l) => ({ key: String(l?.key || ''), value: String(l?.value ?? '') })) } : {}),
    closed: (Array.isArray(obj.closed) ? obj.closed : []).map((c) => ({
      title: String(c?.title || '').trim(),
      group: String(c?.group || '').trim(),
      at: typeof c?.at === 'number' ? c.at : null,
      band: BANDS.includes(c?.band) ? c.band : null,
      ...(typeof c?.v === 'number' ? { v: c.v } : {}),
      ...(typeof c?.vAfterAudit === 'number' ? { vAfterAudit: c.vAfterAudit } : {}), // v0.4.1-F5：审后重锚 V（条件展开防键漂移）
      audit: c?.audit || null,
    })).filter((c) => c.title),
    lastBand: BANDS.includes(obj.lastBand) ? obj.lastBand : null,
    dipPending: obj.dipPending === true,
    injected: new Set(Array.isArray(obj.injected) ? obj.injected : []),
  }
  if (obj.terminalReport) s.terminalReport = obj.terminalReport // 缺位=无键（round-trip 严格等值，不造 undefined 键）
  if (obj.rank && typeof obj.rank === 'object') s.rank = obj.rank // v0.5.0
  if (Array.isArray(obj.demands) && obj.demands.length) s.demands = obj.demands // v0.5.2 索取单（缺位/空=无键）
  if (Array.isArray(obj.writeSet) && obj.writeSet.length) s.writeSet = obj.writeSet.map((x) => String(x)) // v0.8.30 写入面台账
  if (Array.isArray(obj.iou) && obj.iou.length) { // v0.8.31 欠据账
    s.iou = obj.iou.map((e) => ({
      group: String(e?.group || ''),
      text: String(e?.text || ''),
      at: typeof e?.at === 'number' ? e.at : null,
      paidAt: typeof e?.paidAt === 'number' ? e.paidAt : null,
    })).filter((e) => e.group && e.text)
    if (s.iou.length === 0) delete s.iou
  }
  if (obj.scanLog && typeof obj.scanLog === 'object') s.scanLog = obj.scanLog
  if (typeof obj.reviewNote === 'string' && obj.reviewNote) s.reviewNote = obj.reviewNote
  if (obj.freezeAck && typeof obj.freezeAck === 'object') s.freezeAck = obj.freezeAck // v0.4.1-F1 补
  return s
}

/* ------------------------- 执行阶段迁移算子（引擎专用——模型不抄，故无工具直连） ------------------------- */

/** /closedloop <task>：开单=合同阶段合同重置（stage→brainstorm）。 */
export function trigger(prev, task) {
  return { ...initMode(), stage: 'brainstorm', task: task || null }
}
export function deactivate() { return initMode() }

/** cost_set 落盘（定稿/修订）：合同未锁时保持标定态。 */
export function onCostCommit(prev, cost) {
  const s = prev || initMode()
  return { ...s, stage: s.weightsLocked ? s.stage : 'brainstorm', cost: { ...normalizeCost(cost), aligned: true } }
}

/** decompose（组级提交=整体替换）：锁后只读。 */
export function onGroupsEdit(prev, groups) {
  const s = prev || initMode()
  if (s.weightsLocked) return { ok: false, error: '权重已锁（唯一锁点）——改口走「修改」解锁重排。', state: s }
  return { ok: true, state: { ...s, groups: (groups || []).map(normalizeGroup) } }
}

/** freeze（v3 语义）：锁权重+组结构，非锁轨迹；入 weights 态待用户确认。 */
export function onWeightsFreeze(prev) {
  const s = prev || initMode()
  if (s.groups.length === 0) return { ok: false, error: '组结构为空——先 decompose 再冻结。' }
  return { ok: true, state: { ...s, weightsLocked: true, stage: 'weights' } }
}
/** 用户确认合同 → 执行阶段开跑（滚动定序，无预排块序列）。 */
export function onWeightsConfirmed(prev) {
  return { ...(prev || initMode()), stage: 'rolling' }
}
/** 「修改」：唯一解锁口（合同阶段主权在用户）。 injected 幂等标记不清——v0.3.2 修复：解锁不擦脸注入记录 */
export function onWeightsUnlock(prev) {
  const s = prev || initMode()
  return { ...s, weightsLocked: false, stage: 'brainstorm' }
}

/** 闭合落账：已闭集+实测残差读数的唯一写入通道（#3/#4 接线）。 */
export function recordClosed(prev, entry) {
  const s = prev || initMode()
  const e = {
    title: String(entry?.title || '').trim(),
    group: String(entry?.group || '').trim(),
    at: typeof entry?.at === 'number' ? entry.at : Date.now(),
    band: BANDS.includes(entry?.band) ? entry.band : null,
    ...(typeof entry?.v === 'number' ? { v: entry.v } : {}), // v0.4-S1：闭合时刻基数 V 读数（条件展开防键漂移——round-trip 严格等值纪律）
    ...(typeof entry?.vAfterAudit === 'number' ? { vAfterAudit: entry.vAfterAudit } : {}), // v0.4.1-F5：审后重锚 V（audit_record 重测写入；v 闭合值不可变=历史）
    audit: entry?.audit || null,
  }
  if (!e.title) return { ok: false, error: 'recordClosed 需要 title' }
  return {
    ok: true,
    state: { ...s, closed: [...s.closed.filter((c) => c.title !== e.title), e], lastBand: e.band || s.lastBand },
  }
}

/** 组核对落账（执行阶段判据事件）：全组 settled 且栈无挂账 → final（推进引擎在 #5 接线，此处纯迁移）。 */
export function markGroupSettled(prev, title, verdict) {
  const s = prev || initMode()
  const g = s.groups.find((x) => x.title === title)
  if (!g) return { ok: false, error: `组「${title}」不在合同里` }
  g.settled = { at: Date.now(), verdict: String(verdict || 'pass') }
  return { ok: true, state: { ...s, groups: s.groups.map((x) => (x.title === title ? g : x)) } }
}
export function allGroupsSettled(s) {
  return (s?.groups || []).length > 0 && s.groups.every((g) => g.settled)
}

/** 最小状态面（#4 注入的唯一读面函数，THEORY §2 Propose）：演进量全由此出，模型不抄。 */
export function controlSurface(s) {
  const st = s || initMode()
  return {
    stage: st.stage,
    task: st.task,
    reviewNote: st.reviewNote || null,
    weightsLocked: st.weightsLocked,
    cost: st.cost,
    groups: st.groups.map((g) => ({ title: g.title, accept: g.accept, verify: g.verify, settled: !!g.settled })),
    closed: st.closed.map((c) => ({ title: c.title, group: c.group, band: c.band })),
    residual: {
      groupsOpen: st.groups.filter((g) => !g.settled).map((g) => g.title),
      closedCount: st.closed.length,
      lastBand: st.lastBand,
      dipPending: st.dipPending === true,
    },
  }
}

/** 终端归零（v3）：唯一 throw 位不变；零=全组 settled ∧ 栈无未闭步 ∧ 无可回升空间的挂账已清（底档饱和 dip 不构成未零——smoke2 #A/#B 修复口径）。
 *  v0.8.31 新增唯一阻塞条件：**无未付欠据**——人判项不再当"挂账"放行（池核案底：
 *  机器看不见的 7 项被记成挂账后照样出「交付完成」）。 */
export function terminalCheck(cost, stack, state, stage) {
  if (stage !== 'final') throw new Error(`terminalCheck 仅终端校验态（final）可执行，当前=${stage}`)
  const steps = stack?.steps || []
  const openSteps = steps.filter((x) => x.status !== 'closed' && x.status !== 'rolledBack').map((x) => x.title)
  const unsettled = (state?.groups || []).filter((g) => !g.settled).map((g) => g.title)
  const dip = (state?.dipPending === true && steps.some((x) => x.pendingDip === true && x.dv?.after !== 'at')) || steps.some((x) => x.pendingDip === true && x.status === 'closed' && x.dv?.after !== 'at')
  const closedSteps = steps.filter((x) => x.status === 'closed').length
  const iou = openIOU(state)
  return {
    zero: unsettled.length === 0 && openSteps.length === 0 && !dip && iou.length === 0,
    unsettledGroups: unsettled, openSteps, dipPending: dip, closedSteps, openIOU: iou,
    purpose: cost?.purpose || '',
  }
}

/** 展示文本（回执/面板）：组级树 + 已闭计数（块轨迹不可展示——因为不存在合同里）。 */
export function treeText(s) {
  const st = s || initMode()
  const s1 = (x, n) => String(x || '').split('\n')[0].slice(0, n)
  const lines = []
  for (const g of st.groups) {
    lines.push(`#L1 ${g.title}${g.settled ? ' ✅' : st.weightsLocked ? ' 🔒' : ''}｜ ${s1(g.spec, 40)}｜ 判据:${g.accept.map((a) => a.slice(0, 24)).join('；')}｜ 核对:${g.verify}${`（闭 ${st.closed.filter((c) => c.group === g.title).length} 动作）`}`)
  }
  return lines.join('\n')
}

/* ============================ 迁移读面（旧键只读映射区）：vChain 等键只允许出现在此标记之下 ============================ */

/** 旧 stage → v3 五态映射（develop=滚动，review/l1/l2=合同编辑域）。 */
const STAGE_MAP = { off: 'off', brainstorm: 'brainstorm', 'l1-edit': 'brainstorm', 'l2-edit': 'brainstorm', review: 'weights', develop: 'rolling', final: 'final' }

/** v2/v1 盘档 → v3 内存态（纯函数，零写盘；组 locked 项 status 迁入 closed；
 *  vChain 仅作 band 读源——读后弃，不再驻留）。旧 star 形状经 normalizeCost.requirements 映射。 */
export function migrateLegacy(obj) {
  if (!obj || typeof obj !== 'object') return initMode()
  const src = obj
  const planGroups = Array.isArray(src.plan?.groups) ? src.plan.groups : []
  const vChain = Array.isArray(src.vChain) ? src.vChain : []
  const closed = []
  for (const g of planGroups) {
    for (const it of g?.items || []) {
      if (it?.status !== 'completed' || !String(it?.title || '').trim()) continue
      const link = vChain.find((c) => c?.block === it.title)
      closed.push({
        title: String(it.title).trim(),
        group: String(g?.title || '').trim(),
        at: typeof it?.completedAt === 'number' ? it.completedAt : null,
        band: BANDS.includes(it?.vOut) ? it.vOut : BANDS.includes(link?.vOut) ? link.vOut : null,
        audit: it?.costaudit || it?.redteam || null,
      })
    }
  }
  const v3 = {
    v: 3,
    stage: STAGE_MAP[src.stage] || 'off',
    task: typeof src.task === 'string' ? src.task : null,
    cost: normalizeCost(src.cost ?? (src.star ? { purpose: src.star?.purpose, assertions: src.star?.requirements, legacy: true } : null)),
    groups: planGroups.map((g) => normalizeGroup({
      title: g?.title, spec: g?.spec, accept: g?.accept, verify: g?.verify,
      settled: g?.locked ? { at: null, verdict: 'legacy-settled' } : null,
    })),
    weightsLocked: src.l2Locked === true || ['review', 'develop', 'final'].includes(src.stage) || closed.length > 0,
    closed,
    lastBand: closed.filter((c) => c.band).slice(-1)[0]?.band ?? null,
    dipPending: false,
    injected: new Set(Array.isArray(src.injected) ? src.injected : []),
  }
  if (src.terminalReport) v3.terminalReport = src.terminalReport
  return v3
}

/** 设置读取（与 v2 同路径——设置面跨代共享，graded-settings 为宿主级资产）。 */
export function loadConceptLimit(sid) {
  try {
    const root = process.env.DSH_HOME || join(homedir(), '.dsh')
    let g = {}
    try { g = JSON.parse(readFileSync(join(root, 'graded-settings.json'), 'utf8')) || {} } catch { g = {} }
    let s = {}
    if (sid) {
      try { s = JSON.parse(readFileSync(join(root, 'graded-state', sanitize(sid) + '.settings.json'), 'utf8')) || {} } catch { s = {} }
    }
    const n = Number(s.conceptLimit ?? g.conceptLimit ?? 3)
    return Number.isInteger(n) && n >= 3 && n <= 8 ? n : 3
  } catch { return 3 }
}
export function loadVerifyMode(sid) {
  try {
    const root = process.env.DSH_HOME || join(homedir(), '.dsh')
    let g = {}
    try { g = JSON.parse(readFileSync(join(root, 'graded-settings.json'), 'utf8')) || {} } catch { g = {} }
    let s = {}
    if (sid) {
      try { s = JSON.parse(readFileSync(join(root, 'graded-state', sanitize(sid) + '.settings.json'), 'utf8')) || {} } catch { s = {} }
    }
    const m = s.verifyMode ?? g.verifyMode ?? 'auto'
    return ['auto', 'self-redteam', 'subagent'].includes(m) ? m : 'auto'
  } catch { return 'auto' }
}
