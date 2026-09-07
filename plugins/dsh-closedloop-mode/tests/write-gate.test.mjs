/**
 * write-gate.test — v0.6.27 写闸回归锁（纪律①：改判据当轮必配）。
 * 八例：非写类放行 / 无盘档不闸 / Gate A off 拒 / 合同段拒 / Gate B 无 open 步拒 /
 *       rolling+冻结+open 放行 / final 拒 / 工具表登记面。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gateWrite, WRITE_TOOLS } from '../src/write-gate.js'

const st = (stage, extra = {}) => ({ stage, weightsLocked: true, ...extra })

test('g1 非写类工具一律放行（读/搜/探针/终端/维护面不闸）', () => {
  for (const n of ['read', 'glob', 'grep', 'probe_record', 'pwsh', 'terminal_check', 'subagent', 'workflow', 'engram_store', 'engram_propose', 'dev_reload_package', 'browser_click', 'audit_dispatch', 'optimal_declare']) {
    assert.equal(gateWrite({ toolName: n, state: st('off'), hasOpenStep: false }), undefined, n + ' 不得被闸')
  }
})

test('g2 无盘档会话不闸（子代理干活通道——导演定向：subagent=干活）', () => {
  assert.equal(gateWrite({ toolName: 'write', state: null, hasOpenStep: false }), undefined)
  assert.equal(gateWrite({ toolName: 'edit', state: undefined, hasOpenStep: false }), undefined)
})

test('g3 off 引导开始任务', () => {
  const r = gateWrite({ toolName: 'write', state: st('off'), hasOpenStep: false })
  assert.match(r, /【开始一个任务】/)
  assert.match(r, /超级任务完成模式/)
})

test('g4 合同阶段引导完成准备', () => {
  for (const stage of ['brainstorm', 'weights']) {
    const r = gateWrite({ toolName: 'edit', state: st(stage), hasOpenStep: false })
    assert.match(r, /【准备中】/)
    assert.match(r, /freeze/)
  }
})

test('g5 rolling 无 open 步引导声明', () => {
  const r = gateWrite({ toolName: 'write', state: st('rolling'), hasOpenStep: false })
  assert.match(r, /【下一步】/)
  assert.match(r, /optimal_declare/)
})

test('g6 rolling+冻结+open 步：放行（环内干活自由）', () => {
  assert.equal(gateWrite({ toolName: 'write', state: st('rolling'), hasOpenStep: true }), undefined)
  assert.equal(gateWrite({ toolName: 'edit', state: st('rolling'), hasOpenStep: true }), undefined)
})

test('g7 final 引导新任务', () => {
  const r = gateWrite({ toolName: 'write', state: st('final'), hasOpenStep: false })
  assert.match(r, /【新任务】/)
  assert.match(r, /超级任务完成模式/)
})

test('g8 WRITE_TOOLS 表=write/edit（登记面可审）', () => {
  assert.deepEqual([...WRITE_TOOLS].sort(), ['edit', 'write'])
})

test('g9 真人主会话未入环：裸写拒（v0.8.1 堵绕环免费——对照案底 b4a281a7）', () => {
  const r = gateWrite({ toolName: 'write', state: null, hasOpenStep: false, hasHumanTurn: true, autoStartDisabled: false })
  assert.match(r, /【开始一个任务】/)
  assert.match(r, /启动超级任务完成模式/)
  assert.match(r, /super_task_completion_mode/, '拒语点名入口工具名')
})

test('g10 委派/显式关闭路径仍放行：无真人帧或 autoStart:false 不误伤', () => {
  assert.equal(gateWrite({ toolName: 'edit', state: null, hasOpenStep: false, hasHumanTurn: false, autoStartDisabled: false }), undefined, '子代理无真人帧=干活通道')
  assert.equal(gateWrite({ toolName: 'edit', state: null, hasOpenStep: false, hasHumanTurn: true, autoStartDisabled: true }), undefined, '显式关自动接管=尊重开发者选择')
})
