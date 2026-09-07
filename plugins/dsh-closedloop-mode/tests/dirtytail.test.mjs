/**
 * dirtytail.test — v0.5.1 WAL 脏尾结算回归
 * w1 无脏尾幂等；w2 open 步结算入 rolledBack（process-death 归因）；w3 结算后 C 分母不含该条
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-dirty-'))
process.env.DSH_HOME = TMP
process.env.USERPROFILE = TMP

const eng = await import('../src/optimal-engine.js')
const R = await import('../src/rank-organ.js')

test('w1 无栈/无 open：幂等返回 0', () => {
  assert.equal(eng.settleDirtyTail('dt-none'), 0)
})

test('w2 open 步结算：移出 steps、入 rolledBack、归因 process-death', () => {
  const sid = 'dt-s1'
  const s = { ...eng.initStack ? eng.initStack() : { version: 3, steps: [], rolledBack: [] } }
  s.steps.push({ n: 1, title: '死在半路', status: 'open', predictions: [] })
  s.steps.push({ n: 2, title: '已闭', status: 'closed', predictions: [] })
  // 通过引擎内部保存路径：直接写栈文件（与 saveStack 同格式）
  const dir = path.join(TMP, 'graded-state')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${sid}.optimal.json`), JSON.stringify(s))
  const n = eng.settleDirtyTail(sid)
  assert.equal(n, 1)
  const after = eng.loadStack(sid)
  assert.equal(after.steps.filter((x) => x.status === 'open').length, 0)
  assert.equal(after.rolledBack.length, 1)
  assert.match(after.rolledBack[0].reason, /process-death/)
  assert.equal(after.rolledBack[0].title, '死在半路')
})

test('w3 结算后的脏尾不入信誉分母（rank-organ EXTERNAL 过滤联动）', () => {
  const stack = { rolledBack: [{ reason: 'process-death auto-settle (WAL dirty tail: pending without result)' }] }
  const s = { closed: [{ title: 'a', band: 'near', v: 1 }], groups: [{ title: 'G', settled: { by: 'x' } }], cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] } }
  const c = R.computeC(s, stack)
  assert.equal(c.n, 1, '脏尾不计入分母')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
