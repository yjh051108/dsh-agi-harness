/**
 * v04-engram.test — v0.4.6 学习环融合回归
 * e1-e6：engram: 来源形式（confirmed 放行/[[括号]]兼容/pending 拒/缺节点拒/图谱不可达拒/四形式错误文本）
 * e7：distillDraft 纯函数（terminal 写路径草稿）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-eng-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP // 钉住引擎第二候选 homedir()（v0.4.6 双路径扫描——不钉会误命中真实用户库）
fs.mkdirSync(path.join(TMP, 'engram-relay'), { recursive: true })
const STORE = path.join(TMP, 'engram-relay', 'engrams.jsonl')
fs.writeFileSync(STORE, [
  { title: '已确认节点', summary: '实测结论 X=1', status: 'confirmed' },
  { title: '无字段节点', summary: '老库直接 store 语义=confirmed（live 实测 2141/2142 无字段）' },
  { title: '待确认节点', summary: '还没确认', status: 'pending' },
].map((n) => JSON.stringify(n)).join('\n'))

const eng = await import('../src/optimal-engine.js')
const pt = await import('../src/propose-text.js')

test('e1 engram: confirmed 节点放行且回显 summary', () => {
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:已确认节点' }])
  assert.equal(r.ok, true)
  assert.equal(r.stats.engram, 1)
  assert.match((r.hits || [])[0] || '', /✓.*实测结论/)
})

test('e2 [[双括号]]写法兼容', () => {
  assert.equal(eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:[[已确认节点]]' }]).ok, true)
})

test('e3 pending 节点拒（确认制=记忆信任级 R15）', () => {
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:待确认节点' }])
  assert.equal(r.ok, false)
  assert.match(r.error, /待确认/)
})

test('e3b 无 status 字段=老库 store-direct 语义放行（live 实测 2141/2142 无字段——E2E 二轮语义案底）', () => {
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:无字段节点' }])
  assert.equal(r.ok, true)
  assert.equal(r.stats.engram, 1)
})

test('e4 缺节点拒并指路（先写图或降 prior:）', () => {
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:幽灵节点' }])
  assert.equal(r.ok, false)
  assert.match(r.error, /无节点/)
})

test('e5 图谱不可达拒并指路 prior:（诚实降级不装全知）', () => {
  const txt = fs.readFileSync(STORE, 'utf8')
  fs.unlinkSync(STORE)
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: 'engram:已确认节点' }])
  assert.equal(r.ok, false)
  assert.match(r.error, /不可达/)
  fs.writeFileSync(STORE, txt)
})

test('e6 自由文本错误文本已更新为四形式（含 engram:）', () => {
  const r = eng.checkPredictionSources('s1', [{ key: 'k', value: '1', source: '自由文本' }])
  assert.equal(r.ok, false)
  assert.match(r.error, /engram:<title>/)
})

test('e7 distillDraft：闭合+回炉+V 轨迹机械成稿；无闭合返回 null', () => {
  const s = { cost: { purpose: '学习环融合开发，端到端自测' }, closed: [{ title: '引擎闸', v: 4 }, { title: '端到端单', v: 0 }] }
  const d = pt.distillDraft(s, { rolledBack: [{ reason: '预测模型错：门槛未校准' }] })
  assert.match(d, /蒸馏草稿/)
  assert.match(d, /闭合2·回炉1·V4→0/)
  assert.match(d, /门槛未校准/)
  assert.match(d, /engram_propose/)
  assert.equal(pt.distillDraft({ closed: [] }, { rolledBack: [] }), null)
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
