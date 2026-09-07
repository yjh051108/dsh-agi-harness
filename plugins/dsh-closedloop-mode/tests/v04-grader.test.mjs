/**
 * v04-grader.test — 棘轮判分器回归（THEORY-v0.4 §3.1【修3/4】）
 * 11 例：normalize去重/新增auto/删除reject/降权reject/升权auto/降阈reject/升阈auto/cmd改review/kind改review/空diff auto/commit往返sha稳定
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'v04gr-'))

const { normalizeSpec, ratchetCheck, canonicalJson, shaOf, commitSpec, loadSpec } = await import('../src/v04-grader.js')

const m = (id, w, cmd, kind = 'bool', target = null) => ({ id, w, cmd, kind, target })
const spec = (...measures) => ({ v: 4, measures })

/* ---------- normalize ---------- */
test('g1 normalize：空 spec→measures=[]；重复 id 去重保留首条', () => {
  assert.deepEqual(normalizeSpec(null).measures, [])
  assert.deepEqual(normalizeSpec({ measures: [] }).measures, [])
  const dup = normalizeSpec(spec(m('a', 1, 'x'), m('a', 2, 'y')))
  assert.equal(dup.measures.length, 1)
  assert.equal(dup.measures[0].w, 1, '保留首条')
})

/* ---------- ratchet auto 路径 ---------- */
test('g2 新增 measure → auto（收紧方向自由）', () => {
  const r = ratchetCheck(spec(m('a', 1, 'test')), spec(m('a', 1, 'test'), m('b', 2, 'grep')))
  assert.equal(r.verdict, 'auto')
  assert.equal(r.violations.length, 0)
})

test('g3 升权重 → auto', () => {
  const r = ratchetCheck(spec(m('a', 1, 'x')), spec(m('a', 3, 'x')))
  assert.equal(r.verdict, 'auto')
})

test('g4 升阈值 → auto', () => {
  const r = ratchetCheck(spec(m('a', 1, 'x', 'ratio', 0.5)), spec(m('a', 1, 'x', 'ratio', 0.8)))
  assert.equal(r.verdict, 'auto')
})

test('g5 空 diff → auto', () => {
  const s = spec(m('a', 1, 'x', 'bool', null))
  assert.equal(ratchetCheck(s, s).verdict, 'auto')
})

/* ---------- ratchet reject 路径 ---------- */
test('g6 删除 measure → reject', () => {
  const r = ratchetCheck(spec(m('a', 1, 'x'), m('b', 1, 'y')), spec(m('a', 1, 'x')))
  assert.equal(r.verdict, 'reject')
  assert.match(r.violations.join(), /b.*判分器不可摘除/)
})

test('g7 降权重 → reject', () => {
  const r = ratchetCheck(spec(m('a', 3, 'x')), spec(m('a', 1, 'x')))
  assert.equal(r.verdict, 'reject')
  assert.match(r.violations.join(), /放松/)
})

test('g8 降阈值 → reject', () => {
  const r = ratchetCheck(spec(m('a', 1, 'x', 'ratio', 0.8)), spec(m('a', 1, 'x', 'ratio', 0.3)))
  assert.equal(r.verdict, 'reject')
  assert.match(r.violations.join(), /放松/)
})

/* ---------- ratchet review 路径 ---------- */
test('g9 改命令文本 → review（语义超出棘轮机判权限）', () => {
  const r = ratchetCheck(spec(m('a', 1, 'npm test')), spec(m('a', 1, 'npm test --no-verify')))
  assert.equal(r.verdict, 'review')
  assert.equal(r.violations.length, 0, '命令变更不是机拒')
  assert.match(r.queue.join(), /测量命令变更/)
})

test('g10 改 kind → review', () => {
  const r = ratchetCheck(spec(m('a', 1, 'x', 'ratio', 0.5)), spec(m('a', 1, 'x', 'bool', 0.5)))
  assert.equal(r.verdict, 'review')
  assert.match(r.queue.join(), /kind/)
})

/* ---------- 存储往返 ---------- */
test('g11 commit/load 往返：auto 生效+history 链+sha 稳定', () => {
  const sid = 'test-g11'
  const s0 = spec(m('a', 1, 'x'))
  const c1 = commitSpec(sid, s0)
  assert.equal(c1.ok, true)
  assert.equal(c1.verdict, 'auto')
  assert.equal(c1.entry.via, 'ratchet-auto')
  const s1 = spec(m('a', 1, 'x'), m('b', 2, 'y'))
  const c2 = commitSpec(sid, s1)
  assert.equal(c2.ok, true)
  assert.equal(c2.entry.from, c1.sha, 'history 链：from=上次 to')
  const loaded = loadSpec(sid)
  assert.equal(loaded.spec.measures.length, 2)
  assert.equal(shaOf(s1), c2.sha, 'canonical sha 稳定')
  assert.equal(canonicalJson(s1), canonicalJson(loaded.spec), '往返 canonical 等值')
})
