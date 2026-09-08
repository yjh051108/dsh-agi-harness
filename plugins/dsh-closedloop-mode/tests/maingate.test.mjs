/**
 * maingate.test — maintainGate（declare 时刻预拦 at 档**显式**非法预期）
 * m1 at 档未标 vExpect → 引擎按档位推导 maintain 放行（v0.8.26 摩擦修复：不再逼模型猜）
 * m2 标 maintain=放行；m3 非 at 档未标不误伤；m5/m6 显式 improve（含 merge 注入）仍拦
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-mg-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP
const eng = await import('../src/optimal-engine.js')

const baseStep = (after) => ({ n: 1, title: '前步', status: 'closed', at: Date.now() - 5000, dv: { before: 'far', after, channels: ['a', 'b'], mode: 'improve' }, predictions: [], signature: 'x' })
const args = (extra) => ({ title: '新步', predictions: [{ key: 'k', value: '1', source: 'prior:测试先验' }], measure: { channels: ['read: a', 'rt: b'] }, law: [{ signal: '红', action: '回炉' }], ticketBand: 'at', ...extra })

test('m1 at 档未标 vExpect → 引擎推导 maintain 放行（v0.8.26：档位是引擎已知事实，不逼模型猜）', () => {
  eng.saveStack('mg-1', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const r = eng.declareStep('mg-1', args())
  assert.equal(r.ok, true, r.error || '')
  assert.equal(r.step.vExpect, 'maintain', '按 beforeBand=at 推导')
  assert.equal(r.step.vExpectSource, 'derived')
})

test('m2 at 档标 maintain → 放行落盘', () => {
  eng.saveStack('mg-2', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const r = eng.declareStep('mg-2', args({ vExpect: 'maintain' }))
  assert.equal(r.ok, true)
})

test('m3 near 档未标不误伤（改善通道照走）', () => {
  eng.saveStack('mg-3', { version: 2, steps: [baseStep('near')], rolledBack: [] })
  const r = eng.declareStep('mg-3', args({ ticketBand: 'near' }))
  assert.equal(r.ok, true)
})

test('m7 定界锁（r48 越界案）：栈尾带旧票 at 但本票 ticketBand=far/缺省——不误拦新票首步', () => {
  eng.saveStack('mg-7', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const r = eng.declareStep('mg-7', args({ ticketBand: 'far' }))
  assert.equal(r.ok, true, '新票首步不得被上票档位拦（假阳性比漏拦更伤信任）')
  const r2 = eng.declareStep('mg-8', { ...args(), ticketBand: undefined })
  assert.equal(r2.ok, true, '无权威 band 宁放不误伤')
})

test('m4 回归锁本身在尺面（check-maintain 判据引用 maintainGate——机制+锁双在才算收口）', async () => {
  // 发布面自包含：机检脚本是私有部署件，不存在=跳过该锁检查（诚实标注，不谎绿）
  const ext = process.env.CL_CHECK_MAINTAIN || ''
  if (!ext || !fs.existsSync(ext)) { console.warn('机检脚本不可得（私有部署件），m4 跳过——发布面不含机检件'); return }
  const src = fs.readFileSync(ext, 'utf8')
  assert.match(src, /maintainGate/)
  assert.match(src, /h10|回归锁/)
})

test('m5 at 档显式 improve 也拦（r44 语义判据：at 无 downhill，写法不问出处）', () => {
  eng.saveStack('mg-5', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const r = eng.declareStep('mg-5', args({ vExpect: 'improve' }))
  assert.equal(r.ok, false)
  assert.match(r.error, /maintainGate/)
})

test('m6 生产形状锁（r43 哑火案根因）：merge 注入默认 improve 后的 contract 仍被拦', async () => {
  const cm = await import('../src/contract-merge.js')
  eng.saveStack('mg-6', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const diff = { title: '新步', group: 'g', predict: [{ key: 'k', value: '1', source: 'prior:测试' }], channels: ['read: a', 'rt: b'] }
  const m = typeof cm.materialize === 'function' ? cm.materialize({ lastBand: 'at', qn: [] }, diff) : null
  let contract
  // v0.8.26：materialize 不再注入 'improve'（省略=undefined→引擎推导）。本锁复造**旧生产形状**（显式 improve），
  // 验的语义没变：值在场就必须被查（哑火根因=判据依赖 undefined）。
  contract = m && m.ok ? { ...m.contract, vExpect: 'improve' } : { ...diff, predictions: diff.predict, vExpect: 'improve' }
  contract.ticketBand = 'at' // r48 定界后生产形状=tools 注入本票权威档
  const r = eng.declareStep('mg-6', contract)
  assert.equal(r.ok, false, '显式 improve 也拦=语义判据不依赖 undefined（哑火根治）')
  assert.match(r.error, /maintainGate/)
})

test('m7 验证类回归锁：at 档验证/核验步 vExpect=maintain 全链闭合（46de0bd4 实操映射）', () => {
  eng.saveStack('mg-7', { version: 2, steps: [baseStep('at')], rolledBack: [] })
  const r = eng.declareStep('mg-7', args({ vExpect: 'maintain' }))
  assert.equal(r.ok, true, '验证类 at→at maintain 声明过闸')
  const dv = { beforeBand: 'at', measuredBand: 'at', channels: ['read: a', 'rt: b'] }
  const c = eng.convergeStep('mg-7', { agreed: ['k: 1'], discrepancies: [], dv })
  assert.equal(c.step?.status ?? c.status, 'closed', '测后仍 at=闭合（验证类闭环）')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
