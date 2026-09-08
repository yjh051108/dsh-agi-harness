/**
 * rank-pricing-guard.test — v0.8.25 rank/pricing 变异守护
 * rp1 gBandOf 边界（杀 flip-cmp / flip-logic / G_BANDS num-plus1 三处）
 * rp2 难度权重进 C（杀 SEV_W catastrophic 4→5）
 * rp3 slips 计数（杀 slips 的 .length→.length+1）
 * rp4 空会话 dV 数值（杀 vSeries.length→+1 导致 NaN）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'rp-'))
const R = await import('../src/rank-organ.js')
const P = await import('../src/pricing-organ.js')

test('rp1 gBandOf 边界（含区间端点）', () => {
  const got = [1, 2, 3, 5, 6, 10, 11, 99].map((g) => P.gBandOf(g))
  assert.deepEqual(got, [0, 0, 1, 1, 2, 2, 3, 3], '端点属于该带（>= 与 <= 都不能松）')
  assert.equal(P.gBandOf(0), -1, '低于下界=na')
})

test('rp2 难度权重进 C（catastrophic=4）', () => {
  const mk = (sev) => ({
    closed: [{ title: 'a' }],
    cost: { assertions: [{ text: 'a', severity: sev, source: 's' }] },
    groups: [{ title: 'G', settled: true }],
  })
  const stack = { steps: [], rolledBack: [] }
  assert.equal(R.computeC(mk('catastrophic'), stack).C, 44, '0.7·Wilson(1/1)+0.2·(4/4)+0.1·1 = 44.46 → 44')
  assert.equal(R.computeC(mk('minor'), stack).C, 29, 'minor=1 → 0.2·(1/4) = 29.46 → 29')
})

test('rp3 slips 只数措辞层回炉', () => {
  const s = { closed: [{ title: 'a' }], cost: { assertions: [] }, groups: [] }
  const stack = {
    steps: [],
    rolledBack: [
      { title: 'a', layer: 'transcription', cause: 'model', reason: '措辞层' },
      { title: 'a', layer: 'reasoning', cause: 'model', reason: '推理层' },
      { title: 'a', layer: 'transcription', cause: 'external', reason: '外部' },
    ],
  }
  const r = R.computeC(s, stack)
  assert.equal(r.slips, 1, '两条 transcription 中一条是 external（不进 rb）→ 只剩 1 条')
})

test('rp4 空会话 dV 不产生 NaN', () => {
  const obs = P.observeSession({ closed: [], cost: { assertions: [] }, groups: [] }, { steps: [], rolledBack: [] })
  assert.equal(obs.dV, 0.001, '空 vSeries 走 0 分支（.length+1 会让 1-undefined=NaN）')
  assert.equal(Number.isFinite(obs.dV), true)
})
