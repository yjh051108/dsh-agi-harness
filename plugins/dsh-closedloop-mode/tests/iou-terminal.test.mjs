/**
 * iou-terminal.test — v0.8.31 终端阻塞（未付欠据=不归零）
 * t1 未付欠据 ⇒ zero=false 且 openIOU 列出
 * t2 全部付清 ⇒ zero=true
 * t3 部分付清 ⇒ 仍 false（只列未付）
 * t4 无欠据 ⇒ 不受影响（原口径不变）
 * t5 池核案重放：7 条人判 ⇒ zero=false / openIOU=7
 * t6 已付欠据留史但不阻塞（paidAt 保留）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { initMode, recordIOU, payIOU, openIOU, terminalCheck, onGroupsEdit } = await import('../src/mode-state.js')

const STACK = { steps: [{ title: 'A', status: 'closed' }] }
const COST = { purpose: 'T' }

/** 全组 settled 的最小状态（组结构+落账标记） */
function settledState(accepts = []) {
  const r = onGroupsEdit(initMode(), accepts.map((accept, i) => ({ title: 'G' + i, spec: 's', accept, verify: 'self' })))
  assert.equal(r.ok, true, r.error || '')
  return { ...r.state, stage: 'final', weightsLocked: true, groups: r.state.groups.map((g) => ({ ...g, settled: { at: Date.now(), verdict: 'mechanical-settle' } })) }
}

/** 池核案原物：那场 11 条断言里 7 条人判（账本 session-1f8c4faa 逐字） */
const POOLCORE_HUMAN = [
  '尺度符合人体真实（门高≈2.1m、层高 3.3~7m、池深 1.2~2.2m），无微缩感',
  '浏览器截图可见灯管倒映水面、池底瓷砖网格与焦散光斑',
  '截图画面无塑料感、墙角有 AO 阴影且高光泛光正常不过曝',
  '出生点位于入口长廊且朝向泳池大厅，WASD 行走碰撞无穿墙',
  '进入场景可闻低频嗡鸣与随机水滴，灯管有可见闪烁',
  '开发者在本机浏览器双击运行验收：画面符合池核+后室美学、60FPS 目标达成或差距已报告',
  'check.mjs 命令可独立运行并输出 OK/MISS 清单（人工抽查）',
]

test('t1 未付欠据 ⇒ zero=false 且 openIOU 列出', () => {
  let s = settledState([['cmd: node --version', '人判: 目测 A']])
  s = recordIOU(s, 'G0', ['目测 A'])
  const rep = terminalCheck(COST, STACK, s, 'final')
  assert.equal(rep.zero, false, '未付欠据不得归零')
  assert.equal(rep.openIOU.length, 1)
  assert.equal(rep.openIOU[0].text, '目测 A')
})

test('t2 全部付清 ⇒ zero=true', () => {
  let s = settledState([['cmd: node --version', '人判: 目测 A']])
  s = recordIOU(s, 'G0', ['目测 A'])
  s = payIOU(s, new Set(['全部']))
  assert.equal(terminalCheck(COST, STACK, s, 'final').zero, true)
})

test('t3 部分付清 ⇒ 仍 false，只列未付', () => {
  let s = settledState([['cmd: node --version']])
  s = recordIOU(s, 'G0', ['A', 'B'])
  s = payIOU(s, new Set(['G0']))
  const rep = terminalCheck(COST, STACK, s, 'final')
  assert.equal(rep.zero, true, '整组签收=全付')
  let s2 = recordIOU(s, 'G0', ['C'])
  const rep2 = terminalCheck(COST, STACK, s2, 'final')
  assert.equal(rep2.zero, false)
  assert.deepEqual(rep2.openIOU.map((e) => e.text), ['C'], '只列未付')
})

test('t4 无欠据 ⇒ 原口径不变', () => {
  const s = settledState([['cmd: node --version']])
  const rep = terminalCheck(COST, STACK, s, 'final')
  assert.equal(rep.zero, true)
  assert.deepEqual(rep.openIOU, [])
})

test('t5 池核案重放：7 条人判 ⇒ zero=false / openIOU=7', () => {
  let s = settledState([['cmd: node --version', ...POOLCORE_HUMAN.map((t) => '人判: ' + t)]])
  s = recordIOU(s, 'G0', POOLCORE_HUMAN)
  const rep = terminalCheck(COST, STACK, s, 'final')
  assert.equal(rep.openIOU.length, 7, '池核账本里恰好 7 条人判项')
  assert.equal(rep.zero, false, '这就是那场本该被拦住的瞬间：不许出「交付完成」')
})

test('t6 已付欠据留史但不阻塞', () => {
  let s = settledState([['cmd: node --version']])
  s = recordIOU(s, 'G0', ['A'])
  s = payIOU(s, new Set(['G0']))
  assert.equal(s.iou.length, 1, '留史')
  assert.equal(s.iou[0].paidAt > 0, true)
  assert.equal(openIOU(s).length, 0)
  assert.equal(terminalCheck(COST, STACK, s, 'final').zero, true)
})
