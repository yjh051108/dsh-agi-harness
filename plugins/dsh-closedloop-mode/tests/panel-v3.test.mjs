/** panel-v3 适配测例（accept：端点 v3 形状 + 降级骨架在位；panelBody 纯函数=端点同一源）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const { panelBody, auditStat } = await import('../src/index.js')
const { migrateLegacy, controlSurface } = await import('../src/mode-state.js')
const G = 'C:/Users/Eldwen/.dsh/graded-state/'
const SM = 'e5e9df00-a5bb-43bb-9412-5fa811684a75'

test('panelBody v3 形状：真 smoke3 档 → v:3 全键面且与盘现读等式', () => {
  const st = migrateLegacy(JSON.parse(fs.readFileSync(`${G}${SM}.closedloop.json`, 'utf8')))
  const stack = JSON.parse(fs.readFileSync(`${G}${SM}.optimal.json`, 'utf8'))
  const p = panelBody(SM, st, stack)
  assert.equal(p.ok, true)
  assert.equal(p.v, 3)
  assert.equal(p.stage, 'final')
  for (const k of ['openStep', 'vLadder', 'residual', 'groupsBrief', 'audit', 'modelState', 'weightsLocked']) assert.ok(k in p, `v3 键在位: ${k}`)
  assert.ok('costRemaining' in p === false, '旧 costRemaining 键不再产')
  assert.equal(p.residual.closedCount, st.closed.length, '等式：closedCount==盘现读 closed 长')
  assert.equal(p.residual.lastBand, st.lastBand)
  assert.equal(p.groupsBrief.reduce((a, g) => a + g.closedActs, 0), st.closed.length)
  assert.equal(p.audit.rounds, (st.closed.filter((c) => c.audit)).reduce((a, c) => a + c.audit.rounds, 0) || 0, '审轮次==盘档现读和')
})

test('panelBody 降级：无会话/无档 → ok:false（client 守卫接得住，不抛）', () => {
  assert.equal(panelBody(null, null, null).ok, false)
  assert.equal(panelBody('x', { stage: 'off' }, { steps: [] }).ok, false)
})

test('client 面守卫在位（降级不白屏红线 + v3 主读旧键回退 + 版本动态）', () => {
  const c = fs.readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  assert.ok(c.includes('取数失败') && c.includes('不白屏'), '降级守卫串在位')
  assert.ok(c.includes('panel.residual'), 'v3 主读')
  assert.ok(c.includes('panel.residual || {}'), 'residual 缺位容错（旧数据不炸）')
  assert.ok(c.includes('st.audit ||'), 'state 消费回退（缺 audit 不炸）')
  assert.ok(c.includes('(panel.v ||'), '版本动态读')
  assert.ok(c.includes('props && props.sessionId'), '会话感知正式通道（props.sessionId 唯一来源）')
  assert.ok(c.includes('无单'), '无单灰态在位')
})
