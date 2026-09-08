/**
 * learn-key.test — 粗桶键与过程标签的判别力（每条都带反例：只测正例=没有判别力）。
 * 案底：83/83 唯一 sig → 本文件的核心断言是「同结构异措辞必须同桶」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sizeBand, severityClass, groupsBand, featuresOf, bucketKey, processLabel, PROCESS_LABELS, HUMAN_LABELS, isSourcePath } from '../src/learn-key.js'

test('lk1 sizeBand 档界：0/1/2/3/5/6/10/11 各自落档', () => {
  assert.equal(sizeBand(0), '0')
  assert.equal(sizeBand(1), '1-2')
  assert.equal(sizeBand(2), '1-2')
  assert.equal(sizeBand(3), '3-5')
  assert.equal(sizeBand(5), '3-5')
  assert.equal(sizeBand(6), '6-10')
  assert.equal(sizeBand(10), '6-10')
  assert.equal(sizeBand(11), '11+')
  assert.equal(sizeBand('x'), '0', '非数字=空档，不抛')
})

test('lk2 severityClass 四档：C/M/m/x 由最高严重度决定', () => {
  assert.equal(severityClass([]), 'x')
  assert.equal(severityClass([{ severity: 'minor' }]), 'm')
  assert.equal(severityClass([{ severity: 'minor' }, { severity: 'major' }]), 'M')
  assert.equal(severityClass([{ severity: 'major' }, { severity: 'catastrophic' }]), 'C')
  assert.equal(severityClass([{}]), 'm', '缺 severity=minor（默认档，不塌成 x）')
})

test('lk3 groupsBand 档界：0/1/2-3/4+', () => {
  assert.equal(groupsBand(0), '0')
  assert.equal(groupsBand(1), '1')
  assert.equal(groupsBand(2), '2-3')
  assert.equal(groupsBand(3), '2-3')
  assert.equal(groupsBand(4), '4+')
})

test('lk4 featuresOf 计机械判据数 + 源码判定（写入面口径）', () => {
  const f = featuresOf({
    assertions: [{ severity: 'major', measure: { cmd: 'node x.mjs' } }, { severity: 'minor' }],
    groups: [{ title: 'g1' }],
    writeSet: ['D:\\dsh\\p\\src\\a.js'],
  })
  assert.equal(f.nCmd, 1, '只有带 measure.cmd 的才算机械判据')
  assert.equal(f.src, 'src')
  assert.equal(f.size, '1-2')
  assert.equal(f.gb, '1')
  assert.equal(isSourcePath('D:\\dsh\\p\\docs\\a.md'), false)
  assert.equal(isSourcePath('D:/dsh/p/tests/x.test.mjs'), true)
})

test('lk5 同结构异措辞 → 同桶（这是本模块存在的理由）', () => {
  const a = { assertions: [{ severity: 'major', measure: { cmd: 'x' } }, { severity: 'major' }], groups: [{}, {}], writeSet: ['D:/p/src/a.js'] }
  const b = { assertions: [{ severity: 'major' }, { severity: 'major', measure: { cmd: 'y' } }], groups: [{}, {}], writeSet: ['D:/p/src/b.js'] }
  assert.equal(bucketKey(a), bucketKey(b), '措辞/文件路径不同但结构相同 → 必须同键，否则样本又碎')
})

test('lk6 断言数跨档 → 异桶（不塌缩成单桶）', () => {
  const mk = (n) => ({ assertions: Array.from({ length: n }, () => ({ severity: 'major' })), groups: [{}] })
  assert.notEqual(bucketKey(mk(2)), bucketKey(mk(3)))
  assert.notEqual(bucketKey(mk(5)), bucketKey(mk(6)))
})

test('lk7 改源码 vs 不改源码 → 异桶', () => {
  const base = { assertions: [{ severity: 'major' }], groups: [{}] }
  assert.notEqual(bucketKey({ ...base, writeSet: ['D:/p/src/a.js'] }), bucketKey({ ...base, writeSet: ['D:/p/docs/a.md'] }))
})

test('lk8 组数跨档 → 异桶', () => {
  const mk = (n) => ({ assertions: [{ severity: 'major' }], groups: Array.from({ length: n }, () => ({})) })
  assert.notEqual(bucketKey(mk(1)), bucketKey(mk(2)))
  assert.notEqual(bucketKey(mk(3)), bucketKey(mk(4)))
})

test('lk9 空合同 → 稳定键且不抛（冷启动位）', () => {
  assert.equal(bucketKey({}), 'A0|Sx|Wo|G0')
  assert.equal(bucketKey(), 'A0|Sx|Wo|G0')
  assert.equal(bucketKey(undefined), bucketKey({}), '缺参同键')
})

test('lk10 processLabel：未归零=incomplete；归零零回炉零失配=clean', () => {
  assert.equal(processLabel({ zeroed: false, rerolls: 0, missCount: 0 }), 'incomplete')
  assert.equal(processLabel({ zeroed: true, rerolls: 0, missCount: 0 }), 'clean')
})

test('lk11 processLabel 边界：mixed 与 dirty 的分界（回炉5/失配3）', () => {
  assert.equal(processLabel({ zeroed: true, rerolls: 1, missCount: 0 }), 'mixed')
  assert.equal(processLabel({ zeroed: true, rerolls: 4, missCount: 2 }), 'mixed')
  assert.equal(processLabel({ zeroed: true, rerolls: 5, missCount: 0 }), 'dirty')
  assert.equal(processLabel({ zeroed: true, rerolls: 0, missCount: 3 }), 'dirty')
})

test('lk12 processLabel 值域不含人签词（不冒充 accepted/rejected）', () => {
  for (const out of PROCESS_LABELS) assert.ok(!HUMAN_LABELS.includes(out), `${out} 不得是人签词`)
  const seen = new Set()
  for (const z of [true, false]) for (const r of [0, 1, 5]) for (const m of [0, 1, 3]) seen.add(processLabel({ zeroed: z, rerolls: r, missCount: m }))
  for (const s of seen) assert.ok(PROCESS_LABELS.includes(s), `${s} 必须落在声明值域内`)
  for (const s of seen) assert.ok(!HUMAN_LABELS.includes(s), `${s} 不得出现在人签值域`)
})
