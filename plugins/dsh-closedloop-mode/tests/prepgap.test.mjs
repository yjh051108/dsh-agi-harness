/** prepgap.test — r66 准备黑洞闸门锁：首步迟到留痕；正常首步不误伤 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-pg-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP
const eng = await import('../src/optimal-engine.js')
const args = (x) => ({ title: '首步', predictions: [{ key: 'k', value: '1', source: 'prior:测' }], measure: { channels: ['read: a', 'rt: b'] }, law: [{ signal: '红', action: '修' }], ticketBand: 'far', ...x })

test('pg1 正常首步（开环即声明）：无 prepGapMin 无多计 discrepancy', () => {
  eng.saveStack('pg-1', { version: 2, steps: [], rolledBack: [] })
  const r = eng.declareStep('pg-1', args())
  assert.equal(r.ok, true, r.error)
  const st = eng.loadStack('pg-1')
  const step = st.steps.at(-1)
  assert.equal(step.prepGapMin, undefined)
  assert.equal(step.discrepancies.length, 0)
})

test('pg2 首步迟到 40 分钟：留痕 prepGapMin + 卷面带"准备黑洞"', () => {
  eng.saveStack('pg-2', { version: 2, steps: [], rolledBack: [] })
  const f = eng.optimalFileFor('pg-2')
  const past = new Date(Date.now() - 40 * 60000)
  fs.utimesSync(f, past, past)
  const r = eng.declareStep('pg-2', args())
  assert.equal(r.ok, true, r.error)
  const step = eng.loadStack('pg-2').steps.at(-1)
  assert.ok(step.prepGapMin >= 10 && step.prepGapMin <= 45, 'gap=' + step.prepGapMin)
  assert.match(step.discrepancies.join(' '), /准备黑洞/)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
