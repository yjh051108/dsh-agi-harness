/** ability-memory — 能力印记：归零时记录本单特征→主体档案；引导面正向行。实现前=红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ab-'))
process.env.DSH_HOME = TMP
fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
const A = await import('../src/ability-organ.js')

test('a1 记录：本单特征写入主体档案（追加不可篡改）', () => {
  const rec1 = A.recordAbility({ closed: 4, groups: 2, weight: 6, at: Date.now() })
  assert.ok(rec1 && rec1.closed === 4)
  const rec2 = A.recordAbility({ closed: 2, groups: 1, weight: 3, at: Date.now() })
  assert.ok(rec2)
  const all = A.readAbilities()
  assert.equal(all.length, 2, '追加不覆盖')
})

test('a2 摘要：累计单数+完成特征（正向引导面）', () => {
  const sum = A.abilitySummary()
  assert.ok(sum.includes('2'), '累计单数')
  assert.ok(/归零|单/.test(sum), '正向语')
})

test('a3 无档案=空摘要（零税）', () => {
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-ab2-'))
  const old = process.env.DSH_HOME
  process.env.DSH_HOME = dir2
  assert.equal(A.abilitySummary(), '')
  process.env.DSH_HOME = old
})
