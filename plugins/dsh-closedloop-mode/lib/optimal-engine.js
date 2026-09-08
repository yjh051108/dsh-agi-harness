/**
 * optimal-engine — LQR 动作栈（纯函数+磁盘单轨；optimal-mode 核心，可单测）。
 * 哲学：最优律由目标 backward 推导；每步 declare 最优律契约 → 实现 → converge 验证
 * cost-to-go（V 序带）严格下降 + 数值逐项吻合（≠非同源复算）+ 双通道测量。
 * 闭合=closed（账面锚点，不可撤）；不吻合/ΔV 不降=invalidated → rollback=重推
 * （重声明必须带新模型签名——同签名拒绝=定理 6 反漂移）。不存在"调试"状态。
 *
 * V 序带三档（批准决议）：band ∈ {far, near, at}（远/近/达），declared 期望 + measured 实证；
 * dip 例外：declare 预声明"暂差段+回升计划"，本步允许 band 不降，但记 dipPending——
 * 下一 closed 步必须回升（pendingDip 时 converge 强制 measuredBand < declared 前档），反 J 曲线滥用。
 *
 * 借用 LQR 结构律（backward 推导/单调门/策略前置），不声称数学等价——任务态非线性代价非二次。
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { recordLesson } from './learning-organ.js'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const BANDS = { far: 3, near: 2, at: 1 } // 序带：数字越小越接近目标
export const bandName = (b) => (b === 'at' ? '达档' : b === 'near' ? '近档' : '远档')
export function optimalDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state') // 目录沿用（迁移兼容）
}
export function optimalFileFor(sid) {
  return join(optimalDir(), String(sid || '').replace(/[^a-zA-Z0-9-]/g, '_') + '.optimal.json')
}
export function loadStack(sid) {
  const f = optimalFileFor(sid)
  const legacy = join(optimalDir(), String(sid || '').replace(/[^a-zA-Z0-9-]/g, '_') + '.predict.json')
  try {
    if (!existsSync(f) && existsSync(legacy)) { try { renameSync(legacy, f) } catch { /* 竞态容忍 */ } }
    if (!existsSync(f)) return { version: 2, steps: [] }
    const s = JSON.parse(readFileSync(f, 'utf8'))
    if (!Array.isArray(s.steps)) s.steps = []
    s.version = s.version || 2
    return s
  } catch { return { version: 2, steps: [] } }
}
export function saveStack(sid, s) {
  try {
    s.version = 2
    mkdirSync(optimalDir(), { recursive: true })
    writeFileSync(optimalFileFor(sid), JSON.stringify(s), 'utf8')
    try { appendChain(sid, s) } catch { /* 链失败不阻断主存（诚实位：verify 会红） */ }
    return true
  } catch { return false }
}

/* ------------------------- v0.5.3 哈希链账本（R18 第一层：篡改可检测） -------------------------
 * append-only 链文件 <sid>.chain.jsonl：每行 {seq, at, prev, h, d}，h=sha256(prev+d)，d=规范digest(栈内容)。
 * 安全模型（诚实标注）：链检测「部分改写/意外漂移」——账本 digest ≠ 链头 d 即红；
 * **防不住完全重写链文件的本地攻击者**——那是 stamper（外部密钥盖章第二层）的职责。零改宿主。 */
