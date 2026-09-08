/**
 * freeze-decision.test — v0.8.13 弹窗决策结构化（去标签子串匹配）
 * fd1 选项标签前缀协议：确认·开执行阶段→approve；反驳·解锁重排→reject
 * fd2 未知/含混标签不猜（fail-closed）：暂不确认→null（旧实现误 approve），双选→null
 * fd3 补充文字走否定感知：先不要确认→reject；确认→approve
 * fd4 显式结构化值优先于标签
 * fd5 选项优先于补充文字
 * fd6 空答案 → null（fail-closed）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { decideFreezeAnswer, labelIntent, FREEZE_OPTIONS } = await import('../src/intent.js')
const { decideFreezeAnswer: viaIndex } = await import('../src/index.js')

test('fd1 选项标签前缀协议', () => {
  assert.equal(decideFreezeAnswer({ selected: ['确认·开执行阶段'] }).intent, 'approve')
  assert.equal(decideFreezeAnswer({ selected: ['反驳·解锁重排'] }).intent, 'reject')
  assert.equal(labelIntent('确认·开快环'), 'approve', '同前缀兼容（既有 t11 测例）')
  assert.equal(FREEZE_OPTIONS.length, 2)
})

test('fd2 未知/含混标签 fail-closed', () => {
  assert.equal(decideFreezeAnswer({ selected: ['暂不确认'] }).intent, null, '旧实现 /确认/.test → 误 approve')
  assert.equal(decideFreezeAnswer({ selected: ['确认修改'] }).intent, null)
  assert.equal(decideFreezeAnswer({ selected: ['确认·开执行阶段', '反驳·解锁重排'] }).intent, null)
  assert.equal(decideFreezeAnswer({ selected: ['随便点了一个'] }).via, 'unknown-label')
})

test('fd3 补充文字走否定感知（单一真相）', () => {
  assert.equal(decideFreezeAnswer({ custom: '先不要确认' }).intent, 'reject')
  assert.equal(decideFreezeAnswer({ custom: '确认' }).intent, 'approve')
  assert.equal(decideFreezeAnswer({ custom: 'not ok' }).intent, 'reject')
})

test('fd4 显式结构化值优先', () => {
  const r = decideFreezeAnswer({ decision: 'reject', selected: ['确认·开执行阶段'] })
  assert.equal(r.intent, 'reject')
  assert.equal(r.via, 'json')
})

test('fd5 选项优先于补充文字', () => {
  const r = decideFreezeAnswer({ selected: ['确认·开执行阶段'], custom: '第三组判据收紧' })
  assert.equal(r.intent, 'approve')
  assert.equal(r.via, 'label')
})

test('fd6 空答案 fail-closed，且 index.js 兼容再导出', () => {
  assert.equal(decideFreezeAnswer({}).intent, null)
  assert.equal(decideFreezeAnswer(null).intent, null)
  assert.equal(typeof viaIndex, 'function', 'index.js 再导出同一实现')
})
