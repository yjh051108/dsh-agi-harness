import { test } from 'node:test'
import assert from 'node:assert'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recordLesson, readLessons, sameCategoryCount, lessonSummary } from '../src/learning-organ.js'

const TD = () => mkdtempSync(join(tmpdir(), 'learn-'))

test('l1 追加/读回：教训落盘且字段完整', () => {
  const d = TD()
  recordLesson('cmd-crossplatform', '用了 head', 't', d)
  const ls = readLessons(d)
  assert.equal(ls.length, 1)
  assert.equal(ls[0].category, 'cmd-crossplatform')
  assert.equal(ls[0].detail, '用了 head')
})

test('l2 同类计数（再犯检测）', () => {
  const d = TD()
  recordLesson('a', '第一次', 't', d)
  recordLesson('a', '第二次', 't', d)
  recordLesson('b', '别的', 't', d)
  assert.equal(sameCategoryCount('a', d), 2)
  assert.equal(sameCategoryCount('b', d), 1)
})

test('l3 摘要：空=零税；多次=再犯提醒', () => {
  const d = TD()
  assert.equal(lessonSummary(3, d), '')
  recordLesson('cmd-crossplatform', '用了 head', 't', d)
  recordLesson('cmd-crossplatform', '用了 grep', 't', d)
  const sum = lessonSummary(3, d)
  assert.ok(sum.includes('cmd-crossplatform×2'))
  assert.ok(sum.includes('再犯提醒'))
})

test('l4 只追加不可篡改：再写不覆盖旧教训', () => {
  const d = TD()
  recordLesson('x', '旧', 't', d)
  recordLesson('y', '新', 't', d)
  const ls = readLessons(d)
  assert.equal(ls.length, 2)
  assert.equal(ls[0].detail, '旧')
})

test('l5 跨会话不串原文：他会话教训只给类别级通用提醒（v0.8.1）', () => {
  const d = TD()
  recordLesson('reconcile-mismatch', '对账不吻合：接口数 实测 5 与预测 3 不等', 'optimal-engine:convergeStep', d, 'other-sid')
  const sum = lessonSummary(3, d, 'my-sid')
  assert.ok(sum.includes('reconcile-mismatch×1'))
  assert.ok(!sum.includes('接口数 实测 5'), '他不会话的具体数字不得注入')
  assert.ok(sum.includes('先真跑一遍'), '给通用提醒')
})

test('l6 同会话教训仍给原文（看得见的镜子）', () => {
  const d = TD()
  recordLesson('reconcile-mismatch', '对账不吻合：接口数 实测 5 与预测 3 不等', 'optimal-engine:convergeStep', d, 'my-sid')
  const sum = lessonSummary(3, d, 'my-sid')
  assert.ok(sum.includes('接口数 实测 5'), '同会话=自己的账，原文可见')
})