export function chainFileFor(sid) {
  return join(optimalDir(), String(sid || '').replace(/[^a-zA-Z0-9-]/g, '_') + '.chain.jsonl') // 与 optimalFileFor 同清洗规则（案底：漏 0-9 致全部撞进同一链文件）
}
function canon(v) { // 稳定序列化：对象键排序，消除写入顺序噪声
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  if (v && typeof v === 'object') { const ks = Object.keys(v).sort(); return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' }
  return JSON.stringify(v === undefined ? null : v)
}
export function digestOf(s) {
  return createHash('sha256').update(canon({ steps: s.steps || [], rolledBack: s.rolledBack || [] })).digest('hex')
}
function readChain(sid) {
  try {
    if (!existsSync(chainFileFor(sid))) return []
    return readFileSync(chainFileFor(sid), 'utf8').split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
export function appendChain(sid, s) {
  const lines = readChain(sid)
  const d = digestOf(s)
  if (lines.length && lines[lines.length - 1].d === d) return { seq: lines.length - 1, dup: true } // 内容未变不重复入链
  const prev = lines.length ? lines[lines.length - 1].h : '0'.repeat(64)
  const h = createHash('sha256').update(prev + d).digest('hex')
  mkdirSync(optimalDir(), { recursive: true })
  appendFileSync(chainFileFor(sid), JSON.stringify({ seq: lines.length, at: Date.now(), prev, d, h }) + '\n', 'utf8')
  return { seq: lines.length }
}
export function verifyChain(sid) {
  const lines = readChain(sid)
  if (!lines.length) return { ok: true, empty: true, note: '无链（老账本/未跑过 v0.5.3）——非红，标灰' }
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i]
    const expectPrev = i === 0 ? '0'.repeat(64) : lines[i - 1].h
    if (L.prev !== expectPrev) return { ok: false, red: '断链', at: i, note: 'prev 指针对不上——链文件被重排/截断' }
    if (createHash('sha256').update(L.prev + L.d).digest('hex') !== L.h) return { ok: false, red: '伪造', at: i, note: 'h≠sha256(prev+d)——有人手写了链行' }
  }
  try {
    const s = JSON.parse(readFileSync(optimalFileFor(sid), 'utf8'))
    if (digestOf(s) !== lines[lines.length - 1].d) return { ok: false, red: '篡改', note: '账本现值 digest ≠ 链头——账本被链外改写（R18 案底方向）' }
  } catch { return { ok: false, red: '账本不可读', note: '主文件损坏/不存在' } }
  return { ok: true, entries: lines.length }
}
export const stackTop = (s) => s.steps[s.steps.length - 1] || null

/* ------------------------- v0.4.2 探针台账（probe book——测量证据盘） ------------------------- */

export function probeFileFor(sid) {
  return join(optimalDir(), String(sid || '').replace(/[^a-zA-Z0-9-]/g, '_') + '.probes.json')
}
export function loadProbes(sid) {
  try {
    const f = probeFileFor(sid)
    if (!existsSync(f)) return {}
    const d = JSON.parse(readFileSync(f, 'utf8'))
    return (d && typeof d === 'object') ? d : {}
  } catch { return {} }
}
export function saveProbes(sid, book) {
  try {
    mkdirSync(optimalDir(), { recursive: true })
    writeFileSync(probeFileFor(sid), JSON.stringify(book || {}), 'utf8')
    return true
  } catch { return false }
}

/**
 * v0.4.2 来源纪律（既定规则 扩展——72% 预言失效案底直修：分型数据 13/18 预言失效，
 * 其中先验估算/未先实测/源读不全/机制外推的共同形式=自由文本 source 冒充标准）。
 * 预测 source 三形式（其余=隐式先验，直拒+教语法）：
 *   read:<path>(#L<n>)  读锚点：引擎机械核验文件在位（≤2MB 文件核行号存在且非空）——
 *                       「源读不全」案底直修：引用的行必须真实存在；
 *   probe:<key>         探针台账：probe_record 实跑 cmd 落 output，预测值含数字则该数字
 *                       必须出现于实跑 output——「伪造测量」案底直修（探针未跑=台账无 key；
 *                       数字编造=值不在 output）；
 *   prior:<text>        显式先验：诚实先验计数展示（不静默当标准），风险标记入回执。
 *   engram:<title>      v0.4.6 图谱锚点（学习环读路径）：只读核验 engram-relay 盘档
 *                       （DSH_HOME/engram-relay/engrams.jsonl）——节点存在且 status=confirmed
 *                       才放行（pending=确认制未完成直拒，R15 信任级免费闸）；带 summary 回显。
 * 纯函数面：只读盘（栈目录探针台账 + 被引文件存在性），不 exec——exec 在 probe_record 工具面。
 */
function engramNode(title) {
  // 与 relay 同口径解析（v0.4.6 E2E 案底：relay 用 homedir()，宿主 USERPROFILE 可能≠DSH_HOME 用户——
  // 单认 DSH_HOME 判"无节点"，两侧存储错位）。候选目录全扫，同名取最后一条（全量重写式存储：末行最新）。
  const cands = []
  if (process.env.DSH_HOME) cands.push(join(process.env.DSH_HOME, 'engram-relay', 'engrams.jsonl'))
  try { cands.push(join(homedir(), '.dsh', 'engram-relay', 'engrams.jsonl')) } catch { /* homedir 不可用只留 DSH_HOME 候选 */ }
  const seen = new Set()
  let found = null
  for (const p of cands) {
    if (seen.has(p) || !existsSync(p)) continue
    seen.add(p)
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue
        let n
        try { n = JSON.parse(line) } catch { continue }
        if (String(n.title || '') === title) found = n
      }
    } catch { /* 单文件读失败继续下一候选（诚实位） */ }
    if (found) break
  }
  if (!found) {
    if (seen.size === 0) return { err: '图谱不可达——DSH_HOME 与 homedir 两处均无 engrams.jsonl（改用 prior:<文本> 诚实显式先验）' }
    return { err: `图谱无节点「${title}」——先 engram_store/propose 写入并确认（或改 prior:<文本>）` }
  }
  if (found.status === 'pending') return { err: `图谱节点「${title}」待确认（⏳ pending）——engram_confirm 后才有引用资格（确认制=记忆的信任级，R15）` }
  return { node: found }
}
export function checkPredictionSources(sid, predictions) {
  const stats = { read: 0, probe: 0, prior: 0, engram: 0 }
  const hits = []
  for (const p of predictions || []) {
    const src = String(p?.source || '')
    if (src.startsWith('read:')) {
      // v0.6.34 锚点净化（P3-3：括注污染/反斜杠路径案底）：括注从首个全/半角括号处截断；反斜杠归一
      const ref = String(src.slice(5).trim()).split(/[（(]/)[0].trim().replaceAll('\\', '/')
      if (!ref) return { ok: false, error: '来源纪律：read: 需路径（read:<path> 或 read:<path>#L<n>——预测所据之行的位置；正斜杠路径、勿带括注）' }
      const m = ref.match(/^(.*)#L(\d+)$/)
      const file = (m ? m[1] : ref).trim()
      const p0 = /([A-Za-z]:[\\/]|^\/)/.test(file) ? file : join(process.cwd(), file)
      if (!existsSync(p0)) return { ok: false, error: `来源纪律：读锚点缺——${file} 不存在（真没读过才引得这么笃定？预测确不需文件依据用 prior:<文本>）` }
      if (m) {
        const n = Number(m[2])
        if (n < 1) return { ok: false, error: `来源纪律：读锚点行号 ${n} < 1（${file}）` }
        try {
          if (statSync(p0).size <= 2 * 1024 * 1024) {
            const lines = readFileSync(p0, 'utf8').split('\n')
            if (n > lines.length) return { ok: false, error: `来源纪律：读锚点越界——${file} 共 ${lines.length} 行，引 L${n}（源读不全案底：引了不存在的行）` }
            if (String(lines[n - 1] || '').trim() === '') return { ok: false, error: `来源纪律：读锚点空行——${file}#L${n} 为空（预测所据是空白不是内容）` }
          }
        } catch { /* 行级核验尽力面：文件不可读时以存在性为准（诚实位，不装全知） */ }
      }
      stats.read++
    } else if (src.startsWith('probe:')) {
      const key = src.slice(6).trim()
      const e = loadProbes(sid)[key]
      if (!e) return { ok: false, error: `来源纪律：探针台账缺 key「${key}」——先 probe_record{key, cmd} 实跑落 output 再引（伪造测量案底：探针没跑、数字先写）` }
      const digits = String(p?.value || '').match(/\d+/)
      if (digits && !String(e.output || '').includes(digits[0])) return { ok: false, error: `来源纪律：探针值不在 output——预测值「${p.value}」数字 ${digits[0]} 未出现于探针「${key}」实跑 output（尾：…${String(e.output || '').slice(-80)})` }
      stats.probe++
    } else if (src.startsWith('prior:')) {
      stats.prior++
    } else if (src.startsWith('engram:')) {
      const title = src.slice(7).trim().replace(/^\[\[|\]\]$/g, '')
      const r = engramNode(title)
      if (r.err) return { ok: false, error: `来源纪律：${r.err}` }
      stats.engram++
      hits.push(`engram:「${title}」✓ ${String(r.node.summary || '').slice(0, 40)}`)
    } else {
      return { ok: false, error: `来源纪律：source「${src.slice(0, 40)}」是隐式自由文本——四形式：read:<path>#L<n>（读锚点）/ probe:<key>（探针台账）/ engram:<title>（图谱锚点，confirmed）/ prior:<文本>（显式先验）；亦可传对象形态 {kind:"read",path,line} / {kind:"probe",key} / {kind:"prior",text} / {kind:"engram",title}（免正则歧义）。自由文本=先验冒充标准（72% 预言失效案底）。` }
    }
  }
  return { ok: true, stats, hits }
}

/** 残差→序带（与 freeze 档链同一分档定义）。 */
export const costBand = (n) => (n >= 3 ? 'far' : n >= 1 ? 'near' : 'at')

/**
 * v0.5.1 WAL 脏尾结算（蓝图 seq-dirty 的插件侧落地）：open 步=declare 已落盘而 converge 未跑
 * （进程死/弃单/off 后重开）→ 移入 rolledBack，归因=process-death（外部类，不入 C 分母——
 * rank-organ EXTERNAL 过滤已含）。开局执行=「醒来看见干净账」；幂等：无脏尾返回 0。
 */
export function settleDirtyTail(sid) {
  const s = loadStack(sid)
  if (!s || !Array.isArray(s.steps)) return 0
  const open = s.steps.filter((x) => x && x.status === 'open')
  if (open.length === 0) return 0
  const rest = s.steps.filter((x) => !x || x.status !== 'open')
  const rolled = (Array.isArray(s.rolledBack) ? s.rolledBack : []).concat(open.map((x) => ({ n: x.n, title: x.title, reason: 'process-death auto-settle (WAL dirty tail: pending without result)', at: Date.now() })))
  saveStack(sid, { ...s, steps: rest, rolledBack: rolled })
  return open.length
}

/** 账本数据生成（单一同源：stackText 与 /panel 端点两处消费——禁止两处各造）。 */
export function vLadderOf(steps) {
  const closed = (steps || []).filter((s) => s.status === 'closed')
  return {
    run: closed.map((s) => ({ n: s.n, title: s.title, from: s.dv?.before || '', to: s.dv?.after || '', mode: s.dv?.mode || 'improve', pendingDip: s.pendingDip === true })),
    dipPending: (steps || []).filter((s) => s.pendingDip === true).length,
  }
}

/** 模型签名（反漂移闸）：title+来源集+不变式+代价权重——rollback 后重 declare 必须变。 */
export function modelSignature(step) {
  const src = (step.predictions || []).map((p) => p.source || '').sort().join('|')
  const inv = (step.invariants || []).sort().join('|')
  const cost = (step.cost || []).map((c) => c.failure).sort().join('|')
  return `${step.title}::${src}::${inv}::${cost}`
}

/**
 * v0.8.10 来源 JSON 协议化：对象形态 → 既有字符串规范形（边界一次转换，下游零改动）。
 * 收益：`read:<path>#L<n>` 靠正则拆路径与行号，路径自身含 `#` 即歧义；对象形态无歧义。
 * 兼容：字符串原样返回；非法对象返回 null（由 declare 明确拒，不落进含糊的"无来源"）。
 */
export function normalizeSource(src) {
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    const kind = String(src.kind || '').trim().toLowerCase()
    if (kind === 'probe') {
      const key = String(src.key ?? src.probe ?? '').trim()
      return key ? `probe:${key}` : null
    }
    if (kind === 'read') {
      const p = String(src.path ?? src.file ?? '').trim()
      if (!p) return null
      const ln = src.line ?? src.L
      const n = ln === undefined || ln === null ? '' : String(ln).replace(/^L/i, '').trim()
      return n ? `read:${p}#L${n}` : `read:${p}`
    }
    if (kind === 'prior') {
      const t = String(src.text ?? src.note ?? '').trim()
      return t ? `prior:${t}` : null
    }
    if (kind === 'engram') {
      const t = String(src.title ?? src.name ?? '').trim()
      return t ? `engram:${t}` : null
    }
    return null
  }
  return typeof src === 'string' ? src : null
}

/**
 * declareStep：最优律契约落盘（每块开工前）。
 * 契约五段（SPEC-optimal §3）：invariants（状态链）/ predictions（值+来源）/
 * cost（失败模式+防错+权重）/ law（偏差策略：观测到 X 则按预声明动作响应）/
 * measure（预期-观测对+双通道计划）+ vExpect（ΔV 预测档：'improve' / 'dip' / 'maintain'=at 档保持验证）+ confidence（可辨识性）。
 */
export function declareStep(sid, args) {
  const s = loadStack(sid)
  const cur = stackTop(s)
  // v0.8.10：source 对象形态在边界规范化（非法对象明确拒——不落进含糊的"无来源"）
  const rawPreds = Array.isArray(args?.predictions) ? args.predictions : []
  const badSrc = rawPreds.find((p) => p?.source && typeof p.source === 'object' && normalizeSource(p.source) === null)
  if (badSrc) return { ok: false, error: `来源形态非法：${JSON.stringify(badSrc.source).slice(0, 80)}——对象只认 {kind:"probe",key} / {kind:"read",path,line?} / {kind:"prior",text} / {kind:"engram",title}；或继续用字符串 read:<path>#L<n> / probe:<key> / prior:<文本> / engram:<标题>` }
  const preds = rawPreds.map((p) => ({ ...p, source: p?.source && typeof p.source === 'object' ? normalizeSource(p.source) : p?.source }))
  const step = {
    n: cur ? cur.n + 1 : 1,
    title: String(args?.title || '').trim(),
    group: String(args?.group || '').trim(), // v0.6.34：步记录归属组（P2-1 组收尾提示的可判依据；v0.6.4 案底后补）
    invariants: (args?.invariants || []).map(String),
    predictions: preds.map((p) => ({ key: String(p.key), value: String(p.value), source: String(p.source || '（无来源——既定规则：阈值必有来源）') })),
    cost: (args?.cost || args?.budget || []).map((c) => ({ failure: String(c.failure), defense: String(c.defense), weight: String(c.weight || '标准：失败态权重→∞（防错=选标准）') })),
    law: (args?.law || []).map((l) => ({ signal: String(l.signal), action: String(l.action) })),
    measure: args?.measure ? { right: String(args.measure.right || ''), wrongSignal: String(args.measure.wrongSignal || ''), channels: (Array.isArray(args.measure.channels) ? args.measure.channels : []).map(String) } : null,
    vExpect: ['improve', 'dip', 'maintain'].includes(args?.vExpect) ? args.vExpect : 'improve',
    dipPlan: String(args?.dipPlan || ''),
    confidence: ['high', 'medium', 'low'].includes(args?.confidence) ? args.confidence : 'medium',
    status: 'open', agreed: [], discrepancies: [], discrepancyCodes: [], dv: null, signature: '', at: Date.now(),
  }
  if (!step.title) return { ok: false, error: 'optimal_declare 需要 title（本块名，与盘档小类名一致——闭合即按此 mark）' }
  if (step.predictions.length === 0) return { ok: false, error: '预测值为空=未推导——至少 1 个可度量结果先算出来（禁止先实现后取值）' }
  // 既定规则 硬化（v0.3 #3 接线发现：v0.2 实况=占位标签无硬拒；闸只增不减合规）：无源=声明期直拒
  if (preds.some((p) => !String(p?.source || '').trim())) return { ok: false, error: '既定规则：预测必须逐条含来源（source=公式/标准/实测原话；无来源=无效——防"自造 0.02"冒充标准）。补齐来源后重 declare。' }
  // v0.4.2 来源纪律（既定规则 扩展）：source 三形式 read:/probe:/prior:——自由文本=先验冒充标准（72% 预言失效案底直修）
  const srcChk = checkPredictionSources(sid, preds)
  if (!srcChk.ok) return { ok: false, error: srcChk.error }
  if (args?.measure && !Array.isArray(args.measure.channels)) return { ok: false, error: 'measure.channels 形状错：需字符串数组 ≥2 条（如 ["盘档: …","运行时: …"]）——契约校验直拒，非实现异常' }
  if (!step.measure || step.measure.channels.length < 2) return { ok: false, error: 'measure.channels 需 ≥2 条独立测量通道（定理5：双通道一致；同源两遍不计）' }
  if (step.law.length === 0) return { ok: false, error: 'law 必填 ≥1 条——偏差策略前置（观测到 X→按预声明动作 Y）。无预声明策略=隐含\u201c到时候调试\u201d——消灭\u201c调试\u201d态的结构位' }
  if (step.vExpect === 'dip' && step.dipPlan.length < 8) return { ok: false, error: 'dip 预声明须带回升计划（dipPlan ≥8 字：暂差段之后如何回升——反 J-curve 滥用）' }
  // r66 准备黑洞闸门（案底 c9d6f192：开环后 99 分钟 492 次工具调用、declare 0 次，面板纹丝不动）：
  // 首步声明时以栈文件 mtime 为开环钟——超 10 分钟才开口=留痕入 step+discrepancy（不拦，记录显形；mtime 不可得宁放不误伤）
  { const firstStep = !(s.steps || []).some((x) => x && (x.status === 'open' || x.status === 'closed'))
    if (firstStep) { try { const opened = statSync(optimalFileFor(sid)).mtimeMs; const gapMin = Math.round((Date.now() - opened) / 60000); if (gapMin >= 10) { step.prepGapMin = gapMin; step.discrepancies.push(`准备黑洞 ${gapMin}min：开环后首步迟到——环境/准备也该升格为带预测的声明步（probe_record 留痕再 declare），此条入卷不拦路`); step.discrepancyCodes.push('prep-gap') } } catch { /* 无 mtime=不装测 */ } } }
  // maintainGate（r20 立、r44 修活、r48 定界）：at 档非 maintain/dip 预期必死在 ΔV 闸——declare 预拦。
  // r43 哑火案底：undefined 判据被 merge 默认值绕过（函数对线哑）。r48 活线首拦实锤后自曝越界案：闸拿栈史尾判档，新票开板 state=far 而栈尾=上票 at——误拦真推进首步。定界=只信合同内权威 state.lastBand（args.ticketBand 传入），无则宁放不误伤（假阳性比漏拦更伤信任）。
  { const band = args?.ticketBand || null
    if (band === 'at' && !['maintain', 'dip'].includes(args?.vExpect)) return { ok: false, error: 'maintainGate：当前档=at（已到顶，无可再降）。at 之后只有两种合法动作：保持（vExpect=maintain）或回滚。若你这一步是验证/保持性质：把 vExpect 改成 maintain 重发；若你真认为还能进步：说明上一步不该到 at（建模错），先回滚重新推。案底：r5/r10/r19×3/r43×2（漏标/哑闸/越界史，机器记忆）' } }
  step.signature = modelSignature(step)
  // 反漂移（定理 6）：被回滚步的签名与新声明相同 → 拒绝（必须 重推：改来源/权重/状态定义之一）
  const rb = (s.rolledBack || []).filter((r) => r.title === step.title)
  const sameSig = rb.find((r) => r.signature === step.signature)
  if (sameSig) {
    return { ok: false, error: `既定规则·反馈收敛闸：块「${step.title}」第 ${rb.length + 1} 次以**相同模型签名**重声明（来源/权重/不变式均未变）——禁止再调参数。必须换建模（新公式来源/新代价权重/新状态定义）或停下把分歧点交给用户。`, rollbackHistory: rb.map((r) => r.reason) }
  }
  if (cur && cur.status === 'open') {
    // 同块重声明（未闭合前修订）：栈顶替换；签名查重防"原地重猜"
    const s2 = { ...s }
    s2.steps[s2.steps.length - 1] = step
    saveStack(sid, s2)
    return { ok: true, step, replaced: true, sourceStats: srcChk.stats, sourceHits: srcChk.hits }
  }
  s.steps.push(step)
  saveStack(sid, s)
  return { ok: true, step, sourceStats: srcChk.stats, sourceHits: srcChk.hits }
}

/**
 * convergeStep：实现后闭合验证。三要素硬闸（任一不过=invalidated）：
 * ① 数值逐项：discrepancies 空；含数字预测的 agreed 必须「key: 实测 ≠ 预测(通道)」（≠非同源复算，复述=假锚）。
 *    v0.4.4：对等值=raw token 严格等值 或 前导数字段等值（版串「v0.4.4」案底直修——R4 假吻合活案例；
 *    占位词陷阱保留：raw 等值但全对无数字=假吻合）
 * ② ΔV 序带：dv.measuredBand 严格 < dv.beforeBand（dip 声明步除外，转回升义务 pendingDip）
 * ③ 双通道：dv.channels ≥2 且通道标识两两不同（同源不计）
 * 全过 → closed（账本落 beforeBand→measuredBand）。
 */
/** v0.8.0 结构判定（开发者定向「正则太脆弱」）：形状判定→结构判定。
 *  抽取该 key 之后的实测/预测两段值；兼容三种写法：含 ≠ 分隔 / 含「预测」字样 / 只写实测值（预测回落声明值）。
 *  判定只看三件事：含该 key、有数字、两值等。字形不再承载信息（旧 ≠ 要求=纯仪式，
 *  反复述的真正护栏是 declare 期的 probe 证据锚与断言 measure 实跑，与字形无关）。 */
export function extractAgreed(item, key, declared) {
  const s = String(item)
  const at = s.indexOf(String(key))
  if (at < 0) return null
  const channel = (/(?:[（(]|通道\s*[:：])\s*([^)）]{1,60})[)）]/.exec(s) || [])[1] || ''
  let tail = s.slice(at + String(key).length).replace(/[（(][^)）]{0,80}[)）]/g, ' ')
  const clean = (x) => String(x).replace(/^\s*[:：]?\s*(?:实测|测量|实测值|预测值|预测|预期|期望|measured|actual|predicted|expected)?\s*[:：]?\s*/i, '').trim()
  const predRe = /(?:预测|预期|期望|predicted|expected?)\s*[:：]?\s*/i
  const sepRe = /\s*(?:≠|!=|<>|vs\.?|对照|对比)\s*/
  let a = '', b = '', two = false
  if (sepRe.test(tail)) {
    const parts = tail.split(sepRe).filter((x) => String(x).trim() !== '')
    a = parts[0] || ''; b = parts[1] || ''; two = true
  } else if (predRe.test(tail)) {
    const i = tail.search(predRe)
    a = tail.slice(0, i); b = tail.slice(i).replace(predRe, ''); two = true
  } else { a = tail; b = String(declared ?? ''); }
  a = clean(a); b = clean(b)
  if (!b) b = String(declared ?? '')
  return { measured: a, predicted: b, channel, two }
}

