/**
 * agreed-structured.test — v0.8.11 对账结构化路径去正则化
 * as1 结构化路径零正则：交叉污染场景仍正确闭合
 * as2 字符串路径在同样场景下确实误判（脆弱性实证，非臆造）
 * as3 结构化 pair 实测与声明不等 → 预言失效（fail-safe 保留）
 * as4 旧字符串路径兼容（无结构化副本时走原判定）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'agr-'))
process.env.DSH_HOME = TMP
const { declareStep, convergeStep, loadStack, agreedMatch } = await import('../src/optimal-engine.js')

const DV = { beforeBand: 'far', measuredBand: 'at', channels: ['盘档: state.json', '运行时: 日志'] }

function decl(sid, key, value) {
  return declareStep(sid, {
    title: 'T', invariants: ['不变量'],
    predictions: [{ key, value, source: 'prior:测试' }],
    cost: [{ failure: 'f', defense: 'd' }],
    law: [{ signal: 's', action: 'a' }],
    measure: { right: 'r', wrongSignal: 'w', channels: ['a', 'b'] },
    vExpect: 'improve', confidence: 'high',
  })
}

test('as1 结构化路径零正则：交叉污染场景仍正确闭合', () => {
  const sid = 'as1'
  assert.equal(decl(sid, 'k', '1').ok, true)
  // 另一条 pair 的文本里含 'k'（字符串路径的 includes(key) 会误取它）
  const r = convergeStep(sid, {
    agreedPairs: [
      { key: 'j', measured: 'k=999', predicted: 'k=999' },
      { key: 'k', measured: '1', predicted: '1' },
    ],
    dv: DV,
  })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(loadStack(sid).steps[0].status, 'closed', '结构化判定取的是 k 自己的 pair')
})

test('as2 字符串路径在同样场景下确实误判（脆弱性实证）', () => {
  // 渲染串顺序：j 行在前且文本含 'k' → includes('k') 命中 j 行，把 k=999 当成 k 的实测值
  const rendered = 'j: 实测 k=999 ≠ 预测 k=999'
  const m = agreedMatch(rendered, 'k', '1')
  assert.equal(m.ok, false, '字符串路径误取他行 → 判定失败（这正是要去掉的正则脆弱性）')
})

test('as3 结构化 pair 实测与声明不等 → 差异入账且不闭合（fail-safe 保留）', () => {
  const sid = 'as3'
  assert.equal(decl(sid, 'k', '1').ok, true)
  const r = convergeStep(sid, { agreedPairs: [{ key: 'k', measured: '2', predicted: '1' }], dv: DV })
  // 契约：convergeStep 不抛错，而是把差异写入 step.discrepancies（工具层据此渲染「预言失效」）
  const step = r.step || loadStack(sid).steps[0]
  assert.ok(step.discrepancies.length > 0, '不等必须入账差异')
  assert.notEqual(step.status, 'closed', '未闭合')
  assert.match(String(step.discrepancies.join('；')), /实测 2 与声明值 1 不等|不等/, '差异如实记录')
})

test('as4 旧字符串路径兼容（无结构化副本时走原判定）', () => {
  const sid = 'as4'
  assert.equal(decl(sid, 'k', '1').ok, true)
  const r = convergeStep(sid, { agreed: ['k: 实测 1 ≠ 预测 1'], dv: DV })
  assert.equal(r.ok, true, r.error || '')
  assert.equal(loadStack(sid).steps[0].status, 'closed')
})
