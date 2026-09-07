/**
 * rank.test — v0.5.0 档位器官回归（纯函数面）
 * r1 冷启动无账→C null+T0；r2 外部归因不入分母；r3 Wilson 小样本压制；r4 滞回升档；
 * r5 滞回降档（即时）；r6 装完成直降 T0；r7 碎拍冻结；r8 T3 提示位；r9 rankLine 渲染
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-rank-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const R = await import('../src/rank-organ.js')

const st = (closedN, groups, asserts) => ({
  closed: Array.from({ length: closedN }, (_, i) => ({ title: 'c' + i, band: 'near', v: 1 })),
  groups: groups || [{ title: 'G1', settled: { by: 'x' } }],
  cost: { assertions: asserts || [{ text: 'a', severity: 'major', source: 's' }] },
})

test('r1 冷启动：无账可算 C=null 提示强制 T0', () => {
  const c = R.computeC({ closed: [], groups: [], cost: { assertions: [] } }, { rolledBack: [] })
  assert.equal(c.C, null)
  assert.match(c.note, /T0/)
})

test('r2 外部变更/process-death 归因不入信誉分母', () => {
  const s = st(3)
  const stack = { rolledBack: [{ reason: '用户改口作废' }, { reason: 'process-death 补结算' }, { reason: '预测模型错' }] }
  const c = R.computeC(s, stack)
  assert.equal(c.n, 4, '3 闭 + 1 真回炉（2 外部剔除）')
})

test('r3 Wilson 下界压制小样本：闭2炉0 不满分', () => {
  const c = R.computeC(st(2, [{ title: 'G', settled: null }], [{ text: 'a', severity: 'minor', source: 's' }]), { rolledBack: [] })
  assert.ok(c.C < 75, `C=${c.C} 应被小样本压制（旧尺=90 案底）`)
})

test('r4 滞回升档（v0.5.7 实测校准 45/55）：T0→T1 需 C≥45，T1→T2 需 C≥55', () => {
  assert.equal(R.rankTransition({ T: 0 }, 43, R_state(30), 30).T, 0)
  assert.equal(R.rankTransition({ T: 0 }, 46, R_state(30), 30).T, 1)
  assert.equal(R.rankTransition({ T: 1 }, 50, R_state(30), 30).T, 1, '50<55 不升（滞回带内不动）')
  assert.equal(R.rankTransition({ T: 1 }, 58, R_state(30), 30).T, 2)
})

function R_state(n) { return { closed: Array.from({ length: n }, (_, i) => ({ title: 'c' + i, band: 'near', v: 1 })), groups: [{ title: 'G', settled: { by: 'x' } }], cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] } } }

test('r5 滞回降档（降 35/45 不对称带宽）：T2 掉到 45 以下才降；T1 掉到 35 以下归 T0', () => {
  assert.equal(R.rankTransition({ T: 2 }, 48, R_state(30), 30).T, 2, '48>45 带内保持')
  assert.equal(R.rankTransition({ T: 2 }, 40, R_state(30), 30).T, 1)
  assert.equal(R.rankTransition({ T: 1 }, 30, R_state(30), 30).T, 0)
})

test('r5b 样本门（v0.5.7）：n<8 只关升路，降路永远开', () => {
  assert.equal(R.rankTransition({ T: 0 }, 50, st(2), 2).T, 0, '样本不足不升')
  assert.equal(R.rankTransition({ T: 0 }, 50, st(2), 2).gated, true)
  assert.equal(R.rankTransition({ T: 0 }, 50, st(30), 30).T, 1, '样本足则升')
  assert.equal(R.rankTransition({ T: 2 }, 10, st(2), 2).T, 1, '降路不受样本门（风险不对称）')
})

test('r6 装完成直降 T0（风险不对称：信誉罚没即时）', () => {
  const d = R.demoteOnFake({ T: 2, lastSettled: 1 })
  assert.equal(d.T, 0)
  assert.equal(d.demoted, true)
})

test('r7 碎拍冻结：尾4同质(at,V=0)且无新 settled → 升档冻结', () => {
  const s = { closed: Array.from({ length: 4 }, (_, i) => ({ title: 'f' + i, band: 'at', v: 0 })), groups: [{ title: 'G', settled: { by: 'x' } }], cost: { assertions: [] } }
  const r = R.rankTransition({ T: 0, lastSettled: 1 }, 80, s)
  assert.equal(r.frozen, true)
  assert.equal(r.T, 0, '冻结=不升')
})

test('r8 T3 提示位：T2 高 C 不自动升 T3（R10 显式确认）', () => {
  const r = R.rankTransition({ T: 2 }, 95, st(30))
  assert.equal(r.T, 2)
  assert.match(r.t3Note, /显式确认/)
})

test('r9 rankLine 渲染：档位名+C+状态后缀', () => {
  assert.match(R.rankLine({ T: 1 }, 63), /🎖 你的自主档 T1·辅助/, '档位名（人话版前缀）')
  assert.match(R.rankLine({ T: 1 }, 63), /命中率 63%/, 'C 值（命中率表述，C=63 语义保留）')
  assert.match(R.rankLine({ T: 0, demoted: true }, null), /T0·影子.*还没攒出账.*刚降档/s)
})

/* r10 端到端合同（E2E 案底回归：terminal 档位行 const s 重赋值 TypeError 曾被 catch 吞成"评估异常"） */
test('r10 terminal_check 档位行端到端：正常出 🎖 行且无"评估异常"', async () => {
  const ms = await import('../src/mode-state.js')
  const T = await import('../src/tools.js')
  const sid = 'rank-e2e-1'
  const s = {
    ...ms.initMode(),
    stage: 'final',
    weightsLocked: true,
    cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
    groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: { by: 'test' } }],
    closed: [{ title: '动作一', group: 'G', band: 'near', v: 1, at: 1 }],
  }
  ms.saveState(sid, s)
  const r = await T.terminalCheckDefinition().execute({}, { agent: { session: { id: sid } } })
  assert.match(r.text, /🎖 你的自主档 T\d·/)
  assert.doesNotMatch(r.text, /评估异常/)
  const after = ms.loadState(sid)
  assert.ok(after.rank && typeof after.rank.T === 'number', 'rank 已落盘')
})