// 锚定在值串开头（v0.4.4 版串案底的既有纪律：非锚定会误判 v0.4.5==v0.4.4）
// v0.8.12 数值协议化：数字正则补符号位与指数（旧 /\d+(?:\.\d+)?/ 不含 '-'，降级层把 -1 与 1 判等）；
// 比较一律走 numEq——同一数值的不同序列化归一（1 == 1.0 == 01 == 3.50），非纯数值串仍按字符串比。
const NUM_SRC = '[-+]?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?'
const NUM_ANY = new RegExp(NUM_SRC, 'g')
const NUM_PURE = new RegExp(`^${NUM_SRC}$`)
const leadNum = (x) => (String(x).trim().match(new RegExp(`^${NUM_SRC}`)) || [])[0] || ''
const allNums = (x) => (String(x).match(NUM_ANY) || [])
/** 数值等价（v0.8.12）：两侧均为纯数值串→按 Number 比；否则退回字符串比（版本串 v0.4.5 ≠ v0.4.4）。 */
function numEq(a, b) {
  const x = String(a).trim(), y = String(b).trim()
  if (NUM_PURE.test(x) && NUM_PURE.test(y)) return Number(x) === Number(y)
  return x === y
}
/** 等值三阶（v0.8.1，v0.8.12 数值协议化）：① raw 严格等值 ② 两侧均以数字开头→比前导数字
 *  ③ 否则比**全部数字序列**（逐位按数值比）——③ 兼容「命中 1」这类词数混排声明值，
 *  同时仍拒「v0.4.5 vs v0.4.4」（序列不同）。数字提取含符号位，杜绝 -1 被降级成 1。 */
