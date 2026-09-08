/**
 * declare-aesthetic-nudge.test — v0.8.34 降噪①：审美/无通道任务的声明提示
 * a1 含人判项 ⇒ 出提示（点数 + 关键词）
 * a2 无组/无人判项 ⇒ 空串（零注入）
 * a3 多条人判项 ⇒ 计数正确
 * a4 提示里明确「不要写成 predict 数值」+ 指路人判欠据
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { aestheticNudge, humanItemCount } = await import('../src/nudges.js')

test('a1 含人判项 ⇒ 出提示', () => {
  const g = { title: '视觉验收', accept: ['cmd:node tests/x.mjs', '人判: 开发者目测画面是否符合池核美学'] }
  const t = aestheticNudge(g)
  assert.match(t, /本组含 1 条人判项/)
  assert.match(t, /人判欠据/)
  assert.match(t, /不要写成 predict 数值/)
  assert.equal(humanItemCount(g), 1)
})

test('a2 无组/无人判项 ⇒ 空串', () => {
  assert.equal(aestheticNudge(null), '')
  assert.equal(aestheticNudge({}), '')
  assert.equal(aestheticNudge({ accept: ['cmd:node tests/x.mjs'] }), '')
  assert.equal(humanItemCount({ accept: [] }), 0)
})

test('a3 多条人判项 ⇒ 计数正确', () => {
  const g = { accept: ['人判: a', '人判: b', 'cmd: c', '人判: d'] }
  assert.equal(humanItemCount(g), 3)
  assert.match(aestheticNudge(g), /本组含 3 条人判项/)
})

test('a4 提示带案底数字（提醒代价）', () => {
  const t = aestheticNudge({ accept: ['人判: x'] })
  assert.match(t, /218/)
  assert.match(t, /回炉/)
})
