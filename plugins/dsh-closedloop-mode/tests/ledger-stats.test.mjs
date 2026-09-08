/**
 * ledger-stats.test — v0.8.22 变异账本统计（纯函数）
 * ls1 countedOf 口径：跳过/语法无效/等价不入分母
 * ls2 killRateOf：口径与审计一致；空账本=null（不假装 0）
 * ls3 attributionOf：只统计被杀的变异；旧账本无 killedBy 记「未知」
 * ls4 summarizeLedger：单杀者清单（只被一个测试文件杀死）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { countedOf, killRateOf, attributionOf, summarizeLedger } = await import('../scripts/lib/ledger-stats.mjs')

const L = [
  { file: 'src/a.js', kind: 'flip-bool', from: 'false', to: 'true', syntaxOk: true, killed: true, killedBy: ['tests/a.test.mjs'] },
  { file: 'src/a.js', kind: 'num-plus1', from: '1', to: '2', syntaxOk: true, killed: true, killedBy: ['tests/a.test.mjs', 'tests/b.test.mjs'] },
  { file: 'src/a.js', kind: 'return-const', from: 'null', to: 'undefined', syntaxOk: true, killed: false, killedBy: [] },
  { file: 'src/a.js', kind: 'flip-cmp', from: '<=', to: '<', syntaxOk: true, killed: false, equivalent: true },
  { file: 'src/b.js', kind: 'flip-logic', from: '||', to: '&&', skipped: '不可逆' },
  { file: 'src/b.js', kind: 'drop-await', from: 'await ', to: '', syntaxOk: false, killed: false },
]

test('ls1 countedOf 口径', () => {
  assert.equal(countedOf(L).length, 3, '6 行中：跳过 1 + 语法无效 1 + 等价 1 不入分母 → 3')
})

test('ls2 killRateOf 与空账本', () => {
  assert.equal(killRateOf(L), 0.667, '3 计分 2 杀 = 0.667')
  assert.equal(killRateOf([]), null, '无计分行=null')
})

test('ls3 attributionOf 只统计被杀者', () => {
  const a = attributionOf(L)
  assert.deepEqual(a['src/a.js'], { 'tests/a.test.mjs': 2, 'tests/b.test.mjs': 1 })
  assert.equal(a['src/b.js'], undefined, '幸存/跳过/语法无效不进归因')
  const legacy = attributionOf([{ file: 'src/c.js', syntaxOk: true, killed: true }])
  assert.deepEqual(legacy['src/c.js'], { 未知: 1 }, '旧账本无 killedBy → 未知（不猜）')
})

test('ls4 summarizeLedger 单杀者清单', () => {
  const s = summarizeLedger(L)
  assert.equal(s.counted, 3)
  assert.equal(s.killed, 2)
  assert.equal(s.survived, 1)
  assert.equal(s.equivalent, 1)
  assert.equal(s.killRate, 0.667)
  assert.equal(s.singleKiller.length, 1, '只有 flip-bool 是单杀者')
  assert.match(s.singleKiller[0], /flip-bool/)
})