export function valueEq(a, b) {
  const x = String(a).trim(), y = String(b).trim()
  if (!x || !y) return false
  if (x === y) return true
  const nx = leadNum(x), ny = leadNum(y)
  if (nx && ny) return numEq(nx, ny)
  const ax = allNums(x), ay = allNums(y)
  return ax.length > 0 && ax.length === ay.length && ax.every((v, i) => numEq(v, ay[i]))
}

/** v0.6.32 导出（语义裁判复用——单一真相）：单行对账匹配判定。
 *  reason: match / no-key=未覆盖该预测 / no-number=无数字实证 / declared-mismatch=复述预测与声明不符 / unequal=实测与声明不等
 *  v0.8.0 补漏（案底：旧实现 `void key; void value` 只核行内两数互等，从不与声明值比——
 *  「实测 22 预测 22」可闭声明 77.5 的预测）：吻合=**实测值等于声明值**，行内复述只作交叉核对。 */
export function agreedMatch(item, key, value) {
  const declared = String(value ?? '')
  const e = extractAgreed(item, key, declared)
  if (!e) return { ok: false, reason: 'no-key' }
  if (!/\d/.test(e.measured)) return { ok: false, a: e.measured, b: declared, reason: 'no-number' }
  if (e.two && !valueEq(e.predicted, declared)) return { ok: false, a: e.measured, b: e.predicted, declared, reason: 'declared-mismatch' }
  const ok = valueEq(e.measured, declared)
  return { ok, a: e.measured, b: declared, measured: e.measured, channel: e.channel, reason: ok ? 'match' : 'unequal' }
}

