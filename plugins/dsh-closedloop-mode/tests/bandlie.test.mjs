/**
 * bandlie.test — r60 事故#2 修复锁：at 档不收口头（V>0 报 at 必拒）
 * b1：ticketV=2 时报 measuredBand=at → 拒（band 闸点名 V）；b2：V=0 → 放行闭合
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-bl-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP
const eng = await import('../src/optimal-engine.js')

const openStep = (sid) => {
  eng.saveStack(sid, { version: 2, steps: [], rolledBack: [] })
  const r = eng.declareStep(sid, { title: '步一', predictions: [{ key: 'k', value: '1', source: 'prior:测' }], measure: { channels: ['read: a', 'rt: b'] }, law: [{ signal: '红', action: '修' }], ticketBand: 'far' })
  assert.equal(r.ok, true, r.error)
}

test('b1 V>0 报 at 必拒（band 闸不收口头）', () => {
  openStep('bl-1')
  const r = eng.convergeStep('bl-1', { agreed: ['观测 1 ≠ 预测 1'], dv: { beforeBand: 'far', measuredBand: 'at', channels: ['read: a', 'rt: b'] }, ticketV: 2 })
  assert.equal(r.ok, false)
  assert.match(r.error, /band 闸/)
})

test('b2 V=0 报 at 合法（放行不误伤）', () => {
  openStep('bl-2')
  const r = eng.convergeStep('bl-2', { agreed: ['观测 1 ≠ 预测 1'], dv: { beforeBand: 'far', measuredBand: 'at', channels: ['read: a', 'rt: b'] }, ticketV: 0 })
  assert.equal(r.ok, true, r.error)
})

test('b3 非 at 档不受此闸影响（near 照走）', () => {
  openStep('bl-3')
  const r = eng.convergeStep('bl-3', { agreed: ['观测 1 ≠ 预测 1'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['read: a', 'rt: b'] }, ticketV: 5 })
  assert.equal(r.ok, true, r.error)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
