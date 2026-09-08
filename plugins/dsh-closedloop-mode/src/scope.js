/**
 * v0.8.7 预设作用域（开发者定向：可选插件仅在配套预设生效，不影响其他预设）。
 *
 * 生效配置（effectiveScopeConfig）三级优先：
 *   1. 设置页活值文件 DSH_HOME/closedloop-scope.json（保存即生效，免重启）
 *   2. 测试/进程内覆盖（setLiveScope）
 *   3. 挂载期 config（profile/bundles 的 presetScope/presets）
 *
 * v0.8.8 治本记录：曾用宿主 settings 服务的 ctx.inject(['settings']) 注册设置节——
 * 惰性注入让新 fiber 挂未决依赖、就绪信号永不完成，reload 无界等待=卡死（实测案底）。
 * 改自带文件 + 自有 HTTP 路由：零新服务依赖，任何宿主都能装。
 *
 * 边界：
 *  - 显式 /optimal 命令不受作用域限制（用户主动=尊重，任何预设可用）；
 *  - session 未携带 preset 字段时按「不匹配」处理（fail-closed：不启用自动行为）；
 *  - 工具本体仍注册（host 级），但未启用会话无盘档状态，调用即被状态闸拒绝——无副作用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function presetAllowed(session, config) {
  if (!config || config.presetScope !== 'presets') return true
  const p = String(session?.agentPreset || session?.preset || '').trim()
  return Array.isArray(config.presets) && config.presets.includes(p)
}

export const SCOPE_NS = 'closedloop'

/** 值校验：非法拒写，不污染活值（路由 POST 与文件读回共用）。 */
export function validateScopeValue(v) {
  if (!v || typeof v !== 'object') throw new Error('作用域配置须为对象')
  if (!['all', 'presets'].includes(String(v.presetScope))) throw new Error('presetScope 须为 all|presets')
  if (!Array.isArray(v.presets) || v.presets.some((x) => !String(x).trim())) throw new Error('presets 须为非空字符串数组')
  return { presetScope: String(v.presetScope), presets: v.presets.map((x) => String(x).trim()) }
}

const scopeFile = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'closedloop-scope.json')
let fileCache = { size: -1, val: null }

/** 活值文件读取（stat 尺寸变即重解析——写入方是本机小 JSON，够用且零定时器）。 */
export function liveScopeFromFile() {
  try {
    const f = scopeFile()
    if (!existsSync(f)) return null
    const size = readFileSync(f).length
    if (fileCache.size !== size) {
      const raw = JSON.parse(readFileSync(f, 'utf8'))
      fileCache = { size, val: validateScopeValue(raw) }
    }
    return fileCache.val
  } catch { return null }
}

/** 写活值文件（路由 POST 入口）——校验后落盘，返回落盘值。 */
export function writeScopeFile(v) {
  const val = validateScopeValue(v)
  const f = scopeFile()
  try { mkdirSync(dirname(f), { recursive: true }) } catch { /* 已存在 */ }
  writeFileSync(f, JSON.stringify(val))
  fileCache = { size: -1, val: null }
  return liveScopeFromFile() || val
}

/** 进程内覆盖（测试钩子；生产路径走文件）。 */
let liveOverride = null // 快照对象或 installSection setSource 给的取值函数（两形状兼容）
export function setLiveScope(v) {
  if (typeof v === 'function') liveOverride = v
  else if (v && typeof v === 'object') { const val = validateScopeValue(v); liveOverride = () => val }
  else liveOverride = null
}
export function getLiveScope() { try { return liveOverride ? liveOverride() : null } catch { return null } }

/** 生效配置：文件活值 > 进程覆盖 > 挂载 config。 */
export function effectiveScopeConfig(config) { return liveScopeFromFile() || getLiveScope() || config }