/** 通道身份：via 只是标注，独立性看 ref（真实测量对象）。换标签不改 ref=仍同源。 */
export function channelIdentity(c) {
  const s = String(c).trim()
  const m = /^([^:：]{1,24})[:：]\s*([\s\S]+)$/.exec(s)
  const via = (m ? m[1] : '').trim().toLowerCase()
  const ref = (m ? m[2] : s).trim().toLowerCase().replace(/\s+/g, ' ')
  return { via, ref }
}

/** 探针键查找（v0.8.24 大小写不敏感）：channelIdentity 把 ref 归一为小写，而 probe_record 的 key
 *  允许 [A-Za-z0-9_-]（可含大写）——旧实现 hasOwnProperty(probes, ref) 对大写键必失败，evidenced 假阴性。 */
export function probeKeyFor(probes, ref) {
  const r = String(ref || '').trim().toLowerCase()
  if (!r || !probes || typeof probes !== 'object') return ''
  if (Object.prototype.hasOwnProperty.call(probes, r)) return r
  for (const k of Object.keys(probes)) if (k.toLowerCase() === r) return k
  return ''
}

export function convergeStep(sid, args) {
  const s = loadStack(sid)
  const cur = stackTop(s)
  if (!cur) return { ok: false, error: '无 open 步——先 optimal_declare（optimal-drive：无推导不实现）' }
  if (cur.status !== 'open') return { ok: false, error: `步${cur.n}「${cur.title}」已 ${cur.status}——无需重复收敛` }
  cur.agreed = (args?.agreed || []).map(String)
  // v0.6.29 刀二：agreedPairs 结构化入参。v0.8.11 去正则：旧实现把 pairs 渲染成字符串、
  // 再由 agreedMatch 用正则重解（结构化进、正则出）——键/值含分隔符或他对文本含同名字符串
  // 时会误取他行。现同时保留结构化副本，判定优先走它；渲染串仅供回执/账本阅读。
  if (Array.isArray(args?.agreedPairs)) {
    const pairs = args.agreedPairs
      .filter((p) => p && p.key != null && p.measured != null && p.predicted != null)
      .map((p) => ({ key: String(p.key), measured: String(p.measured), predicted: String(p.predicted), channel: p.channel ? String(p.channel) : '' }))
    cur.agreedPairs = [...pairs, ...(Array.isArray(cur.agreedPairs) ? cur.agreedPairs : [])]
    const rendered = pairs.map((p) => `${p.key}: 实测 ${p.measured} ≠ 预测 ${p.predicted}${p.channel ? `（通道: ${p.channel}）` : ''}`)
    cur.agreed = [...rendered, ...cur.agreed]
  }
  cur.discrepancies = (args?.discrepancies || []).map(String)
  // v0.8.16 结构化码（回炉分层协议化）：每条 discrepancy 同步记码，分层不再正则反解自己生成的文案。
  // 模型自报（discrepancies 入参）= 'declared'：它是模型自己的判断，归因保守算推理层。
  cur.discrepancyCodes = cur.discrepancies.map(() => 'declared')
  // ① 数值闭包（v0.3.2 Bug-A 修复）：
  // 含数字预测的 agreed 必须含「≠」——否则整体拒绝（必须显式声明测量结果）
  // 数值对校验只查有 agreed 覆盖的 numerics（已声明测量结果的才核格式）
  if (!args?.exempt && cur.discrepancies.length === 0) {
    const numeric = cur.predictions.filter((p) => /\d/.test(String(p.value)))
    if (numeric.length > 0) {
      // v0.8.0 结构判定：不再要求任何字形（旧「无 ≠ 即整块拒」=纯格式税，案底：
      // 「中心距: 实测 22 预测 22」语义完整却被拒）。逐条按 key 抽取实测/预测并核数值。
      // 证据护栏不在此：probe: 源预测的数字必须在探针实跑 output（declare 期机械复验）、
      // 带 measure 的断言由引擎实跑得 V——与写法无关。
      const forced = [], forcedCodes = []
      for (const p of numeric) {
        const pair = (Array.isArray(cur.agreedPairs) ? cur.agreedPairs : []).find((x) => x.key === p.key)
        let m
        if (pair) {
          // 结构化路径（零正则）：实测须等于声明值；复述预测若给出亦须等于声明值
          if (!/\d/.test(pair.measured)) m = { ok: false, reason: 'no-number', a: pair.measured, b: p.value }
          else if (pair.predicted && !valueEq(pair.predicted, p.value)) m = { ok: false, reason: 'declared-mismatch', a: pair.measured, b: pair.predicted }
          else { const ok = valueEq(pair.measured, p.value); m = { ok, a: pair.measured, b: p.value, measured: pair.measured, channel: pair.channel, reason: ok ? 'match' : 'unequal' } }
        } else {
          const item = cur.agreed.find((a) => String(a).includes(p.key))
          if (!item) continue // 无 agreed 覆盖：尚未声明测量结果，不校验
          m = agreedMatch(item, p.key, p.value)
        }
        if (m.ok) continue
        if (m.reason === 'no-number') { forced.push(`${p.key}: 无数值实证（对账须给实测数字，且与声明值 ${p.value} 相等；空话/占位词≠测量，实测缺位=未验证）`); forcedCodes.push('no-number') }
        else if (m.reason === 'declared-mismatch') { forced.push(`${p.key}: 复述的预测 ${m.b} 与声明值 ${p.value} 不符（照声明核实测——改声明走 rollback 重推，别在 agreed 里换数）`); forcedCodes.push('declared-mismatch') }
        else { forced.push(`${p.key}: 实测 ${m.a} 与声明值 ${p.value} 不等（不等=预言失效：如实写入 discrepancies 并 rollback 重推，非 agreed）`); forcedCodes.push('unequal') }
      }
      if (forced.length) { cur.discrepancies = [...cur.discrepancies, ...forced]; cur.discrepancyCodes = [...(cur.discrepancyCodes || []), ...forcedCodes] }
    }
  }
  // ② ΔV 序带 + ③ 双通道
  const dv = args?.dv || null
  if (!args?.exempt && cur.discrepancies.length === 0) {
    if (!dv || !dv.beforeBand || !dv.measuredBand) return { ok: false, error: 'dv 必填：{beforeBand, measuredBand, channels[]}——cost-to-go 序带（far/near/at）测前/测后档（ΔV 不报=未验证）' }
    const b = BANDS[dv.beforeBand], m = BANDS[dv.measuredBand]
    if (b === undefined || m === undefined) return { ok: false, error: 'dv 档位非法：只认 far/near/at（序带三档）' }
    const chans = (dv.channels || []).map((c) => String(c))
    if (chans.length < 2) return { ok: false, error: 'dv.channels 需 ≥2 条独立测量通道的实证（双通道一致——定理5；单通道=未闭合）' }
    // v0.8.0 结构判定：独立性看 ref（真实测量对象），不看标签前缀。
    // 旧规则两个缺陷：①同前缀的两个真测量被误杀（案底：runtime:×runtime: 被拒，
    // 改标签名即可过关=闸在教模型说谎）②不同前缀的同一测量照样通过（同源不计形同虚设）。
    const ids = chans.map(channelIdentity)
    const refs = ids.map((i) => i.ref)
    if (new Set(refs).size !== refs.length) {
      const dup = refs.find((r, i) => refs.indexOf(r) !== i)
      return { ok: false, error: `dv.channels 同源：两条通道指向同一测量「${dup}」——换标签不改独立性。需两条真实不同的测量路径（如 探针台账 key × 运行时命令 / 盘档 × 面板），或让 ref 指向 probe:<key> 实跑记录` }
    }
    // 有据可查=至少一条 ref 能在探针台账或磁盘上对上号；纯散文标注仍可闭合，但如实记 evidenced=false
    let chanEvidenced = false
    try {
      const probes = loadProbes(sid)
      chanEvidenced = ids.some((i) => probeKeyFor(probes, i.ref) !== '' || /[\\/]/.test(i.ref) || /\b(node|npm|git|pwsh|findstr|python)\b/.test(i.ref) || i.ref.endsWith('.mjs') || i.ref.endsWith('.js'))
    } catch { chanEvidenced = false }
    // r60 事故#2 修复（band 闸）：at="已测投影全绿"不是口头承诺——引擎以 tools 注入的实测 V 为权威，V>0 拒收 at
    if (dv.measuredBand === 'at' && Number.isFinite(Number(args?.ticketV)) && Number(args.ticketV) > 0) return { ok: false, error: `band 闸：报 at 被拒——V=${args.ticketV}>0（引擎实时测得：已测投影仍有红/读数失败，合同未达）。诚实报 near，清零的那一步再宣 at（案底 r60：引擎不校 at⇒V=0 收了谎，下一步被 maintainGate 反杀整票卡死）。` }
    // v0.3.3 maintain（验证类任务死锁修复——用户反馈直采）：保持目标态=合法闭环，
    // 不是假装 improve、也不是借 dip 编回升故事。闭合条件：before=at 且 measured=at。
    if (cur.vExpect === 'maintain') {
      if (b !== BANDS.at) return { ok: false, error: `vExpect=maintain 只在 at 档合法（目标已达）：当前 before=${dv.beforeBand} 未达目标——保持=逃避改善义务。推进走 improve，确属暂差段 declare dip 带回升计划。` }
      if (m !== BANDS.at) return { ok: false, error: `maintain 步测后=${dv.measuredBand}：不是保持目标态，是倒退——预言失效走 rollback 重推（诚实报档优于硬凑 maintain 闭合）。` }
      cur.dv = { before: dv.beforeBand, after: dv.measuredBand, channels: chans, mode: 'maintain' }
      s.steps.forEach((x) => { if (x !== cur && x.pendingDip) x.pendingDip = false }) // 回 at 即清：与饱和步同口径
    } else if (m >= b && cur.vExpect !== 'dip') {
      return { ok: false, error: `ΔV 闸未过：测后档 ${dv.measuredBand}(${bandName(dv.measuredBand)}) 未严格优于测前 ${dv.beforeBand}(${bandName(dv.beforeBand)})——cost-to-go 不降=模型预言失效。回滚 重推（rollback→改建模→重 declare）；确属暂差段（重构 J-curve）应事先 declare vExpect='dip' 带回升计划；验证「已达 at 且保持」应 declare vExpect='maintain'（v0.3.3：闭合条件=测后仍 at，无回升义务）。` }
    } else if (m >= b && cur.vExpect === 'dip') {
      if (b === BANDS.at && m !== BANDS.at) return { ok: false, error: 'dip 登记被拒（v0.3.1·体验单缺陷①活板门关闭）：before=at 已是最优档，measured=' + dv.measuredBand + ' 的挂账其清偿条件（严格优于 at）在枚举内不可满足——不可满足的债务不配登记。at 档验证/保持步用 vExpect=maintain（v0.3.3）；真倒退=预言失效，走 rollback 重推 改建模。' }
      if (m === BANDS.at) {
        // 底档 dip=饱和（smoke2 #A + v0.3.1 清偿救援）：达 at 即终结债务——清一切挂账（含存量 at 登记死角）
        cur.dv = { before: dv.beforeBand, after: dv.measuredBand, channels: chans, mode: 'dip-saturated' }
        s.steps.forEach((x) => { if (x !== cur && x.pendingDip) x.pendingDip = false })
      } else {
        if (s.steps.some((x) => x.pendingDip && x.status === 'closed')) return { ok: false, error: '栈上已有未清偿的 dip 段——连续 dip 禁止（回升义务优先：先闭合一个改善步清账，再议新的暂差段）' }
        cur.pendingDip = true // 本步暂差合法（按声明轨迹）；下一闭合步必须回升
        cur.dv = { before: dv.beforeBand, after: dv.measuredBand, channels: chans, mode: 'dip' }
      }
    } else {
      cur.dv = { before: dv.beforeBand, after: dv.measuredBand, channels: chans, mode: cur.vExpect }
    }
    if (cur.dv) cur.dv.evidenced = chanEvidenced // 独立性是有据（探针/路径/命令）还是仅口头标注
  }
  // dip 清偿 sweep（v0.3.1 缺陷①「回 at 即清」）：improve 步严格优于挂账前档，或任何 improve 达 at——债务终结
  s.steps.forEach((x) => { if (x !== cur && x.pendingDip && cur.dv && cur.dv.mode === 'improve' && (BANDS[cur.dv.after] < BANDS[x.dv.before] || cur.dv.after === 'at')) x.pendingDip = false })
  if (cur.discrepancies.length > 0 && !(cur.dv || args?.exempt)) recordLesson('reconcile-mismatch', '对账不吻合：' + String(cur.discrepancies[0] || '').slice(0, 90), 'optimal-engine:convergeStep', undefined, sid)
  cur.status = cur.discrepancies.length === 0 && (cur.dv || args?.exempt) ? 'closed' : 'invalidated'
  if (cur.status === 'closed' && cur.dv) cur.vLedger = `${cur.dv.before}→${cur.dv.after}`
  saveStack(sid, s)
  return { ok: true, step: cur }
}

