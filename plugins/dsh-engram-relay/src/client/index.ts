/**
 * dsh-engram-relay — client entry（图谱 WebUI 已移除）。
 *
 * 2026-08-15：按用户要求移除「图谱」Tab（conversation.view 不再注册）。
 * host 端记忆能力（engram_* 工具、唤醒注入、分层存储）完全保留，
 * 本 client 只负责占位——boot 加载该 entry 但不再渲染任何 UI。
 */

/** 插件显示名（诊断用）。 */
export const name = 'dsh-engram-relay-client'

/** 不再依赖 slots/locale：不注册任何 UI。 */
export const inject: string[] = []

/**
 * ClientContext 本地类型镜像（仅保留本 entry 用到的面）。
 */
type ClientContext = {
  effect(fn: () => unknown, name?: string): unknown
}

export function apply(ctx: ClientContext): void {
  // 图谱 WebUI 已移除（用户要求简洁体验）。
  // host 端记忆功能（工具/唤醒/存储）不受影响。
  ctx.effect(() => () => undefined, 'dsh-engram-relay: noop client')
}
