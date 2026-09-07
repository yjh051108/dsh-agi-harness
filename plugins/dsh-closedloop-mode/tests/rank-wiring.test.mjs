/** rank-wiring — 起步可见：cost_set 回执附档位引导行（有 rank 才有；无 rank 零税）。实现前=红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-rw-'))
process.env.DSH_HOME = TMP
fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
const T = await import('../src/tools.js')
const M = await import('../src/mode-state.js')
const exec = (sid) => ({ agent: { session: { id: sid } } })

test('w1 有 rank 时 cost_set 回执附档位引导行', async () => {
  const sid = 'w1'
  const st = M.initMode()
  M.saveState(sid, { ...st, stage: 'brainstorm', rank: { T: 1, C: 66, at: Date.now() } })
  const r = await T.costSetDefinition().execute({
    purpose: '起步可见：有档位时应出现引导行（至少十二字）',
    assertions: [{ text: 'a', severity: 'major', source: '标定' }],
    assumptions: [],
  }, exec(sid))
  assert.match(r.text, /自主档|板子|信任/, '回执应含自主档引导，实际=' + String(r.text).slice(-200))
})

test('w2 无 rank 时回执无引导行（零税）', async () => {
  const sid = 'w2'
  const st = M.initMode()
  M.saveState(sid, st)
  const r = await T.costSetDefinition().execute({
    purpose: '零税验证：无档位不应出现引导行（至少十二字）',
    assertions: [{ text: 'a', severity: 'major', source: '标定' }],
    assumptions: [],
  }, exec(sid))
  assert.ok(!/自主档|板子/.test(r.text), '无档位无引导行')
})
