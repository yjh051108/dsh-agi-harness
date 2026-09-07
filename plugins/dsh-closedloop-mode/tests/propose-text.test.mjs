/** propose-text 测例（判据：常驻面≤基线⅓ + 讲课撤走闸不放松——教育=报错面）。真盘档只读。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stateFace, weightsFace, stepReminder, batchConfirmLine, FACE_BUDGET } from '../src/propose-text.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-face-'))
process.env.DSH_HOME = TMP // 全程临时（真盘零接触——闸样本栈也不许落真目录）
const { declareStep } = await import('../src/optimal-engine.js')
const { migrateLegacy, controlSurface } = await import('../src/mode-state.js')
/** FIXTURE：最小 v2 主会话档（自包含——开源不依赖任何机器的真实盘档）。 */
const FIXTURE = JSON.stringify({ v: 2, purpose: 'fixture 主会话构造面', cost: { assertions: [{ text: '质量不降', severity: 'catastrophic', source: 'fixture' }], nonGoals: [], assumptions: [] }, plan: { groups: [{ title: 'G', items: [{ title: 'A1', status: 'completed' }] }] }, closed: [{ title: 'A1', group: 'G', at: 1, band: 'at' }], groups: [{ title: 'G', spec: 's', accept: ['人判:x'], verify: 'self', settled: { at: 1, verdict: 'mechanical-settle' } }], lastBand: 'at', stage: 'final' })

test('p1 主会话档（fixture 构造，禁真盘）→ face 字节 ≤FACE_BUDGET 且任务语四元齐全', () => {
  const raw = JSON.parse(FIXTURE)
  const face = stateFace(controlSurface(migrateLegacy(raw)))
  const bytes = Buffer.byteLength(face, 'utf8')
  assert.ok(bytes <= FACE_BUDGET, `face=${bytes}B ≤ ${FACE_BUDGET}B`)
  assert.ok(face.includes('【闭环·进行中】') && face.includes('分组任务：') && face.includes('完成条件（') && face.includes('▸ 下一步：'), '任务语四元在位')
})
test('p2 五闸拒绝文本各自含条款+处置（撤讲课不放松判定——闸独立于 face）', () => {
  const cases = [
    [{ predictions: [{ key: 'k', value: 'v', source: 'prior:s' }], measure: { channels: ['a', 'b'] }, law: [{ signal: 'x', action: 'y' }] }, /title/],
    [{ title: 'T', predictions: [], measure: { channels: ['a', 'b'] }, law: [{ signal: 'x', action: 'y' }] }, /未推导/],
    [{ title: 'T', predictions: [{ key: 'k', value: 'v' }], measure: { channels: ['a', 'b'] }, law: [{ signal: 'x', action: 'y' }] }, /既定规则/],
    [{ title: 'T', predictions: [{ key: 'k', value: 'v', source: 'prior:s' }], measure: { channels: ['a'] }, law: [{ signal: 'x', action: 'y' }] }, /定理5/],
    [{ title: 'T', predictions: [{ key: 'k', value: 'v', source: 'prior:s' }], measure: { channels: ['a', 'b'] }, law: [], vExpect: 'improve' }, /law|偏差策略/],
    [{ title: 'T2', predictions: [{ key: 'k', value: 'v', source: 'prior:s' }], measure: { channels: ['a', 'b'] }, law: [{ signal: 'x', action: 'y' }], vExpect: 'dip' }, /dipPlan|回升/],
  ]
  cases.forEach(([args, re], i) => {
    const r = declareStep(`gate-${i}`, args)
    assert.equal(r.ok, false, `闸样本 ${i} 须拒`)
    assert.match(r.error, re, `闸样本 ${i} 错误含条款`)
    assert.ok(r.error.length >= 20, `闸样本 ${i} 含处置句（≥20 字符）`)
  })
})

test('p3 纯函数确定性 + 零讲课件泄漏 + 零时钟', () => {
  const surf = { stage: 'rolling', cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] }, groups: [{ title: 'G', settled: false }], closed: [], residual: { groupsOpen: ['G'], closedCount: 0, lastBand: 'far', dipPending: false } }
  assert.equal(stateFace(surf), stateFace(surf), '同入参逐字节等')
  for (const banned of ['岗位', '北极星', '最优律基线', '预言家', 'convergeLaw']) assert.equal(stateFace(surf).includes(banned), false, `讲课词残留: ${banned}`)
  const src = fs.readFileSync(new URL('../src/propose-text.js', import.meta.url), 'utf8')
  assert.equal(/Date\.now|Math\.random|new Date/.test(src), false, '无时钟无随机')
})

test('p4 成长导向指令三要素（挑最有价值/不预排/先声明）', () => {
  const face = stateFace({ cost: { assertions: [] }, groups: [], closed: [], residual: {} })
  assert.ok(face.includes('挑最有价值的一件事'), '挑最有价值在位')
  assert.ok(face.includes('不提前排'), '不预排在位（成长导向）')
  assert.ok(face.includes('optimal_declare'), '先声明在位')
})

