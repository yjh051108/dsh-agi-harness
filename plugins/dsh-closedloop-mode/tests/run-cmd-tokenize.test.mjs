/**
 * run-cmd-tokenize.test — v0.8.20 argv 分词器（零壳协议执行入口）
 * tk1 空引号参数 → 空串 token（旧实现退化成 '""'）
 * tk2 双引号内转义引号（旧实现被截断）
 * tk3 路径含撇号保持单 token（旧行为不破）
 * tk4 混合引号与多参数；禁壳判定不放松
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { tokenize, execCmdSync } = await import('../src/run-cmd.js')

test('tk1 空引号参数', () => {
  assert.deepEqual(tokenize('node x.mjs ""'), ['node', 'x.mjs', ''], '空引号=空串 token')
  assert.deepEqual(tokenize("node x.mjs ''"), ['node', 'x.mjs', ''])
})

test('tk2 双引号内转义', () => {
  assert.deepEqual(tokenize('node -e "console.log(\\"a\\")"'), ['node', '-e', 'console.log("a")'])
  assert.deepEqual(tokenize('node x.mjs "a\\\\b"'), ['node', 'x.mjs', 'a\\b'], '反斜杠转义')
})

test('tk3 路径含撇号（旧行为不破）', () => {
  assert.deepEqual(tokenize("node C:\\it's\\x.mjs"), ['node', "C:\\it's\\x.mjs"], '撇号在 token 中段=字面量')
  assert.deepEqual(tokenize('node "C:\\a b\\x.mjs"'), ['node', 'C:\\a b\\x.mjs'], '含空格路径用引号')
})

test('tk4 混合与禁壳', () => {
  assert.deepEqual(tokenize('node x.mjs "a b" c'), ['node', 'x.mjs', 'a b', 'c'])
  assert.throws(() => execCmdSync('node x.mjs | more'), /协议禁壳/, '引号外 | 仍一票拒')
  assert.throws(() => execCmdSync('node x.mjs > out.txt'), /协议禁壳/)
})
