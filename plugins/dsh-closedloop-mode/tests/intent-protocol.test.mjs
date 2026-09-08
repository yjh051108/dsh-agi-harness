/**
 * intent-protocol.test — v0.8.13 意图通道协议化（去散文子串脆弱性）
 * ip1 JSON 信封优先：信封 approve，散文含「修改」不干扰
 * ip2 裸对象信封 reject
 * ip3 信封形态非法 → fail-closed null（散文含「确认」也不 approve）
 * ip4 中文否定式确认 → reject（旧实现 approve=真漏洞）
 * ip5 英文否定 → reject；纯确认 → approve
 * ip6 分句边界：否定不越界（「不错，确认」→approve；「先确认——不，修改一下方案」→reject）
 * ip7 scanIntentFull 溯源三态（json / text / too-long）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'intent-'))
// 单测测单元：直接引 src/intent.js（不拉插件入口 index.js——它带宿主外部依赖，会让审计沙箱基线必红）。
// index.js 的兼容再导出由 wiring.test.mjs 覆盖。
const { scanIntent, scanIntentFull, parseIntentEnvelope } = await import('../src/intent.js')

test('ip1 JSON 信封优先，散文不参与', () => {
  const t = '这段我先解释一下：```json\n{"closedloop":{"intent":"approve"}}\n```\n另外我想修改第三组'
  assert.equal(scanIntent(t), 'approve', '信封说了算')
  assert.equal(parseIntentEnvelope(t).invalid, false)
})

test('ip2 裸对象信封 reject', () => {
  assert.equal(scanIntent('{"closedloop":"reject"}'), 'reject')
  assert.equal(scanIntent('{"closedloop":{"intent":"REJECT"}}'), 'reject', '枚举大小写归一')
})

test('ip3 信封形态非法 → fail-closed', () => {
  assert.equal(scanIntent('{"closedloop":{"intent":"maybe"}} 确认一下'), null, '非法信封不得退回散文猜')
  assert.equal(scanIntentFull('{"closedloop":{"intent":"maybe"}}').source, 'json-invalid')
})

test('ip4 中文否定式确认不再误判 approve', () => {
  assert.equal(scanIntent('先不要确认'), 'reject')
  assert.equal(scanIntent('别确认，我再想想'), 'reject')
  assert.equal(scanIntent('不用继续'), 'reject')
})

test('ip5 英文否定感知与词边界', () => {
  assert.equal(scanIntent('not ok'), 'reject')
  assert.equal(scanIntent("don't confirm"), 'reject')
  assert.equal(scanIntent('ok'), 'approve')
  assert.equal(scanIntent('confirm'), 'approve')
  assert.equal(scanIntent('I know'), null, 'know 里的 no 不算否定（词边界）')
})

test('ip6 分句边界：否定不越界，reject 仍优先', () => {
  assert.equal(scanIntent('不错，确认'), 'approve', '否定在别的分句里不越界')
  assert.equal(scanIntent('先确认——不，修改一下方案'), 'reject', '既有 a2 契约')
})

test('ip7 scanIntentFull 溯源三态', () => {
  assert.deepEqual(scanIntentFull('确认'), { intent: 'approve', source: 'text' })
  assert.deepEqual(scanIntentFull('{"closedloop":"approve"}'), { intent: 'approve', source: 'json' })
  assert.deepEqual(scanIntentFull('x'.repeat(300)), { intent: null, source: 'too-long' })
})

// 以下三条为变异审计杀幸存变异而写（每条断言一个真实行为差异，非凑数）：
test('ip8 无关 JSON 不吞散文回退（杀 sawEnvelope 初值 true）', () => {
  assert.equal(scanIntent('{"foo":1} 确认'), 'approve', '没有 closedloop 键=不是信封，散文照常判')
})

test('ip9 多段围栏 + 超长正文：信封仍生效（杀 m[1]→m[2]）', () => {
  const t = '```json\n{bad}\n```\n```json\n{"closedloop":"approve"}\n```' + 'x'.repeat(250)
  assert.equal(scanIntent(t), 'approve', '围栏切分失败则落到长度门（>200）→ null，故本断言能分辨')
})

test('ip10 长度门边界 201 字（杀 >200 → >201）', () => {
  assert.deepEqual(scanIntentFull('确认' + 'x'.repeat(199)), { intent: null, source: 'too-long' })
})

test('ip11 长度门边界 200 字（杀 >200 → >199，即 .length+1）', () => {
  assert.deepEqual(scanIntentFull('确认' + 'x'.repeat(198)), { intent: 'approve', source: 'text' })
})
