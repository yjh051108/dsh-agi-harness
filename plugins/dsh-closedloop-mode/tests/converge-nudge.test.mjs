/**
 * converge-nudge.test — v0.8.34 降噪②：同一微步连续不中 ⇒ 换话术
 * c1 连续 0/1 次 ⇒ 空串（保持原「回滚重推」话术）
 * c2 连续 2 次及以上 ⇒ 出「别在原地打磨」提示
 * c3 提示里保留回滚义务（不改判定语义）
 * c4 非数字/负数 ⇒ 空串（健壮）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { stallHint } = await import('../src/nudges.js')

test('c1 连续 <2 次 ⇒ 空串', () => {
  assert.equal(stallHint(0), '')
  assert.equal(stallHint(1), '')
  assert.equal(stallHint(undefined), '')
})

test('c2 连续 ≥2 次 ⇒ 出提示且计数正确', () => {
  assert.match(stallHint(2), /连续 2 次预言不中/)
  assert.match(stallHint(5), /连续 5 次预言不中/)
  assert.match(stallHint(2), /别在原地打磨/)
})

test('c3 回滚义务不变（提示里写明）', () => {
  assert.match(stallHint(3), /回滚义务不变/)
})

test('c4 非数字 ⇒ 空串', () => {
  assert.equal(stallHint('abc'), '')
  assert.equal(stallHint(NaN), '')
  assert.equal(stallHint(-1), '')
})
