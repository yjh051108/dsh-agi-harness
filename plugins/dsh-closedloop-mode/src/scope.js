/**
 * v0.8.7 预设作用域（开发者定向：可选插件仅在配套预设生效，不影响其他预设）。
 *
 * config.presetScope:
 *   - 'all'（默认）——全局生效（现状不变）
 *   - 'presets'    ——仅 session.agentPreset ∈ config.presets 的会话启用自动行为
 *                    （autoStart / 引导与状态面注入 / 写闸）。
 *
 * 边界：
 *  - 显式 /optimal 命令不受作用域限制（用户主动=尊重，任何预设可用）；
 *  - session 未携带 preset 字段时按「不匹配」处理（fail-closed：不启用自动行为）；
 *  - 工具本体仍注册（host 级），但未启用会话无盘档状态，调用即被状态闸拒绝——无副作用。
 */
export function presetAllowed(session, config) {
  if (!config || config.presetScope !== 'presets') return true
  const p = String(session?.agentPreset || session?.preset || '').trim()
  return Array.isArray(config.presets) && config.presets.includes(p)
}