/* ---------- v0.6.28 注入分层：推送面任务语（架构词禁现——导演定向「技术架构与实际功能分开」） ---------- */
const JARGON = ['残差', 'Q_N×', 'cost-to-go', '档=', 'dip=', '(major)', '(minor)', '(catastrophic)', '差分契约', '栈顶', '未落账']

test('f1 stateFace 任务语：功能词在位', () => {
  const surf = { stage: 'rolling', cost: { assertions: [{ text: '格子(23,8)应为空', severity: 'major', source: 's' }, { text: '玩家区域检出红色', severity: 'major', source: 's' }] }, groups: [{ title: '敌人重力', settled: true }, { title: '蘑菇跳跃', settled: false }], closed: [{ title: '修重力' }], residual: { groupsOpen: ['蘑菇跳跃'], closedCount: 1, lastBand: 'far', dipPending: false } }
  const face = stateFace(surf)
  assert.match(face, /【闭环·进行中】/)
  assert.match(face, /分组任务：1\/2 完成（还差：蘑菇跳跃）/)
  assert.match(face, /小步已闭环 1/)
  assert.match(face, /完成条件（2 条）：格子\(23,8\)应为空｜玩家区域检出红色/)
  assert.match(face, /▸ 下一步：挑最有价值的一件事/)
  assert.match(face, /最近完成：修重力/)
})

test('f2 stateFace 架构词禁现（推送面零协议内脏词）', () => {
  const surf = { stage: 'rolling', cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] }, groups: [{ title: 'G', settled: false }], closed: [], residual: { groupsOpen: ['G'], closedCount: 0, lastBand: 'far', dipPending: true } }
  const face = stateFace(surf)
  for (const w of JARGON) assert.ok(!face.includes(w), `推送面不得出现「${w}」`)
})

test('f3 stepReminder 成长导向：open 步=完成后记录结果', () => {
  const r = stepReminder({ n: 1, title: '补敌人/蘑菇缺失重力', status: 'open' })
  assert.match(r, /当前步「1\.补敌人\/蘑菇缺失重力」/)
  assert.match(r, /optimal_converge/)
  assert.match(r, /记录.*实测结果/)
  for (const w of JARGON) assert.ok(!r.includes(w), `步提醒不得出现「${w}」`)
})

test('f4 stepReminder 成长导向：invalidated=学到了什么', () => {
  const r = stepReminder({ n: 1, title: '修重力', status: 'invalidated' })
  assert.match(r, /偏差/)
  assert.match(r, /optimal_rollback/)
  assert.match(r, /成长/)
  for (const w of JARGON) assert.ok(!r.includes(w), `步提醒不得出现「${w}」`)
})

test('p5 判定面零引用展示面（教育=报错面的结构保证）', () => {
  for (const f of ['optimal-engine.js', 'contract-merge.js', 'mode-state.js']) {
    const src = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
    assert.equal(/stateFace|propose-text/.test(src), false, `${f} 不引用展示面`)
  }
})

test('p6 weightsFace 合同锁定回执（慢环主权提示，≤FACE_BUDGET）', () => {
  const raw = JSON.parse(FIXTURE)
  const w = weightsFace(controlSurface(migrateLegacy(raw)))
  assert.ok(Buffer.byteLength(w) <= FACE_BUDGET)
  assert.ok(w.includes('待确认') && w.includes('完成条件') && w.includes('不做的事'))
})

test('b1 连续≥3 步 at→at：批确认行出现', () => {
  const steps = Array.from({ length: 5 }, (_, i) => ({ n: i + 1, status: 'closed', title: '核验' + (i + 1), dv: { before: 'at', after: 'at' } }))
  const line = batchConfirmLine({ steps })
  assert.match(line, /连续 5 步 at→at/)
  assert.match(line, /收尾\/核验/, '点名批确认')
  assert.ok(!/必须|禁止|应该/.test(line), '只事实不指令')
})

test('b2 不足 3 步或含非 at 步：不出行（不误报正常单步）', () => {
  assert.equal(batchConfirmLine({ steps: [{ n: 1, status: 'closed', dv: { before: 'far', after: 'near' } }, { n: 2, status: 'closed', dv: { before: 'near', after: 'at' } }] }), '')
  const mixed = [{ n: 1, status: 'closed', dv: { before: 'at', after: 'at' } }, { n: 2, status: 'closed', dv: { before: 'far', after: 'at' } }, { n: 3, status: 'closed', dv: { before: 'at', after: 'at' } }]
  assert.equal(batchConfirmLine({ steps: mixed }), '', '中间被非 at 步打断≠批确认')
  assert.equal(batchConfirmLine({ steps: [] }), '')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
