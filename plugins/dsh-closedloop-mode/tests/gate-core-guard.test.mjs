/**
 * gate-core-guard.test — v0.8.21 gate-core 变异守护
 * gg1 wilsonLB 数值正确（独立公式核对——杀公式系数变异 num-plus1）
 * gg2 wilsonLB 负 n 返回 0（杀 `!n || n <= 0` 的 ||→&&）
 * gg3 未知闸返回 null（严格等值——杀 return null→undefined）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'gg-'))
const GC = await import('../src/gate-core.js')

/** 独立实现（标准 Wilson 下界，95%）——与被测公式不同写法，避免自证。 */
const refWilson = (k, n, z = 1.96) => {
  const p = k / n, z2 = z ** 2
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

test('gg1 wilsonLB 数值与标准公式一致', () => {
  for (const [k, n] of [[5, 10], [0, 4], [9, 10], [1, 3]]) {
    assert.ok(Math.abs(GC.wilsonLB(k, n) - refWilson(k, n)) < 1e-12, `${k}/${n} 应等于标准 Wilson 下界`)
  }
  assert.ok(Math.abs(GC.wilsonLB(5, 10) - 0.2366) < 0.001, '5/10 的 95% 下界≈0.2366（外部基准）')
})

test('gg2 负 n / 零 n 一律返回 0', () => {
  assert.equal(GC.wilsonLB(0, 0), 0)
  assert.equal(GC.wilsonLB(3, -1), 0, '负样本数不得进入公式（||→&& 变异会算出非 0）')
  assert.equal(GC.wilsonLB(0, -5), 0)
})

test('gg3 未知闸 id 返回 null', () => {
  assert.strictEqual(GC.recordGateEffect({ gateId: 'no-such-gate', success: true }), null, '严格 null（不是 undefined）')
})