/** optimal_rollback：撤销栈顶（open/invalidated）；closed=账面锚点不可撤。reason=重推 产物。 */
/** v0.6.35 回炉分层纯函数（机械判定单一真相）：真不一致=推理层；格式/占位/假吻合=措辞层；混合=保守推理层。
 *  v0.8.16 协议化：优先按**结构化码**判定（codes 与 diffs 一一对应）——旧实现拿正则反解引擎自己生成的
 *  文案，改一个词就静默翻转归因（措辞脆弱性）。码全为格式码=措辞层，任一非格式码（含模型自报 declared、
 *  存量无码）=推理层。无码调用（存量栈/外部）仍走旧正则口径，判定不变。 */
const DISC_FORMAT_CODES = new Set(['no-number', 'no-key', 'declared-mismatch'])
export function classifyRollbackLayer(diffs, codes) {
  const ds = (diffs || []).map(String)
  const cs = Array.isArray(codes) ? codes.map((x) => String(x || '')) : []
  if (ds.length > 0 && cs.length === ds.length) {
    return cs.some((c) => !DISC_FORMAT_CODES.has(c)) ? 'reasoning' : 'transcription'
  }
  if (!ds.length) return 'reasoning' // 无证伪记录=保守（存量未分层，不洗白）
  const anyReal = ds.some((d) => /不一致|与声明值 .* 不等|不等（/.test(d))
  const anyFormat = ds.some((d) => /假吻合|占位词|前导数字|逐字含|no-form|无数值实证|复述的预测|同源/i.test(d))
  return anyReal ? 'reasoning' : anyFormat ? 'transcription' : 'reasoning'
}

