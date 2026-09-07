/** behavior-map — 引导体系v2：自主档驱动行为（verify=user 在 T≥2 时自动降级 self+审计提示；降档即收回）。实现前=红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-bm-'))
process.env.DSH_HOME = TMP
fs.mkdirSync(path.join(TMP, 'graded-state'), { recursive: true })
fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
const T = await import('../src/tools.js')
const M = await import('../src/mode-state.js')
const exec = (sid) => ({ agent: { session: { id: sid } } })

const setup = async (sid, rankT) => {
  await T.costSetDefinition().execute({ purpose: '行为映射测试：自主档驱动验证性合同（至少十二字）', assertions: [{ text: 'a', severity: 'major', source: '标定' }], assumptions: [] }, exec(sid))
  const st = M.loadState(sid)
  M.saveState(sid, { ...st, rank: rankT != null ? { T: rankT, C: 70, at: Date.now() } : undefined })
}

const groups = (title) => [{ title, spec: 'spec', accept: ['cmd:node --version'], verify: 'user' }]

test('b1 T≥2：decompose 的 user 组自动降级 self+标记+注明', async () => {
  const sid = 'b1'
  await setup(sid, 2)
  const r = await T.decomposeDefinition().execute({ groups: groups('G1') }, exec(sid))
  assert.match(r.text, /自主档|降级|放行/, '回执应注明降级，实际=' + String(r.text).slice(0, 200))
  const st = M.loadState(sid)
  const g = (st.groups || []).find((x) => x.title === 'G1')
  assert.equal(g.verify, 'self', 'verify 应降级为 self')
  assert.equal(g.autoRelaxed, true, '应带可检测标记')
})

test('b2 T<2：user 组保持硬门', async () => {
  const sid = 'b2'
  await setup(sid, 0)
  const r = await T.decomposeDefinition().execute({ groups: groups('G2') }, exec(sid))
  const st = M.loadState(sid)
  const g = (st.groups || []).find((x) => x.title === 'G2')
  assert.equal(g.verify, 'user', 'T<2 时应保持 user 硬门')
  assert.ok(!g.autoRelaxed, '无标记')
})

test('b3 降档即收回：rank 降 T 时 autoRelaxed 组恢复 user', async () => {
  const R = await import('../src/rank-organ.js')
  const sid = 'b3'
  await setup(sid, 2)
  await T.decomposeDefinition().execute({ groups: groups('G3') }, exec(sid))
  let st = M.loadState(sid)
  const g = (st.groups || []).find((x) => x.title === 'G3')
  assert.equal(g.verify, 'self', '前置：已降级')
  // 模拟降档：直接调收回函数（若实现提供 recoverRelaxed 则测之）
  const recovered = await R.recoverRelaxed?.(st, { T: 1 })
  if (recovered) {
    const g2 = recovered.groups.find((x) => x.title === 'G3')
    assert.equal(g2.verify, 'user', '降档后应收回为 user')
    assert.ok(!g2.autoRelaxed, '标记清除')
  } else {
    throw new Error('recoverRelaxed 未实现')
  }
})
