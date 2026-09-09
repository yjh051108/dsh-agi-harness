/**
 * debt-ledger.test — 债账的判别力（每条带反例：只测正例=没有判别力）。
 * 案底：69 条预测 17 条靠猜、外部索取 0 次——本文件把「猜错后不许再猜」写成断言。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claimKey, sourceKind, isEvidential, sourceRank, recordDebts, escalateDebts, dischargeDebts, openDebts, worldDebts, refuseGuess, debtLine, REPAY_ORDER } from '../src/debt-ledger.js'

const P = (key, source, value = '1') => ({ key, source, value })

test('d1 claimKey 归一：大小写/空白/标点无关，长键截断', () => {
  assert.equal(claimKey('  Files_Checks  '), 'files_checks')
  assert.equal(claimKey('「文件数」：= 3'), '文件数3')
  assert.equal(claimKey('a'.repeat(80)).length, 48)
  assert.equal(claimKey(null), '')
  assert.notEqual(claimKey('files_checks'), claimKey('vendor_checks'), '不同断言不得归一成同一笔债')
})

test('d2 sourceKind / isEvidential：六种实证形态 vs 猜', () => {
  assert.equal(sourceKind('read:src/a.js#L3'), 'read')
  assert.equal(sourceKind('probe:suite-abs'), 'probe')
  assert.equal(sourceKind('engram:黑洞渲染'), 'engram')
  assert.equal(sourceKind('web:https://x'), 'web')
  assert.equal(sourceKind('prior:惯例区间'), 'prior')
  assert.equal(sourceKind('惯例区间'), 'freetext')
  assert.equal(sourceKind(''), 'none')
  assert.equal(isEvidential('prior:惯例'), false)
  assert.equal(isEvidential('engram:某节点'), true)
  assert.equal(isEvidential('web:https://threejs.org'), true, '向世界要=实证')
})

test('d3 sourceRank：engram > web/plugin/npm > read/probe > prior', () => {
  assert.ok(sourceRank('engram:x') > sourceRank('web:y'))
  assert.equal(sourceRank('web:y'), sourceRank('plugin:z'))
  assert.equal(sourceRank('plugin:z'), sourceRank('npm:three'))
  assert.ok(sourceRank('npm:three') > sourceRank('probe:k'))
  assert.equal(sourceRank('probe:k'), sourceRank('read:p#L1'))
  assert.ok(sourceRank('read:p#L1') > sourceRank('prior:经验'))
  assert.equal(sourceRank('瞎猜'), 0)
  assert.deepEqual(REPAY_ORDER.slice(0, 3), ['engram', 'web', 'plugin'], '便宜优先：能记就记，能借就借')
})

test('d4 recordDebts：非实证来源建债，实证来源不建债', () => {
  const d = recordDebts([], [P('a', 'prior:惯例'), P('b', 'probe:k'), P('c', 'read:x#L1'), P('e', 'engram:n')])
  assert.equal(d.length, 1, '只有 prior 那条建债')
  assert.equal(d[0].claimKey, 'a')
  assert.equal(d[0].state, 'open')
  assert.equal(d[0].misses, 0)
})

test('d5 refuseGuess 首次放行：无债时不拒（第一次猜可以）', () => {
  const d = recordDebts([], [P('a', 'prior:惯例')])
  const r = refuseGuess(d, [P('a', 'prior:另一个说法')])
  assert.equal(r.refuse, false, '未升级的债不拦下一次猜')
})

test('d6 refuseGuess 升级后直拒：同 claimKey 非实证来源拒、实证来源放行', () => {
  let d = recordDebts([], [P('vendor 文件数', 'prior:猜')])
  d = escalateDebts(d, ['vendor 文件数'])
  assert.equal(worldDebts(d).length, 1)
  assert.equal(refuseGuess(d, [P('Vendor 文件数', 'prior:又猜')]).refuse, true, '同一 claimKey（大小写/空白归一）必须拒')
  assert.equal(refuseGuess(d, [P('vendor 文件数', 'probe:ls-vendor')]).refuse, false, '带实证来源放行')
  assert.equal(refuseGuess(d, [P('别的断言', 'prior:猜')]).refuse, false, '不牵连其他断言')
})

test('d7 dischargeDebts 清偿 + 已清偿后重新猜 → 直接升级', () => {
  let d = recordDebts([], [P('a', 'prior:猜')])
  d = dischargeDebts(d, ['a'], 'engram')
  assert.equal(openDebts(d).length, 0, '清偿后不算未清偿')
  assert.equal(d[0].by, 'engram')
  d = recordDebts(d, [P('a', 'prior:再猜一次')])
  assert.equal(d.length, 1, '同一 claimKey 不重复建账')
  assert.equal(d[0].state, 'escalated', '世界答过一次还再猜=直接升级')
  assert.equal(d[0].everEscalated, true, '升级过要留痕（清偿后仍可查）')
  assert.equal(refuseGuess(d, [P('a', 'prior:第三次')]).refuse, true)
})

test('d8 debtLine：无债零注入；有债给笔数与还债优先级', () => {
  assert.equal(debtLine([]), '')
  assert.equal(debtLine([{ claimKey: 'x', state: 'discharged' }]), '', '清偿完=零注入')
  let d = recordDebts([], [P('a', 'prior:猜'), P('b', 'prior:猜')])
  d = escalateDebts(d, ['a'])
  const line = debtLine(d)
  assert.match(line, /欠世界 2 笔/)
  assert.match(line, /已升级 1/)
  assert.match(line, /engram/)
})
