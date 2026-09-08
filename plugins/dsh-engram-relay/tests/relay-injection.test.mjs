/**
 * relay-injection.test — issue #14 修复的回归（engram-relay 记忆注入接缝）
 *
 * 案底：`llm/stream` 里 `messages.push({role:'system', content: 字符串})` +
 * 就地改 `agent-loop` deepFreeze 的请求 → ① `/compact` 必崩
 * （`content.some is not a function`）② 每轮记忆注入静默失效。
 *
 * i1 正常请求注入：content 必须是 ContentBlock[]，且 `.some` 可用（纯文本投影不炸）
 * i2 compaction 目的跳过（摘要指令必须是最后一条消息）
 * i3 session-title 目的跳过
 * i4 冻结请求跳过（why=frozen，不再就地改）
 * i5 空注入跳过
 * i6 去重：同一段已在最近消息里 ⇒ already-present
 * i7 无 messages 数组 ⇒ no-messages
 * i8 skipReasonText 五种原因都有人读文本（不留空话）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { decideInjection, alreadyPresent, skipReasonText, AUX_PURPOSES } = await import('../lib/inject-guard.js')

/** dsh-llm 的纯文本投影同形函数（issue #14 逐字引）：字符串会在这里抛 */
const contentHasImage = (content) => content.some((b) => b.type === 'image')

test('i1 正常请求注入：content 是 ContentBlock[] 且 .some 可用', () => {
  const d = decideInjection({ messages: [] }, '记忆段文本')
  assert.equal(d.action, 'inject')
  assert.equal(Array.isArray(d.message.content), true, 'content 必须是数组（字符串会让 /compact 崩）')
  assert.deepEqual(d.message.content, [{ type: 'text', text: '记忆段文本' }])
  assert.doesNotThrow(() => contentHasImage(d.message.content), '纯文本投影不得抛 content.some')
})

test('i2 compaction 目的跳过（摘要指令必须是最后一条消息）', () => {
  const d = decideInjection({ purpose: 'compaction', messages: [] }, '记忆段文本')
  assert.equal(d.action, 'skip')
  assert.equal(d.why, 'aux-call')
})

test('i3 session-title 目的跳过', () => {
  const d = decideInjection({ purpose: 'session-title', messages: [] }, '记忆段文本')
  assert.equal(d.action, 'skip')
  assert.equal(d.why, 'aux-call')
  assert.deepEqual(AUX_PURPOSES, ['compaction', 'session-title'])
})

test('i4 冻结请求跳过（不再就地改）', () => {
  const frozen = Object.freeze([])
  const d = decideInjection({ messages: frozen }, '记忆段文本')
  assert.equal(d.action, 'skip')
  assert.equal(d.why, 'frozen')
  assert.equal(frozen.length, 0, '冻结数组不得被改动')
})

test('i5 空注入跳过', () => {
  assert.equal(decideInjection({ messages: [] }, '').why, 'no-injection')
  assert.equal(decideInjection({ messages: [] }, undefined).why, 'no-injection')
})

test('i6 去重：同一段已在最近消息里', () => {
  const injection = '记忆段文本' + 'x'.repeat(80)
  const recent = [{ role: 'user', content: [{ type: 'text', text: injection.slice(0, 40) + '…' }] }]
  const d = decideInjection({ messages: [] }, injection, { recentMessages: recent })
  assert.equal(d.action, 'skip')
  assert.equal(d.why, 'already-present')
  assert.equal(alreadyPresent(recent, injection), true)
  assert.equal(alreadyPresent(recent, '另一段完全不同的文本'), false)
})

test('i7 无 messages 数组 ⇒ no-messages', () => {
  assert.equal(decideInjection({}, '记忆段文本').why, 'no-messages')
  assert.equal(decideInjection(null, '记忆段文本').why, 'no-messages')
})

test('i8 skipReasonText 五种原因都有人读文本', () => {
  for (const why of ['no-injection', 'aux-call', 'no-messages', 'frozen', 'already-present']) {
    const t = skipReasonText(why)
    assert.equal(typeof t, 'string')
    assert.ok(t.length >= 5, `${why} 的原因文本太短：${t}`)
  }
})
