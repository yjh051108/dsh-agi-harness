/**
 * gate-core — v0.7.0 AGI harness 闸图核心引擎（开发者定向「完整落地、实时权重优化、无静默期」）。
 *
 * 基元=闸：条件+参数+证据+策略+约束。参数由交互数据实时填充（Wilson LB，每次交互即更新，不等阈值）。
 * 三层权重：session（快适应）/ project（中速）/ harness（高置信防污染）——层间实时提交。
 * 模型指纹绑定：harness 层权重携带 model 字段，换模型=换一套。
 *
 * 设计文档：docs/DESIGN.md（仓库内）
 * 仿真验证：仓库内 sim 自检（6/6 通过）
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

// ── Wilson LB ──
export function wilsonLB(k, n, z = 1.96) {
  if (!n || n <= 0) return 0
  const p = k / n, z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

// ── 存储 ──
const storeDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'gate-weights')
const storeFile = (layer, model) => join(storeDir(), `${layer}.${model || 'default'}.json`)

function loadStore(layer, model) {
  const f = storeFile(layer, model)
  if (!existsSync(f)) return {}
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return {} }
}

function saveStore(layer, model, data) {
  const dir = storeDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(storeFile(layer, model), JSON.stringify(data, null, 2), 'utf8')
}

// ── 闸定义 ──
const GATE_REGISTRY = {
  // 注入策略模块
  baseline: { module: 'injection', type: 'inject', constraint: { maxBudget: 60 } },
  friction: { module: 'injection', type: 'inject', constraint: { maxBudget: 40 } },
  step_hint: { module: 'injection', type: 'inject', constraint: { maxBudget: 30 } },
  persona: { module: 'injection', type: 'inject', constraint: { maxBudget: 20 } },
  damping: { module: 'injection', type: 'inject', constraint: { maxBudget: 20 } },
  // 行动策略模块
  write: { module: 'action', type: 'permit', constraint: { mustNot: ['无open步放行'] } },
  step_size: { module: 'action', type: 'calibrate', constraint: {} },
  rollback: { module: 'action', type: 'calibrate', constraint: { mustNot: ['推理层不计炉'] } },
  // 校准模块
  complexity_bias: { module: 'calibration', type: 'calibrate', constraint: {} },
  confidence_bias: { module: 'calibration', type: 'calibrate', constraint: {} },
  deviation: { module: 'calibration', type: 'feedback', constraint: {} },
  // 信誉模块
  rank_signal: { module: 'rank', type: 'feedback', constraint: { maxBudget: 40 } },
  progress: { module: 'rank', type: 'feedback', constraint: { maxBudget: 30 } },
  // 审计模块
  audit_trigger: { module: 'audit', type: 'calibrate', constraint: { mustNot: ['引文不逐字'] } },
  // 学习模块
  lesson_inject: { module: 'learning', type: 'inject', constraint: { maxBudget: 30 } },
  distill: { module: 'learning', type: 'inject', constraint: { maxBudget: 20 } },
}

export function getGateRegistry() { return { ...GATE_REGISTRY } }
export const GATE_COUNT = Object.keys(GATE_REGISTRY).length

// ── 闸状态（运行时缓存，key 含 model 以隔离不同模型）──
const runtime = new Map() // key: `${layer}:${model}:${gateId}` → gate state

function getGateState(layer, gateId, model) {
  const key = `${layer}:${model}:${gateId}`
  if (runtime.has(key)) return runtime.get(key)
  const store = loadStore(layer, model)
  const state = store[gateId] || { trials: 0, successes: 0, confidence: 0, params: {}, lastUpdate: 0 }
  runtime.set(key, state)
  return state
}

function setGateState(layer, gateId, state, model) {
  const key = `${layer}:${model}:${gateId}`
  runtime.set(key, state)
  const store = loadStore(layer, model)
  store[gateId] = state
  saveStore(layer, model, store)
}

// ── 核心 API ──

/**
 * 记录一次闸交互效果——实时更新（无静默期）。
 * 每次调用立即更新 session 层，并实时检查是否应提交到 project/harness 层。
 */
export function recordGateEffect({ gateId, success, model = 'default', context = {} }) {
  const def = GATE_REGISTRY[gateId]
  if (!def) return null

  // session 层实时更新
  const session = getGateState('session', gateId, model)
  session.trials++
  if (success) session.successes++
  session.confidence = wilsonLB(session.successes, session.trials)
  session.lastUpdate = Date.now()
  if (context.params) session.params = { ...session.params, ...context.params }
  setGateState('session', gateId, session, model)

  // 实时提交到 project 层（session 积累 ≥5 即提交，不等大量数据）
  if (session.trials >= 5) {
    const project = getGateState('project', gateId, model)
    project.trials = (project.trials || 0) + 1
    if (success) project.successes = (project.successes || 0) + 1
    project.confidence = wilsonLB(project.successes, project.trials)
    project.lastUpdate = Date.now()
    setGateState('project', gateId, project, model)
  }

  // 实时提交到 harness 层（project 积累 ≥30 即提交）
  if (session.trials >= 5 && session.trials % 5 === 0) {
    const project = getGateState('project', gateId, model)
    if (project.trials >= 30) {
      const harness = getGateState('harness', gateId, model)
      harness.trials = (harness.trials || 0) + 1
      if (success) harness.successes = (harness.successes || 0) + 1
      harness.confidence = wilsonLB(harness.successes, harness.trials)
      harness.lastUpdate = Date.now()
      setGateState('harness', gateId, harness, model)
    }
  }

  return session
}

