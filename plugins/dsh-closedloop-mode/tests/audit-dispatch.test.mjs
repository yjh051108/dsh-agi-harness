/** audit-dispatch 测例：审材切片预算与禁全栈 / parseVerdict 三态 / receipt 上限 / 落账往返。真栈只读。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { auditBrief, parseVerdict, recordAuditVerdict, BRIEF_BUDGET, RECEIPT_BUDGET } from '../src/audit-dispatch.js'
import { serializeState, deserializeState, initMode } from '../src/mode-state.js'

/** 内联最小栈（自包含——开源不依赖任何机器的真实盘档；邻步标题/预测字段为断言词）。 */
const T = '差分契约与准入闸：args=diff / engine=merge'
const raw = JSON.stringify({ version: 2, steps: [
  { n: 14, title: '盘档 v3：权重驻留与轨迹除合同', status: 'closed', dv: { before: 'far', after: 'at' } },
  { n: 15, title: T, status: 'closed', predictions: [{ key: '物化形状', value: '24B', source: 'prior:s' }, { key: '体积比', value: '0.5', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['p:a', 'p:b'] }, dv: { before: 'far', after: 'at', mode: 'improve' }, agreed: [], discrepancies: [], cost: [] },
  { n: 16, title: '快环 Propose 试航', status: 'closed', dv: { before: 'at', after: 'at' } },
], rolledBack: [] })
const steps = JSON.parse(raw).steps

test('p1 审材=切片非全栈：≤1536B、含目标契约与邻域两步、其余步预测全文零出现', () => {
  const r = auditBrief({ stackRaw: raw, targetTitle: T, cost: { assertions: [{ text: 'x', severity: 'catastrophic' }] } })
  assert.equal(r.ok, true)
  assert.ok(Buffer.byteLength(r.brief, 'utf8') <= BRIEF_BUDGET)
  assert.ok(r.brief.includes('物化形状') && r.brief.includes('体积比'), '目标步契约字段在面')
  assert.ok(r.brief.includes('盘档 v3') && r.brief.includes('快环 Propose'), '邻域恰两步')
  assert.equal(r.brief.includes('git status'), false, '他步预测未泄入（#15 专属文本不在场）')
  assert.equal(r.brief.includes('hover 面板设计稿'), false, '远端步标题不泄')
  const missing = auditBrief({ stackRaw: raw, targetTitle: '不存在步', cost: null })
  assert.equal(missing.ok, false, '目标不在栈=拒（禁臆构造）')
  const withPath = auditBrief({ stackRaw: raw, targetTitle: T, cost: { assertions: [{ text: 'x', severity: 'catastrophic' }] }, stackPath: 'C:/x/graded-state/sid.optimal.json' })
  assert.ok(withPath.brief.includes('盘档原文：C:/x/graded-state/sid.optimal.json'), '审卡附盘档绝对路径')
  assert.ok(withPath.brief.includes('逐字子串'), '明示引文须出自该文件')
})

test('p2 parseVerdict 三态：合法过 / reject 无据拒 / 引文非原文拒', () => {
  const truth = JSON.parse(raw).steps.find((s) => s.title === T)
  const goodQuote = '「' + truth.title.slice(0, 7) + '：args=diff'
  assert.ok(raw.includes(goodQuote) || raw.includes(truth.title), '引文素材真实在盘')
  const ok = parseVerdict({ stackRaw: raw, verdictText: `前置废话 {"verdict":"pass","issues":[],"quotes":["${truth.title}"]} 后置废话` })
  assert.equal(ok.ok, true)
  assert.equal(ok.verdict.verdict, 'pass')
  const bad1 = parseVerdict({ stackRaw: raw, verdictText: '{"verdict":"reject","issues":[],"quotes":["' + goodQuote + '"]}' })
  assert.equal(bad1.ok, false, 'reject 无证据清单=拒')
  const bad2 = parseVerdict({ stackRaw: raw, verdictText: '{"verdict":"pass","quotes":["这句话绝不可能在盘档里出现qwerty"]}' })
  assert.equal(bad2.ok, false, '伪造引文=拒')
  // v0.8.6 案底 4237f058：quotes 元素为对象 → 不再误报伪造，拒因明确指路
  const objQ = parseVerdict({ stackRaw: raw, verdictText: JSON.stringify({ verdict: 'pass', issues: [], quotes: [{ text: truth.title }] }) })
  assert.equal(objQ.ok, false, '对象引文仍拒（串化必不符）')
  assert.match(objQ.error, /已被串化比对必不符/, '拒因指路而非只报伪造')
  assert.match(bad2.error, /非盘档原文/)
  const bad3 = parseVerdict({ stackRaw: raw, verdictText: '没有 JSON' })
  assert.equal(bad3.ok, false)
})

test('p3 receipt 上限硬闸：>1KB 拒收并给浓缩指引', () => {
  const fat = { verdict: 'pass', issues: [], quotes: ['x'.repeat(600), 'y'.repeat(600)] }
  assert.ok(Buffer.byteLength(JSON.stringify(fat)) > RECEIPT_BUDGET)
  const r = parseVerdict({ stackRaw: raw, verdictText: JSON.stringify(fat) })
  assert.equal(r.ok, false)
  assert.match(r.error, /超 \d+B 上限.*浓缩/s)
})

test('p4 落账进盘档 v3 且 serialize 往返保留', () => {
  let s = { ...initMode(), stage: 'rolling', closed: [{ title: 'X', group: 'G', at: 1, band: 'near', audit: null }] }
  const v = { verdict: 'pass', issues: [], quotes: ['q'], at: 2 }
  const r = recordAuditVerdict(s, 'X', v)
  assert.equal(r.ok, true)
  s = r.state
  const again = recordAuditVerdict(s, 'X', { ...v, verdict: 'reject', issues: ['i'] }).state
  assert.equal(again.closed[0].audit.rounds, 2)
  const rt = deserializeState(JSON.parse(JSON.stringify(serializeState(again))))
  assert.equal(rt.closed[0].audit.rounds, 2, '审史跨 serialize 存活')
  assert.equal(recordAuditVerdict(s, '不在集', v).ok, false)
})
