/**
 * learn-bucket-wiring.test — 粗桶样本键的接线判别力（旧口径必须为假、新口径必须为真）。
 * 案底：83/83 唯一 sig → scoreCandidate 永远 trials<5「未校准」；本文件把这个事实写成断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'learn-bucket-'))
process.env.DSH_HOME = HOME

const { recordQuality, qualityTrend, taskSignature } = await import('../src/quality-ledger.js')
const { scoreCandidate, buildTaskState } = await import('../src/task-value-core.js')
const { bucketKey } = await import('../src/learn-key.js')

const ledger = () => join(HOME, 'gate-weights', 'quality-ledger.jsonl')
const readLedger = () => readFileSync(ledger(), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x))
const assertRow = (purpose, nA = 3) => ({ purpose, assertions: Array.from({ length: nA }, () => ({ severity: 'major', measure: { cmd: 'node x' } })), groups: [{ title: 'g1' }, { title: 'g2' }] })
const cand = { id: 'advance-complete-increment', kind: 'implement', signature: 'sig-1' }

test('w1 recordQuality 落 bucket/features/process 三字段（人签字段取值域不变）', () => {
  const rec = recordQuality({ ...assertRow('甲任务'), sid: 's1', rerolls: 0, zeroed: true, missCount: 0, finalQuality: 'self_checked' })
  assert.ok(rec.bucket && typeof rec.bucket === 'string', 'bucket 必落')
  assert.ok(rec.features && rec.features.nA === 3, 'features 必落（nA=3）')
  assert.equal(rec.process, 'clean', '零回炉零失配=clean')
  assert.equal(rec.finalQuality, 'self_checked', '人签字段不被机械标签改写')
  const onDisk = readLedger().at(-1)
  assert.equal(onDisk.bucket, rec.bucket, '落盘与返回一致')
})

test('w2 同结构异措辞 → 同 bucket 但 sig 不同（聚合的根据）', () => {
  const a = recordQuality({ ...assertRow('乙任务·措辞甲'), sid: 's2', zeroed: true, finalQuality: 'self_checked' })
  const b = recordQuality({ ...assertRow('完全不同的一句话任务'), sid: 's3', zeroed: true, finalQuality: 'self_checked' })
  assert.notEqual(a.sig, b.sig, 'sig 是这一单的指纹（应当不同）')
  assert.equal(a.bucket, b.bucket, 'bucket 是这一类的桶（必须相同）')
})

test('w3 合成 6 单同桶 → scoreCandidate calibrated=true（旧口径永远 false）', () => {
  const s = { bucket: bucketKey(assertRow('任意')), taskSig: 'TS-NEW', friction: 0, reasoningRollbacks: 0 }
  const rows = Array.from({ length: 6 }, (_, i) => ({ bucket: s.bucket, taskSig: 'TS-NEW-' + i, candidateId: cand.id, finalQuality: 'self_checked', process: i < 4 ? 'clean' : 'mixed' }))
  const r = scoreCandidate(cand, s, rows)
  assert.equal(r.calibrated, true, '同桶 6 单 ≥5 → 校准')
  assert.equal(r.trials, 6)
  assert.ok(r.successRate > 0.5, '4/6 clean → 成功率过半')
})

test('w4 旧口径回退：历史行无 bucket 时按 taskSig 匹配（不炸历史账）', () => {
  const s = { bucket: 'A3-5|SM|Ws|G2-3', taskSig: 'TS-OLD', friction: 0, reasoningRollbacks: 0 }
  const rows = Array.from({ length: 5 }, () => ({ taskSig: 'TS-OLD', candidateId: cand.id, finalQuality: 'no_defect' }))
  const r = scoreCandidate(cand, s, rows)
  assert.equal(r.calibrated, true, '无 bucket 的旧行按 sig 回退匹配')
  assert.equal(r.labelSource, 'human', '旧行只有人签证据')
})

test('w5 labelSource 如实标注证据来源（机械标签不冒充人签）', () => {
  const s = { bucket: 'B', taskSig: 'T', friction: 0, reasoningRollbacks: 0 }
  const mech = Array.from({ length: 5 }, () => ({ bucket: 'B', candidateId: cand.id, finalQuality: 'self_checked', process: 'clean' }))
  assert.equal(scoreCandidate(cand, s, mech).labelSource, 'mechanical')
  const human = Array.from({ length: 5 }, () => ({ bucket: 'B', candidateId: cand.id, finalQuality: 'accepted' }))
  assert.equal(scoreCandidate(cand, s, human).labelSource, 'human')
  const mixed = [...mech.slice(0, 3), ...human.slice(0, 2)]
  assert.equal(scoreCandidate(cand, s, mixed).labelSource, 'mixed')
})

test('w6 qualityTrend 按桶聚合（同桶 6 单出趋势，且 buildTaskState 带 bucket）', () => {
  // 前 3 条已在 w1/w2 落盘；再补 3 条同桶
  for (let i = 0; i < 3; i++) recordQuality({ ...assertRow('第三批 ' + i), sid: 's' + i, zeroed: true, finalQuality: 'self_checked' })
  const args = assertRow('任意新单')
  const t = qualityTrend(args.purpose, args.assertions, 5, { groups: args.groups })
  assert.ok(t && t.total >= 6, `同桶样本应 ≥6，实测 ${t && t.total}`)
  assert.ok(typeof t.bucket === 'string' && t.bucket.startsWith('A'), '趋势回执带桶键')
  const st = buildTaskState({ sid: 's9', state: { cost: { purpose: args.purpose, assertions: args.assertions }, groups: args.groups, stage: 'rolling' }, stack: { steps: [] } })
  assert.equal(st.bucket, t.bucket, 'buildTaskState 的桶与趋势查询同口径')
  assert.ok(existsSync(ledger()), '账本在盘')
})
