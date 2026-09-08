/**
 * tools-mutation-guard.test — v0.8.19 tools.js 变异守护（每条断言指向真实行为差异）
 * tg1 截断边界（杀 cut 的 num-plus1 0→1 与 length-plus1 .length→.length+1）
 * tg2 测量选取（杀 withM 的 filter→map 与 measureReads 的 return null→undefined）
 * tg3 工具输出契约（杀 OUT.schema additionalProperties false→true 与 render 的 ||→&&）
 * tg4 extractSigns 异步（杀 drop-await）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'tg-'))
const T = await import('../src/tools.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })

test('tg1 回执截断边界（purpose 81 字截断、恰好 80 字不截断）', async () => {
  const d = T.costSetDefinition()
  const long = 'P'.repeat(81)
  const r1 = await d.execute({ purpose: long, assertions: [{ text: 'a', severity: 'major', source: 's' }] }, exec('tg1a'))
  assert.ok(r1.text.includes('P'.repeat(80) + '…'), '80 字 + 省略号（81>80 才截）')
  const short = 'Q'.repeat(80) // 恰好 80 字：>n 为假=不截断（杀 .length→.length+1：80+1>80 会截）
  const r2 = await d.execute({ purpose: short, assertions: [{ text: 'a', severity: 'major', source: 's' }] }, exec('tg1b'))
  assert.ok(r2.text.includes(short), '恰好 80 字原样保留')
  assert.ok(!r2.text.includes(short + '…'), '未超长不截断')
})

test('tg2 测量断言选取与空值契约', () => {
  const st = {
    cost: { assertions: [
      { text: '无测量断言', severity: 'major' },
      { text: '带测量断言', severity: 'critical', measure: { cmd: 'node x.mjs', kind: 'bool' } },
    ] },
  }
  const r = T.measureReads(st, () => '1')
  assert.ok(r, '有测量断言=不返回空')
  assert.equal(r.total, 1, 'filter 只留带 measure 的（map 会让 undefined 混入并抛错）')
  assert.equal(T.measureReads({ cost: { assertions: [{ text: 'x', severity: 'major' }] } }, () => '1'), null, '无测量=null（不是 undefined）')
})

test('tg3 工具输出契约（schema 与 render）', () => {
  const d = T.costSetDefinition()
  assert.equal(d.output.schema.additionalProperties, false, '输出契约禁额外字段')
  assert.deepEqual(d.output.render(null, { text: '回执正文' }), [{ type: 'text', text: '回执正文' }], 'render 返回文本块')
})

test('tg4 extractSigns 走异步帧（deriveMessages 是 async）', async () => {
  const set = await T.extractSigns({ agent: { session: { deriveMessages: async () => [{ role: 'user', source: { kind: 'user', rpcId: 'r' }, content: '签收 G' }] } } })
  assert.deepEqual([...set], ['G'], '缺 await 时 ms 是 Promise → 采集为空集')
})