/**
 * 读侧：三层加权融合决策。
 * 返回融合后的闸参数（供调用方决定注入/拦截/校准策略）。
 * 权重分配：harness 层置信最高权重，session 层最灵活但权重低。
 */
export function queryGate({ gateId, model = 'default' }) {
  const def = GATE_REGISTRY[gateId]
  if (!def) return null

  const session = getGateState('session', gateId, model)
  const project = getGateState('project', gateId, model)
  const harness = getGateState('harness', gateId, model)

  // 三层置信加权融合（harness 层高数据量=高权重）
  const wS = session.trials > 0 ? Math.min(0.2, session.trials / 50) : 0
  const wP = project.trials > 0 ? Math.min(0.35, project.trials / 200) : 0
  const wH = harness.trials > 0 ? Math.min(0.45, harness.trials / 500) : 0
  const wSum = wS + wP + wH || 1

  const fused = (session.confidence * wS + project.confidence * wP + harness.confidence * wH) / wSum

  return {
    gateId,
    module: def.module,
    type: def.type,
    constraint: def.constraint,
    fusedConfidence: +fused.toFixed(3),
    layers: {
      session: { trials: session.trials, successes: session.successes, confidence: +session.confidence.toFixed(3) },
      project: { trials: project.trials, successes: project.successes, confidence: +project.confidence.toFixed(3) },
      harness: { trials: harness.trials, successes: harness.successes, confidence: +harness.confidence.toFixed(3) },
    },
    params: { ...session.params, ...project.params, ...harness.params },
  }
}

/**
 * 批量查询某模块的所有闸状态。
 */
export function queryModule(moduleName, model = 'default') {
  const results = []
  for (const [gateId, def] of Object.entries(GATE_REGISTRY)) {
    if (def.module === moduleName) {
      results.push(queryGate({ gateId, model }))
    }
  }
  return results
}

/**
 * 获取所有模块的完整状态快照（诊断/面板用）。
 */
export function snapshotAll(model = 'default') {
  const snap = {}
  for (const [gateId, def] of Object.entries(GATE_REGISTRY)) {
    snap[gateId] = queryGate({ gateId, model })
  }
  return snap
}

/** YAML 标量解析（v0.8.20 协议化）：去行尾注释（引号内不切）+ 成对引号剥离（含 \" 与 '' 转义）。
 *  旧实现 `([^#\r\n]+)` 对 `model: "deepseek-chat"` 会把引号带进指纹——同一模型被算成两个模型，分账错位。 */
export function yamlScalar(raw) {
  let s = String(raw ?? '').trim()
  let q = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) {
      if (ch === '\\' && q === '"') { i++; continue }
      if (ch === q) q = null
      continue
    }
    if (ch === '"' || ch === "'") { q = ch; continue }
    if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) { s = s.slice(0, i).trim(); break }
  }
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    const inner = s.slice(1, -1)
    s = s[0] === '"' ? inner.replace(/\\(["\\])/g, '$1') : inner.replace(/''/g, "'")
  }
  return s.trim()
}

/** 内联流映射 `{provider: x, model: y}` → 对象（v0.8.20：旧实现只认缩进块形态，内联写法读不到指纹）。 */
export function inlineFlowMap(raw) {
  const m = /^\{(.*)\}$/s.exec(String(raw ?? '').trim())
  if (!m) return null
  const out = {}
  for (const part of m[1].split(',')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = yamlScalar(part.slice(0, i))
    const v = yamlScalar(part.slice(i + 1))
    if (k) out[k] = v
  }
  return out
}

// ── 模型指纹 ──
export function getModelFingerprint() {
  // settings.yaml 不是 JSON。只取 agent-default-model 的 provider/model 两个标量，避免引入 YAML 依赖。
  // v0.8.20：支持带引号值、行尾注释、内联流映射 `{provider: x, model: y}` 三种写法。
  try {
    const lines = readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'settings.yaml'), 'utf8').split(/\r?\n/)
    let inDefault = false, provider = '', model = ''
    for (const line of lines) {
      const head = /^agent-default-model:\s*(.*)$/.exec(line)
      if (head) {
        const inline = inlineFlowMap(head[1])
        if (inline) { provider = inline.provider || ''; model = inline.model || ''; break }
        inDefault = head[1].trim() === ''
        continue
      }
      if (!inDefault) continue
      if (/^\S/.test(line)) break
      provider ||= yamlScalar((/^\s+provider:\s*(.*)$/.exec(line) || [])[1] || '')
      model ||= yamlScalar((/^\s+model:\s*(.*)$/.exec(line) || [])[1] || '')
    }
    if (provider && model) return `${provider}:${model}`
  } catch { /* 回退到显式环境指纹 */ }
  return process.env.DSH_JUDGE_MODEL || 'unbound'
}
