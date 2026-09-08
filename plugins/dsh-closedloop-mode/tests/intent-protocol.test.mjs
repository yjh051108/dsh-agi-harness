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
const { scanIntent, scanIntentFull, parseIntentEnvelope } = await import('../src/index.js')

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
