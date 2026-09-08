/**
 * user-signs.test — v0.8.17 真人签收通道协议化（信封 + token 规范化）
 * us1 裸形态不破：签收 G / 签收全部
 * us2 包裹形态不再假阴性：签收：G / 签收「G」/ 签收（G） / 签收[G]
 * us3 多组 + 标点收尾：签收 G1，签收 G2，辛苦了
 * us4 JSON 信封：{"closedloop":{"sign":"G"}} / 数组形态 / 形态非法=fail-closed
 * us5 帧判类不放松：plugin 帧、assistant 帧的「签收」一律不收
 * us6 组名含空格（括号形态）与规范化幂等
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const T = await import('../src/tools.js')
const { collectUserSigns, extractSignsFromText, normalizeSignToken } = T

const frame = (text, kind = 'user', role = 'user') => ({ role, source: { kind, rpcId: 'r1' }, content: [{ type: 'text', text }] })

test('us1 裸形态不破', () => {
  assert.deepEqual(extractSignsFromText('签收 G'), ['G'])
  assert.deepEqual(extractSignsFromText('签收全部'), ['全部'])
  assert.deepEqual([...collectUserSigns([frame('签收 RG，辛苦了')])], ['RG'])
})

test('us2 包裹形态不再假阴性（旧实现取到带标点 token）', () => {
  assert.deepEqual(extractSignsFromText('签收：G'), ['G'], '旧实现得「：G」')
  assert.deepEqual(extractSignsFromText('签收「G」'), ['G'], '旧实现得「「G」」')
  assert.deepEqual(extractSignsFromText('签收（G）'), ['G'])
  assert.deepEqual(extractSignsFromText('签收[G]'), ['G'])
  assert.deepEqual(extractSignsFromText('签收 · G'), ['G'])
})

test('us3 多组 + 标点收尾', () => {
  assert.deepEqual(extractSignsFromText('签收 G1，签收 G2，辛苦了'), ['G1', 'G2'])
  assert.deepEqual([...collectUserSigns([frame('签收 G1；签收全部')])], ['G1', '全部'])
})

test('us4 JSON 信封（零散文猜测）', () => {
  assert.deepEqual(extractSignsFromText('{"closedloop":{"sign":"G"}}'), ['G'])
  assert.deepEqual(extractSignsFromText('```json\n{"closedloop":{"sign":["G1","全部"]}}\n```'), ['G1', '全部'])
  assert.deepEqual(extractSignsFromText('{"closedloop":{"sign":123}}'), [], '形态非法=fail-closed（不退回散文猜）')
  assert.deepEqual(extractSignsFromText('{"closedloop":{"sign":["", "  ", "G"]}}'), ['G'], '空串/空白签名不采集（杀 .filter(Boolean)→.map）')
  assert.deepEqual([...collectUserSigns([frame('{"closedloop":{"sign":"G"}}')])], ['G'])
})

test('us5 帧判类不放松', () => {
  assert.deepEqual([...collectUserSigns([frame('签收 假装组', 'plugin')])], [], 'plugin 帧不收')
  assert.deepEqual([...collectUserSigns([{ role: 'assistant', source: { kind: 'user' }, content: [{ type: 'text', text: '签收 假role组' }] }])], [], 'assistant 帧不收')
  assert.deepEqual([...collectUserSigns(null)], [])
})

test('us6 含空格组名（括号形态）与规范化幂等', () => {
  assert.deepEqual(extractSignsFromText('签收「多词 组名」'), ['多词 组名'])
  assert.equal(normalizeSignToken('「：G」'), 'G')
  assert.equal(normalizeSignToken('G'), 'G', '幂等')
  assert.equal(normalizeSignToken('「」'), '', '空包裹归一为空串（调用方跳过，不采集空签名）')
})
