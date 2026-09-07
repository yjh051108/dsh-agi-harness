/**
 * quota.test — v0.5.5 协作式配额回归
 * q1 预算内放行记账；q2 他单占满→拒发（节流）；q3 过期账自动清（连续性）；q4 release 销账；q5 fail-open 语义（坏文件不卡）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-quota-'))
const Q = await import('../src/quota-organ.js')

test('q1 预算内：放行且记账', () => {
  const r = Q.claim(TMP, 's1', 600, 1000)
  assert.equal(r.granted, true)
  const q = Q.readQuota(TMP)
  assert.equal(q.claims.s1.bytes, 600)
})

test('q2 他单占满→拒发（本拍节流）', () => {
  fs.writeFileSync(path.join(TMP, 'quota.json'), JSON.stringify({ claims: { other: { bytes: Q.QUOTA_BUDGET, at: 2000 } }, budget: Q.QUOTA_BUDGET }))
  const r = Q.claim(TMP, 's2', 100, 2500)
  assert.equal(r.granted, false)
  assert.match(r.note, /协作式：防模型不防插件/)
  assert.equal(Q.readQuota(TMP).claims.s2, undefined, '被拒不记账')
})

test('q3 过期他账自动清（10 分钟=会话已睡）', () => {
  fs.writeFileSync(path.join(TMP, 'quota.json'), JSON.stringify({ claims: { stale: { bytes: 9999, at: 0 } } }))
  const r = Q.claim(TMP, 's3', 600, Q.STALE_MS + 1)
  assert.equal(r.granted, true)
  assert.equal(r.heldByOthers, 0)
})

test('q4 release 销账', () => {
  Q.claim(TMP, 's4', 500, 5000)
  assert.equal(Q.release(TMP, 's4'), true)
  assert.equal(Q.readQuota(TMP).claims.s4, undefined)
  assert.equal(Q.release(TMP, 's4'), false, '重复销=false')
})

test('q5 坏账本文件 fail-open（不卡生产）', () => {
  fs.writeFileSync(path.join(TMP, 'quota.json'), '{corrupt')
  const r = Q.claim(TMP, 's5', 100, 9000)
  assert.equal(r.granted, true)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
