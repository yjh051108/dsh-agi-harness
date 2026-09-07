/**
 * contract-merge 合同测试（判据：物化等价=两路径过同一 declareStep；第5闸引导词且拒绝照旧）。
 * 栈隔离：临时 DSH_HOME（真盘零接触）；体积比基线=真栈盘档只读现算。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { materialize, BASE_LAW, GATE5_NOTE } from '../src/contract-merge.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-stack-'))
process.env.DSH_HOME = TMP
const { declareStep, loadStack } = await import('../src/optimal-engine.js')

const surface = {
  cost: { purpose: 'p', assertions: [
    { text: '质量不劣化', severity: 'catastrophic', source: 'BENCH §3' },
    { text: '封闭执行', severity: 'major', source: '用户原话' },
  ], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
  residual: { groupsOpen: ['G'], closedCount: 3, lastBand: 'near', dipPending: false },
  groups: [{ title: 'G', accept: ['a'], verify: 'self', settled: false }],
  closed: [], weightsLocked: true, stage: 'rolling', task: 't',
}
const PRED = [{ key: 'k1', value: '命中 1', source: 'prior:fs 直读' }]
const CH = ['fs: 盘直读', 'runtime: 活测']

test('p1 物化形状：contract 键集 ⊇ declareStep 消费字段集', () => {
  const consumed = ['title', 'invariants', 'predictions', 'cost', 'law', 'measure', 'vExpect', 'dipPlan', 'confidence']
  const { contract } = materialize(surface, { title: 'A1', predict: PRED, channels: CH })
  assert.deepEqual(consumed.filter((k) => !(k in contract)), [])
})

test('p2 物化等价三硬断：正例同 ok／无源同错文本／物化确定性（签名全等）', () => {
  const m = materialize(surface, { title: 'EQ动作', predict: PRED, channels: CH, invariants: ['自定义行'], law: [{ signal: 'x', action: 'y' }] })
  const rDiff = declareStep('sid-diff', m.contract)
  // 手写全量路径=物化产物的逐字节副本（模型若坚持手抄，抄的正是这份——等价即在此）
  const hand = JSON.parse(JSON.stringify(m.contract))
  const rHand = declareStep('sid-hand', hand)
  assert.equal(rDiff.ok, true, '差分路径过闸')
  assert.equal(rHand.ok, true, '手写路径过闸（①）')
  const sd = loadStack('sid-diff').steps.at(-1), sh = loadStack('sid-hand').steps.at(-1)
  assert.deepEqual(Object.keys(sd).sort(), Object.keys(sh).sort())
  assert.equal(sd.signature, sh.signature, '③ 物化确定性：两路签名全等')
  assert.deepEqual(materialize(surface, { title: 'EQ动作', predict: PRED, channels: CH, invariants: ['自定义行'], law: [{ signal: 'x', action: 'y' }] }).contract, m.contract, '③ 同入参两次物化逐字节等（无时钟无历史）')
  // ② 无源反例：两路同一拒绝，错误文本逐字一致（硬拒唯一位在 declareStep）
  const bad = JSON.parse(JSON.stringify(m.contract)); bad.predictions[0].source = ''
  const b1 = declareStep('sid-b1', bad)
  const b2 = declareStep('sid-b2', { ...bad, title: 'BAD2' })
  assert.equal(b1.ok, false); assert.equal(b2.ok, false)
  assert.match(b1.error, /既定规则/)
  assert.equal(b1.error, b2.error, '同闸同文本')
})

test('p3 第5闸：单通道 diff → 重流程引导三要素齐且 declareStep 拒绝照旧（闸强度不变）', () => {
  const m = materialize(surface, { title: '窄测量动作', predict: PRED, channels: ['fs: 只此一家'] })
  assert.equal(m.admission, 'heavy')
  assert.ok(m.notes[0].includes('重流程') && m.notes[0].includes('第二条独立测量通道') && m.notes[0].includes('提议态'), '引导三要素')
  assert.equal(GATE5_NOTE, m.notes[0])
  const r = declareStep('sid-g5', m.contract)
  assert.equal(r.ok, false, '双通道闸不因重流程豁免')
  assert.match(r.error, /定理5|≥2/)
  // light 路径对照：双通道 → 无引导词
  assert.equal(materialize(surface, { title: 'X', predict: PRED, channels: CH }).admission, 'light')
})

test('p4 差分体积比：diff/手写全量 ≤ 0.5（基线=真栈盘档最近闭块现算，零钉字面）', () => {
  const real = 'C:/Users/Eldwen/.dsh/graded-state/session-b74630b0-c63f-4ce5-8a96-daac4de47c99.optimal.json'
  if (!fs.existsSync(real)) { console.warn('真栈不可读，跳过'); return }
  const steps = JSON.parse(fs.readFileSync(real, 'utf8')).steps
  const handSteps = steps.filter((s) => s.status === 'closed' && ['盘档 v3：权重驻留与轨迹除合同', '对照组冻结与新目录演进'].includes(s.title))
  assert.ok(handSteps.length >= 1)
  const base = Math.min(...handSteps.map((s) => JSON.stringify(s).replace(/"(status|agreed|discrepancies|dv|signature|at|n|rolledBack|pendingDip)":("[^"]*"|\[[^\]]*\]|[\w.]+|null),?/g, '').length))
  const diffBytes = JSON.stringify({ title: 'A1', predict: PRED, channels: CH }).length
  assert.ok(diffBytes / base <= 0.5, `比值 ${(diffBytes / base).toFixed(3)} ≤ 0.5（diff=${diffBytes}B 手写基线=${base}B）`)
})

test('p5 闸零拷贝：merge 文件无签名/反漂移逻辑复制', () => {
  const src = fs.readFileSync(new URL('../src/contract-merge.js', import.meta.url), 'utf8')
  for (const banned of ['signature', 'rolledBack', 'pendingDip', 'dipPlan.length < 8']) assert.equal(src.includes(banned), false, `闸逻辑复制面: ${banned}`)
  assert.ok(src.includes("from './optimal-engine.js'"), '引擎复用声明在位')
})

test.after?.(() => fs.rmSync(TMP, { recursive: true, force: true }))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
