/**
 * delivery-attest.test — v0.8.18 交付反馈取证协议化
 * da1 散文基本形态
 * da2 大小写/分隔符归一（旧实现保留原大小写 → 与参数不等=误拒）
 * da3 含混 fail-closed（多个不同结果词不猜）
 * da4 JSON 信封（零散文猜测）
 * da5 无证据=null
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { parseDeliveryAttestation } = await import('../src/tools.js')
const { parseDeliveryEnvelope } = await import('../src/intent.js')

test('da1 散文基本形态', () => {
  assert.deepEqual(parseDeliveryAttestation('交付反馈 accepted'), { result: 'accepted', via: 'text' })
  assert.deepEqual(parseDeliveryAttestation('交付反馈：needed_fix'), { result: 'needed_fix', via: 'text' })
  assert.deepEqual(parseDeliveryAttestation('交付反馈 rejected（有缺陷）'), { result: 'rejected', via: 'text' })
})

test('da2 大小写与分隔符归一', () => {
  assert.equal(parseDeliveryAttestation('交付反馈 Accepted').result, 'accepted', '旧实现得「Accepted」→ 误拒')
  assert.equal(parseDeliveryAttestation('交付反馈=NEEDED_FIX').result, 'needed_fix')
  assert.equal(parseDeliveryAttestation('交付反馈   rejected').result, 'rejected')
})

test('da3 含混 fail-closed', () => {
  const r = parseDeliveryAttestation('交付反馈 accepted，交付反馈 rejected')
  assert.ok(r.error, '多个不同结果词=拒收（旧实现 first-match-wins 取 accepted=记错质量）')
  assert.match(r.error, /含混/)
  assert.equal(parseDeliveryAttestation('交付反馈 accepted，交付反馈 accepted').result, 'accepted', '同值重复不算含混')
  // 否定式前缀不当作证据（宁可「缺证据」也不静默取错值）
  assert.deepEqual(parseDeliveryAttestation('不是交付反馈 accepted，而是 rejected'), { result: null, via: null })
})

test('da4 JSON 信封', () => {
  assert.deepEqual(parseDeliveryAttestation('{"closedloop":{"delivery":"accepted"}}'), { result: 'accepted', via: 'json' })
  assert.equal(parseDeliveryAttestation('```json\n{"closedloop":{"delivery":"REJECTED"}}\n```').result, 'rejected')
  assert.equal(parseDeliveryEnvelope('{"closedloop":{"delivery":"maybe"}}'), null, '非枚举=null')
})

test('da5 无证据', () => {
  assert.deepEqual(parseDeliveryAttestation('随便聊聊'), { result: null, via: null })
  assert.deepEqual(parseDeliveryAttestation(''), { result: null, via: null })
  assert.deepEqual(parseDeliveryAttestation(null), { result: null, via: null })
})
