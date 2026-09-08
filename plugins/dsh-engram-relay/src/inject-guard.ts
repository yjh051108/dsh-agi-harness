/**
 * inject-guard — 记忆注入的接缝守卫（issue #14 修复的纯函数层，零依赖）。
 *
 * 治的病（issue #14 逐字引了三处官方包源码，均已核对）：
 *   ① `content` 必须是 `ContentBlock[]`——字符串会被 `dsh-llm` 的纯文本投影
 *      `contentHasImage(content)` 打成 `TypeError: content.some is not a function`
 *      （实测 `/compact` 100% 失败）；
 *   ② 正常轮次的请求被 `agent-loop` `deepFreeze`——就地 `messages.push(...)` 必抛，
 *      异常又被 `try/catch` 降级成 warn → 每轮记忆注入静默失效（无人可见）；
 *   ③ 压缩摘要 / 会话标题这类辅助调用，其 `messages` 是新建可变的，注入会破坏
 *      "摘要指令必须是最后一条消息"的前提。
 *
 * 所以注入决策收进这一个纯函数：它什么都不改，只回答「能不能注、注什么形态」。
 */

/** 跳过原因（写进日志，别让失败静默——issue #14 最贵的一半是"静默"）。 */
export type InjectSkipWhy =
  | 'no-injection' // 渲染为空
  | 'aux-call' // compaction / session-title：辅助调用不改请求形状
  | 'no-messages' // 请求没有 messages 数组
  | 'frozen' // agent-loop deepFreeze：本轮不注，走 agent/pre-step 正规接缝
  | 'already-present' // 去重：同一段已在最近消息里

export interface InjectDecision {
  action: 'inject' | 'skip'
  why?: InjectSkipWhy
  /** action=inject 时应当 push 的消息；content 一定是 ContentBlock[]（不是字符串） */
  message?: { role: 'system'; content: { type: 'text'; text: string }[] }
}

/** 辅助调用目的：注入必须让位（摘要指令必须是最后一条消息）。 */
export const AUX_PURPOSES = ['compaction', 'session-title']

/**
 * 就地注入决策（`llm/stream` 路径）。
 * @param options 请求对象（只看 purpose / messages）
 * @param injection 渲染好的记忆段文本
 * @param opts.recentMessages 去重时比对的最近消息（缺省=请求自身）
 * @param opts.probeLen 去重探针长度（默认 40 字符）
 */
export function decideInjection(
  options: { purpose?: unknown; messages?: unknown } | null | undefined,
  injection: string,
  opts: { recentMessages?: unknown[]; probeLen?: number } = {},
): InjectDecision {
  const text = String(injection ?? '')
  if (!text) return { action: 'skip', why: 'no-injection' }
  const purpose = typeof options?.purpose === 'string' ? options.purpose : ''
  if (AUX_PURPOSES.includes(purpose)) return { action: 'skip', why: 'aux-call' }
  const messages = options?.messages
  if (!Array.isArray(messages)) return { action: 'skip', why: 'no-messages' }
  if (Object.isFrozen(messages)) return { action: 'skip', why: 'frozen' }
  if (alreadyPresent(opts.recentMessages ?? messages, text, opts.probeLen ?? 40)) {
    return { action: 'skip', why: 'already-present' }
  }
  return { action: 'inject', message: { role: 'system', content: [{ type: 'text', text }] } }
}

/** 注入段是否已在最近消息里出现过（`agent/pre-step` 与 `llm/stream` 双路径去重）。 */
export function alreadyPresent(messages: unknown[], injection: string, probeLen = 40): boolean {
  const probe = String(injection ?? '').slice(0, probeLen)
  if (!probe) return true
  for (const m of messages ?? []) {
    try {
      if (JSON.stringify(m ?? '').includes(probe)) return true
    } catch {
      /* 不可序列化（循环引用等）=跳过该条，不因此判"已存在" */
    }
  }
  return false
}

/** 人读的跳过原因（日志用）。 */
export function skipReasonText(why: InjectSkipWhy): string {
  switch (why) {
    case 'aux-call': return '辅助调用（compaction/session-title）不改请求形状'
    case 'frozen': return '请求被 agent-loop deepFreeze（本轮走 agent/pre-step 注入）'
    case 'already-present': return '同一记忆段已在最近消息里（去重）'
    case 'no-messages': return '请求没有 messages 数组'
    default: return '记忆段为空'
  }
}
