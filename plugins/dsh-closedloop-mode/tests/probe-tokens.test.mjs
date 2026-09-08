/**
 * probe-tokens.test — v0.8.18 探针 token 提取协议化
 * pt1 既有形态不破：n=12 / m=3.5 / k: 7
 * pt2 符号位：x=-0.5 / y=+2（旧正则取不到负号值）
 * pt3 指数：z=1e3 / w=-2.5E-2
 * pt4 边界：不吞路径/括号内容；空输入=[]
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { probeTokens } = await import('../src/tools.js')

test('pt1 既有形态不破', () => {
  assert.deepEqual(probeTokens('n=12, m=3.5'), ['n=12', 'm=3.5'])
  assert.deepEqual(probeTokens('k: 7'), ['k=7'])
  assert.deepEqual(probeTokens('命中=4（通道 A）'), ['命中=4'])
})

test('pt2 符号位', () => {
  assert.deepEqual(probeTokens('x=-0.5'), ['x=-0.5'], '旧正则得 []（负号挡在数字前）')
  assert.deepEqual(probeTokens('ΔV=-1 y=+2'), ['ΔV=-1', 'y=+2'])
})

test('pt3 指数', () => {
  assert.deepEqual(probeTokens('z=1e3'), ['z=1e3'])
  assert.deepEqual(probeTokens('w=-2.5E-2'), ['w=-2.5E-2'])
})

test('pt4 边界', () => {
  assert.deepEqual(probeTokens('path=a/b/c'), [], '非数值值不列（本函数只列数值 token）')
  assert.deepEqual(probeTokens('at 12:30 命中=3'), ['命中=3'], '时间戳 12:30 不当 token（冒号形态要求键以字母/CJK 开头）')
  assert.deepEqual(probeTokens(''), [])
  assert.deepEqual(probeTokens(null), [])
})
