/**
 * chain.test — v0.5.3 哈希链账本回归（R18 第一层：篡改可检测）
 * k1 增长+验证绿；k2 内容未变不重复入链；k3 链外改写账本→红"篡改"；
 * k4 手写伪造链行→红"伪造"；k5 无链老账本→灰非红（诚实位）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-chain-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const eng = await import('../src/optimal-engine.js')

const stackOf = (n, status) => ({ version: 2, steps: Array.from({ length: n }, (_, i) => ({ n: i + 1, title: 's' + i, status })), rolledBack: [] })

test('k1 saveStack 入链：链增长且 verify 绿', () => {
  const sid = 'ch-1'
  eng.saveStack(sid, stackOf(1, 'closed'))
  let v = eng.verifyChain(sid)
  assert.equal(v.ok, true)
  assert.equal(v.entries, 1)
  eng.saveStack(sid, stackOf(2, 'closed'))
  v = eng.verifyChain(sid)
  assert.equal(v.entries, 2, '新内容入链')
})

test('k2 同内容重复 save 不重复入链（幂等）', () => {
  const sid = 'ch-2'
  const s = stackOf(1, 'closed')
  eng.saveStack(sid, s)
  eng.saveStack(sid, JSON.parse(JSON.stringify(s)))
  assert.equal(eng.verifyChain(sid).entries, 1)
})

test('k3 链外改写账本 → 红「篡改」（账本 digest ≠ 链头）', () => {
  const sid = 'ch-3'
  eng.saveStack(sid, stackOf(2, 'closed'))
  // 模拟模型用 edit 工具直接改账本（绕过 saveStack）：偷删一个步
  const f = eng.optimalFileFor(sid)
  const s = JSON.parse(fs.readFileSync(f, 'utf8'))
  s.steps.pop()
  fs.writeFileSync(f, JSON.stringify(s))
  const v = eng.verifyChain(sid)
  assert.equal(v.ok, false)
  assert.equal(v.red, '篡改')
})

test('k4 手写伪造链行 → 红「伪造」（h≠sha256(prev+d)）', () => {
  const sid = 'ch-4'
  eng.saveStack(sid, stackOf(1, 'closed'))
  fs.appendFileSync(eng.chainFileFor(sid), JSON.stringify({ seq: 1, at: Date.now(), prev: 'f'.repeat(64), d: 'a'.repeat(64), h: 'b'.repeat(64) }) + '\n')
  const v = eng.verifyChain(sid)
  assert.equal(v.ok, false)
  assert.ok(['伪造', '断链'].includes(v.red), `实际=${v.red}`)
})

test('k5 无链老账本 → 灰（empty，不冒充红也不冒充绿保证）', () => {
  const sid = 'ch-5'
  fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
  fs.writeFileSync(path.join(TMP, 'graded-state', `ch-5.optimal.json`), JSON.stringify(stackOf(3, 'closed')))
  const v = eng.verifyChain(sid)
  assert.equal(v.ok, true)
  assert.equal(v.empty, true)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