/** 回炉归因（v0.8.24 结构化）：决定这次回炉算不算「模型的判断失误」。
 *  model=推理/措辞错（计）；external=外部变更；process-death=进程被杀；deliberate=故意验闸（不计）。 */
export const ROLLBACK_CAUSES = ['model', 'external', 'process-death', 'deliberate']
const CAUSE_SET = new Set(ROLLBACK_CAUSES)

export function rollbackStep(sid, reason, cause) {
  const s = loadStack(sid)
  const cur = stackTop(s)
  if (!cur) return { ok: false, error: '空栈——无可回滚' }
  if (cur.status === 'closed') return { ok: false, error: `步${cur.n}「${cur.title}」已闭合（账面锚点）不可撤销` }
  const removed = s.steps.pop()
  removed.rollbackReason = String(reason || '').trim() || '（未记录）'
  // v0.8.24：cause 枚举外的值一律归 model（默认计入——宁可算在模型头上，不靠措辞洗白）
  removed.rollbackCause = CAUSE_SET.has(String(cause || '')) ? String(cause) : 'model'
  // v0.6.35 回炉机械分层（治本：措辞层不计信誉——惩罚对准判断力非打字准确率，模型无法自报洗白）：
  // v0.8.16 按 discrepancyCodes 判（文案无关）；无码存量栈回退旧正则口径。
  removed.rollbackLayer = classifyRollbackLayer(removed.discrepancies || [], removed.discrepancyCodes)
  s.rolledBack = s.rolledBack || []
  s.rolledBack.push({ n: removed.n, title: removed.title, reason: removed.rollbackReason, cause: removed.rollbackCause, layer: removed.rollbackLayer, signature: removed.signature, diffs: removed.discrepancies || [], codes: removed.discrepancyCodes || [], at: Date.now() })
  saveStack(sid, s)
  return { ok: true, step: removed }
}

