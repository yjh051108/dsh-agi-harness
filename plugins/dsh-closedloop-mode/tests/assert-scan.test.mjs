/**
 * assert-scan.test — v0.8.23 弱断言分类器（确定性，纯函数）
 * as1 分类三档：strong / weak / unknown
 * as2 取反与量词算强
 * as3 实参抽取（括号配平 + 字符串内括号不干扰）
 * as4 聚合报告（ratio 与最差清单）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { classifyExpression, extractAssertArgs, scanAssertions, weakReport } = await import('../scripts/lib/assert-scan.mjs')

test('as1 分类三档', () => {
  assert.equal(classifyExpression('r.ok'), 'weak', '裸成员链=弱')
  assert.equal(classifyExpression('x'), 'weak')
  assert.equal(classifyExpression('a === b'), 'strong')
  assert.equal(classifyExpression('r.text.includes("x")'), 'strong')
  assert.equal(classifyExpression('groups.length'), 'strong', '长度断言=强')
  assert.equal(classifyExpression('fn(a, b)'), 'unknown', '函数调用静态判不了')
  assert.equal(classifyExpression(''), 'unknown')
})

test('as2 取反与量词算强', () => {
  assert.equal(classifyExpression('!r.ok'), 'strong')
  assert.equal(classifyExpression('list.some((x) => x > 1)'), 'strong')
  assert.equal(classifyExpression('a && b'), 'strong')
  assert.equal(classifyExpression('n < 3'), 'strong')
})

test('as3 实参抽取（括号配平）', () => {
  const src = 'assert.ok(a === b);\nassert.ok(fn("含(括号)与)引号"));\nassert.ok(r.ok)'
  const args = extractAssertArgs(src)
  assert.equal(args.length, 3)
  assert.equal(args[0], 'a === b')
  assert.equal(args[2], 'r.ok')
  assert.match(args[1], /^fn\(/, '嵌套括号被完整取出')
})

test('as4 扫描与聚合报告', () => {
  const s = scanAssertions('assert.ok(x); assert.ok(a === b); assert.ok(fn(1))')
  assert.deepEqual({ total: s.total, strong: s.strong, weak: s.weak, unknown: s.unknown }, { total: 3, strong: 1, weak: 1, unknown: 1 })
  assert.equal(s.ratio, 0.333)
  const rep = weakReport([
    { file: 'a.test.mjs', text: 'assert.ok(x); assert.ok(y)' },
    { file: 'b.test.mjs', text: 'assert.ok(a === b)' },
  ])
  assert.equal(rep.totals.total, 3)
  assert.equal(rep.totals.weak, 2)
  assert.equal(rep.worst[0].file, 'a.test.mjs', 'ratio 高者在前')
  assert.equal(rep.worst.length, 1, '无弱断言的文件不进最差清单')
})
