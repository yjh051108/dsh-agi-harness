/**
 * source-protocol.test — v0.8.10 source JSON 协议化
 * sp1 四类对象 → 规范字符串（含 read 行号）
 * sp2 路径含 # 的歧义在对象形态下消失（JSON 化的实证收益）
 * sp3 非法对象 → declare 明确拒（不落进含糊的「无来源」）
 * sp4 旧字符串形态行为不变（兼容）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'src-proto-'))
process.env.DSH_HOME = TMP
const { normalizeSource, declareStep, loadStack } = await import('../src/optimal-engine.js')

const full = (src) => ({
  title: 'T-' + Math.random().toString(36).slice(2, 8),
  invariants: ['不变量'],
  predictions: [{ key: 'k', value: '1', source: src }],
  cost: [{ failure: 'f', defense: 'd' }],
  law: [{ signal: 's', action: 'a' }],
  measure: { right: 'r', wrongSignal: 'w', channels: ['盘档', '运行时'] },
  vExpect: 'improve',
  confidence: 'high',
})

test('sp1 四类对象 → 规范字符串（含 read 行号）', () => {
  assert.equal(normalizeSource({ kind: 'probe', key: 'p1' }), 'probe:p1')
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a.mjs', line: 12 }), 'read:D:/x/a.mjs#L12')
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a.mjs', line: 'L7' }), 'read:D:/x/a.mjs#L7', 'line 带 L 前缀也规范')
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a.mjs' }), 'read:D:/x/a.mjs')
  assert.equal(normalizeSource({ kind: 'prior', text: '按公式算' }), 'prior:按公式算')
  assert.equal(normalizeSource({ kind: 'engram', title: '节点A' }), 'engram:节点A')
})

test('sp2 路径含 # 的歧义在对象形态下消失（JSON 化的实证收益）', () => {
  // 字符串形态 read:<path>#L<n> 靠正则 ^(.*)#L(\d+)$ 拆——路径自身含 # 时位置不可判定
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a#b#c.mjs', line: 7 }), 'read:D:/x/a#b#c.mjs#L7')
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a#b#c.mjs' }), 'read:D:/x/a#b#c.mjs')
  assert.equal(normalizeSource({ kind: 'read', path: 'D:/x/a#L9.mjs' }), 'read:D:/x/a#L9.mjs', '路径本身长得像行号锚点也不歧义')
})

test('sp3 非法对象 → declare 明确拒（不落进含糊的「无来源」）', () => {
  const r1 = declareStep('sp3a', full({ kind: 'nope', key: 'x' }))
  assert.equal(r1.ok, false)
  assert.match(r1.error, /来源形态非法/, '未知 kind 明确拒')
  const r2 = declareStep('sp3b', full({ kind: 'probe' }))
  assert.equal(r2.ok, false)
  assert.match(r2.error, /来源形态非法/, '缺 key 明确拒')
  const r3 = declareStep('sp3c', full({ kind: 'read', path: '   ' }))
  assert.equal(r3.ok, false)
  assert.match(r3.error, /来源形态非法/, '空路径明确拒')
})

test('sp4 旧字符串形态行为不变（兼容），且对象形态端到端落盘为规范字符串', () => {
  assert.equal(normalizeSource('prior:旧写法'), 'prior:旧写法')
  const r = declareStep('sp4a', full('prior:旧写法'))
  assert.equal(r.ok, true, r.error || '')
  assert.equal(loadStack('sp4a').steps[0].predictions[0].source, 'prior:旧写法')
  const r2 = declareStep('sp4b', full({ kind: 'prior', text: '对象写法' }))
  assert.equal(r2.ok, true, r2.error || '')
  assert.equal(loadStack('sp4b').steps[0].predictions[0].source, 'prior:对象写法', '对象在边界转成规范字符串落盘')
})
