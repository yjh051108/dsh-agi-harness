/**
 * check-design — 机制设计文档的结构校验（机械，不评价内容好坏）。
 * 校验：六节齐备 + 无「两方语」（约束/管理/提示模型）+ 含可核对内容（表/数字/公式）。
 * 用法: node scripts/check-design.mjs [--file=<path>]
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (process.argv.slice(2).find((x) => x.startsWith('--file=')) || '').split('=')[1]
const file = arg || join(here, '..', 'docs', 'ONE-INDIVIDUAL.md')

const SECTIONS = [
  ['前提与推论', /##\s*一、前提与推论/],
  ['唯一回路（前馈）', /##\s*二、唯一回路/],
  ['三环=三投影', /##\s*三、三环不是三个子系统/],
  ['千人千面', /##\s*四、千人千面/],
  ['奇点条件', /##\s*五、奇点条件/],
  ['验收读数', /##\s*六、怎么知道它成了/],
]
const FORBIDDEN = [
  ['约束模型', /约束模型/],
  ['管理模型', /管理模型/],
  ['提示模型', /提示模型/],
]

if (!existsSync(file)) {
  console.log(`✗ 设计文档不存在：${file}`)
  process.exit(1)
}
const text = readFileSync(file, 'utf8')
const bytes = Buffer.byteLength(text, 'utf8')
let fail = 0

console.log(`设计文档：${file}（${bytes} B）\n六节校验：`)
for (const [name, re] of SECTIONS) {
  const ok = re.test(text)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}`)
}

console.log('\n两方语校验（应全 0）：')
for (const [name, re] of FORBIDDEN) {
  const m = text.match(new RegExp(re.source, 'g'))
  const n = m ? m.length : 0
  if (n) fail++
  console.log(`  ${n === 0 ? '✓' : '✗'} ${name}：${n} 处`)
}

const tables = (text.match(/^\|/gm) || []).length
const nums = (text.match(/\d+(?:\.\d+)?%?/g) || []).length
console.log(`\n可核对内容：表格行 ${tables} · 数字 ${nums}`)
if (tables < 10 || nums < 20) { fail++; console.log('  ✗ 可核对内容不足（表格行 ≥10、数字 ≥20）') }
else console.log('  ✓ 可核对内容达标')

console.log(fail === 0 ? '\nDESIGN OK' : `\nDESIGN FAIL（${fail} 项）`)
process.exit(fail === 0 ? 0 : 1)
