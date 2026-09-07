/** rank-guide — 引导体系增量：①再犯率接入档位评估（收紧）②引导面（rankLine 升级为引导语）③起步可见（cost_set 回执附档位引导）。实现前=红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-rg-'))
process.env.DSH_HOME = TMP
const R = await import('../src/rank-organ.js')
const L = await import('../src/learning-organ.js')

const mkState = () => ({
  cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }, { text: 'b', severity: 'minor', source: 's' }] },
  closed: [{ title: 'a', group: 'G1', at: 1, band: 'at' }, { title: 'b', group: 'G1', at: 2, band: 'at' }],
  groups: [{ title: 'G1', settled: { at: 1, verdict: 'pass' } }],
})
const mkStack = () => ({ steps: [{ status: 'closed' }, { status: 'closed' }] })
const mkRank = (T) => ({ T, C: 70, at: Date.now() })

test('g1 再犯率接入：同类再犯 C 受罚（收紧，封顶）', () => {
  const c0 = R.computeC(mkState(), mkStack()).C
  for (let i = 0; i < 2; i++) L.recordLesson('cat-a', 'x', 't')
  for (let i = 0; i < 2; i++) L.recordLesson('cat-b', 'y', 't')
  const c1 = R.computeC(mkState(), mkStack()).C
  assert.ok(c1 < c0, '再犯后 C 应降低（收紧）：c0=' + c0 + ' c1=' + c1)
  for (let i = 0; i < 20; i++) L.recordLesson('cat-z', 'z', 't')
  const c2 = R.computeC(mkState(), mkStack()).C
  assert.ok(c2 >= c0 - 22, '惩罚封顶（不无限降）：c0=' + c0 + ' c2=' + c2)
})

test('g2 引导面：rankLine 输出引导语（档位+依据+预期）', () => {
  const line = R.rankLine(mkRank(1), { C: 66, n: 10 })
  assert.ok(line.includes('T1'), '含档位')
  assert.ok(!/^C=|C=\d/.test(line), '不再裸数据')
  assert.ok(/板|信任|稳|自主/.test(line), '含引导语，实际=' + line.slice(0, 80))
})

test('g3 输出稳定性', () => {
  assert.ok(typeof R.rankLine(mkRank(0), { C: 45, n: 3 }) === 'string')
})
