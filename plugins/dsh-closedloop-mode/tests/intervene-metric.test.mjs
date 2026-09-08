/**
 * intervene-metric.test — v0.8.27 介入率双口径（纯函数）
 * iv1 帧分类：goal/plugin/agent-instructions 不算人；kind=user+rpcId 才算
 * iv2 步窗口：声明→闭合；无闭合记录=到下一步声明；末步=Infinity
 * iv3 求交：窗口内 vs 空档
 * iv4 双口径计算：rate（旧）与 rateOnDuty（新）
 * iv5 24h 切片只过滤帧与步，窗口仍按全史构建
 * iv6 空输入/无闭合步 → null（不装数）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { classifyFrameSource, workWindows, inAnyWindow, interveneMetrics } = await import('../src/intervene.js')

test('iv1 帧分类', () => {
  assert.equal(classifyFrameSource({ kind: 'user', rpcId: 'r1' }), 'human')
  assert.equal(classifyFrameSource({ kind: 'user', rpcId: 'r1', goalId: 'g' }), 'goal', 'goal 续单不算人')
  assert.equal(classifyFrameSource({ kind: 'user', plugin: 'x', rpcId: 'r1' }), 'plugin')
  assert.equal(classifyFrameSource({ kind: 'agent-instructions' }), 'agent-instructions')
  assert.equal(classifyFrameSource({ kind: 'user' }), 'other', '无 rpcId 不算直连真人')
  assert.equal(classifyFrameSource(null), 'other')
})

test('iv2 步窗口', () => {
  const steps = [{ at: 100, title: 'A' }, { at: 300, title: 'B' }]
  const w = workWindows(steps, { A: 200 })
  assert.deepEqual(w[0], { from: 100, to: 200, title: 'A' }, '有闭合记录=到闭合')
  assert.equal(w[1].to, Infinity, '末步无闭合=Infinity')
  const w2 = workWindows(steps, {})
  assert.equal(w2[0].to, 300, '无闭合记录=到下一步声明')
})

test('iv3 求交', () => {
  const w = [{ from: 100, to: 200 }]
  assert.equal(inAnyWindow(150, w), true)
  assert.equal(inAnyWindow(100, w), true, '左闭')
  assert.equal(inAnyWindow(200, w), false, '右开')
  assert.equal(inAnyWindow(250, w), false)
})

test('iv4 双口径计算', () => {
  const steps = [{ at: 100, title: 'A', status: 'closed' }, { at: 300, title: 'B', status: 'closed' }]
  const closedAt = { A: 200, B: 400 }
  const frames = [150, 180, 250, 350] // 前两个在岗，后两个：250 空档、350 在岗
  const m = interveneMetrics({ frames, steps, closedAt })
  assert.equal(m.humans, 4)
  assert.equal(m.humansOnDuty, 3)
  assert.equal(m.gap, 1)
  assert.equal(m.closed, 2)
  assert.equal(m.rate, 2, '旧口径 4/2')
  assert.equal(m.rateOnDuty, 1.5, '新口径 3/2')
  assert.equal(m.onDutyShare, 0.75)
})

test('iv5 24h 切片：帧与步按 cut 过滤，窗口按全史构建', () => {
  const steps = [{ at: 100, title: 'A', status: 'closed' }, { at: 300, title: 'B', status: 'closed' }]
  const closedAt = { A: 200, B: 400 }
  const frames = [150, 350] // 150 属于旧步（窗口按全史仍在），350 属于新步
  const m = interveneMetrics({ frames, steps, closedAt, cut: 300 })
  assert.equal(m.humans, 1, '只留 350')
  assert.equal(m.humansOnDuty, 1, '350 落在 B 窗口（窗口按全史构建）')
  assert.equal(m.closed, 1, '只数 at>=cut 的闭合步')
  assert.equal(m.rateOnDuty, 1)
})

test('iv6 空输入不装数', () => {
  const m = interveneMetrics({})
  assert.equal(m.humans, 0)
  assert.equal(m.closed, 0)
  assert.equal(m.rate, null, '无分母=null（不假装 0）')
  assert.equal(m.rateOnDuty, null)
  assert.equal(m.onDutyShare, null)
})
