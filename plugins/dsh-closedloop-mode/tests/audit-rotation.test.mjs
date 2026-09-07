/**
 * audit-rotation.test — v0.5.4 R17 回归
 * a1 轮转确定性（counter→slot 可复算）；a2 连续调用轮替；a3 模板 hash 稳定且改字即变；
 * a4 派发卡结构完整；a5 计数器持久（跨实例续轮）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-rot-'))
const AR = await import('../src/audit-rotation.js')

test('a1 轮转确定性：counter%槽数=槽位（同 counter 可复算）', () => {
  fs.writeFileSync(AR.rotationPath(TMP), JSON.stringify({ counter: 6 }))
  const r = AR.nextAuditorSlot(TMP)
  assert.equal(r.counter, 7)
  assert.equal(r.index, 7 % AR.AUDITOR_SLOTS.length)
  assert.equal(r.slot, AR.AUDITOR_SLOTS[r.index])
})

test('a2 连续三次调用轮替不相等相邻', () => {
  fs.writeFileSync(AR.rotationPath(TMP), JSON.stringify({ counter: 0 }))
  const a = AR.nextAuditorSlot(TMP), b = AR.nextAuditorSlot(TMP), c = AR.nextAuditorSlot(TMP)
  assert.notEqual(a.slot, b.slot)
  assert.notEqual(b.slot, c.slot)
  assert.equal(a.slot, c.slot, '两槽轮转周期=2')
})

test('a3 模板 hash：同参稳定，改一字即变', () => {
  const p1 = AR.AUDIT_PROMPT_TEMPLATE('sid-x', '动作A')
  const p2 = AR.AUDIT_PROMPT_TEMPLATE('sid-x', '动作A')
  const p3 = AR.AUDIT_PROMPT_TEMPLATE('sid-x', '动作B')
  assert.equal(AR.templateHash(p1), AR.templateHash(p2))
  assert.notEqual(AR.templateHash(p1), AR.templateHash(p3))
})

test('a4 派发卡完整：slot/promptHash/prompt/auditSid 齐', () => {
  const card = AR.dispatchCard('session-abc12345', '被审动作', TMP)
  assert.ok(card.slot && card.promptHash && card.auditSid.startsWith('audit-'))
  assert.match(card.prompt, /独立审计员（系统派发，不由被审者选择）/)
  assert.match(card.prompt, /逐字子串/)
})

test('a5 计数器持久：新读取从盘上续轮', () => {
  fs.writeFileSync(AR.rotationPath(TMP), JSON.stringify({ counter: 3 }))
  const r = AR.nextAuditorSlot(TMP)
  assert.equal(r.counter, 4)
  const onDisk = JSON.parse(fs.readFileSync(AR.rotationPath(TMP), 'utf8'))
  assert.equal(onDisk.counter, 4, '落盘推进')
})

test('a6 模板含审材注入位与引文规则：brief 注入、截断行不可引、读不到=凭审材不拒审', () => {
  const brief = '【审材·占位】目标 #1「动作A」预测：k=1（依据：prior:fs）\n相邻步：无（单步）\n'
  const p = AR.AUDIT_PROMPT_TEMPLATE('sid-x', '动作A', brief)
  assert.match(p, /【审材·机械切片/, 'brief 注入位在模板中')
  assert.match(p, /截断行不可引/, '引文规则：截断行（…）不可引')
  assert.match(p, /不许拒审/, '读不到文件=凭审材工作（有材必审）')
  assert.equal((p.match(/≤1KB/g) || []).length >= 1 && !p.includes('≤800B'), true, 'v0.6.32 单契约：一套输出契约，无 800B 旧形')
  assert.ok(!/v0\.6\.\d/.test(p), '无版本考古（规则按逻辑不按出生年）')
  assert.match(p, /逐字子串/, 'quotes 硬验不变式保留')
  assert.ok(p.includes(brief), 'brief 全文在 prompt 内')
  // 兼容：无 brief 参数不报错
  assert.ok(AR.AUDIT_PROMPT_TEMPLATE('sid-x', '动作A').includes('审三问'))
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