/** 匹配盘档块的闭合步（推进门禁：完成须有同名 closed 步）。 */
export function findClosedFor(sid, title) {
  const s = loadStack(sid)
  return s.steps.filter((x) => x.status === 'closed' && x.title === title).pop() || null
}

/** V 时间线文本（面板/审计/红队入口）。 */
export function stackText(s) {
  if (!s.steps.length) return '（空栈——没有已声明的最优律步；新块先 optimal_declare：backward 从目标推导，每步从契约起步）'
  const rows = s.steps.map((st) => {
    const dv = st.dv ? ` ΔV=${st.dv.mode === 'dip' ? 'dip' : '↓'} ${st.dv.before}→${st.dv.after}` : ''
    const pend = st.pendingDip ? ' [dip未清偿]' : ''
    return `#${st.n} ${st.title} [${st.status}] 不变式=${st.invariants.length} 预测=${st.predictions.length} 偏差策略=${st.law.length} 通道=${st.measure?.channels?.length || 0} 吻合=${st.agreed.length} 不吻合=${st.discrepancies.length}${dv}${pend}`
  })
  const ladder = vLadderOf(s.steps)
  const vTl = ladder.run.map((r) => `#${r.n}「${r.title}」${r.from}→${r.to}`).join(' ⇒ ') + (ladder.dipPending ? ` [dip 挂账 ${ladder.dipPending} 笔未清偿]` : '')
  const rb = (s.rolledBack || []).length ? '\n重推 审计：' + s.rolledBack.map((r) => `#${r.n}「${r.title}」原因=${r.reason}`).join(' | ') : ''
  return `**动作栈（${s.steps.length} 步）**\n${rows.join('\n')}\n栈顶=${stackTop(s)?.status || '-'}\n档位时间线：${vTl || '（无闭合步）'}${rb}`
}

/** backward 价值链初始档（L2 锁定回执用，SPEC §6：锁定时从盘档算初档呈现）。 */
export function valueChainText(items) {
  const total = (items || []).length
  if (!total) return ''
  const band0 = total >= 3 ? 'far' : total >= 1 ? 'near' : 'at'
  return `**V 初档（backward 自目标推）**：未闭合小类 ${total} 个 → 残差档 **${band0}(${bandName(band0)})**；每块 converge 的 ΔV 以此为链起点，逐块声明 before/after 档（链不连续=declare 时校对）。`
}

/* ============================ v0.6.29 刀三：师傅层（导演定向「增加引导·交互即增益」） ============================ */
/** 同 key 预测史（从栈已闭步的 agreed 抽取实测/预测对——与闭合判定同一真相，
 *  v0.8.0：不再依赖 ≠ 字形，无字形的闭合步同样能进基线史）。 */
export function deviationStats(steps, key) {
  const hist = []
  for (const st of steps || []) {
    if (!st || st.status !== 'closed') continue
    for (const a of st.agreed || []) {
      const e = extractAgreed(String(a), key, null)
      if (!e || !e.two) continue // 需成对（实测+预测）才能算偏差
      const mn = leadNum(e.measured), pn = leadNum(e.predicted)
      hist.push({ measured: e.measured, predicted: e.predicted, dev: (mn && pn) ? +(Number(mn) - Number(pn)).toFixed(2) : null })
    }
  }
  if (!hist.length) return null
  const devs = hist.map((h) => h.dev).filter((d) => typeof d === 'number')
  const meanDev = devs.length ? +(devs.reduce((x, y) => x + y, 0) / devs.length).toFixed(2) : null
  const last = hist[hist.length - 1]
  return { n: hist.length, last, meanDev }
}

/** declare 回执的师傅行：同型基线（上次实测与偏差）——有史才出，无史零注入（引导税花在交互时刻）。 */
export function baselineLine(steps, predictions) {
  const lines = []
  for (const p of (predictions || []).slice(0, 3)) {
    const st = deviationStats(steps, p.key)
    if (!st) continue
    const dev = st.last.dev != null ? ` 偏差 ${st.last.dev > 0 ? '+' : ''}${st.last.dev}` : ''
    const mean = st.meanDev != null ? `；同类 ${st.n} 次均值偏差 ${st.meanDev > 0 ? '+' : ''}${st.meanDev}` : ''
    lines.push(`📐 同型基线「${p.key}」：上次预测 ${st.last.predicted} 实测 ${st.last.measured}${dev}${mean}——本步预测可据此校准`)
    if (lines.length >= 2) break
  }
  return lines.join('\n')
}

/** converge 回执的偏差行：本步实测-预测差（自主学习循环的可见形态；与闭合判定同一抽取器）。 */
export function deviationLine(step) {
  const parts = []
  for (const a of (step && step.agreed) || []) {
    const s = String(a)
    const ci = s.search(/[:：]/)
    if (ci <= 0) continue
    const key = s.slice(0, ci).trim()
    const e = extractAgreed(s, key, null)
    if (!e || !e.two) continue
    const mn = leadNum(e.measured), pn = leadNum(e.predicted)
    if (!mn || !pn) continue // 非锚定数字（如「ok」「v0.4.4」）不算可量化偏差
    const d = +(Number(mn) - Number(pn)).toFixed(2)
    parts.push(`「${key}」${d > 0 ? '+' : ''}${d}`)
  }
  if (!parts.length) return ''
  return `📐 本步偏差（实测-预测）：${parts.join('、')}——下次同型预测照此校准`
}
