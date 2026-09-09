/**
 * seam-audit — 缝盘点（只读）：身体与判断力之间的「两方接口」有多少，读数型出口有多少。
 *
 * 口径（固定、可复跑）：
 *  两方接口 = ①注入点（spliceInjection 调用）②叮嘱行（回执里以 emoji 开头的追加行）
 *             ③第二人称/祈使短语（去注释后的字符串里：建议/别忘了/记得/请/应当/不要/禁止）
 *  读数型出口 = 台账写入调用（record…/append… 落 graded-state）——信息以「读数」形态回流，不是叮嘱
 * 纪律：只读源码，不写盘、不改盘。数字是基线，不判好坏。
 *
 * 用法: node scripts/seam-audit.mjs [--dir=<src>] [--top=8]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const argDir = (process.argv.slice(2).find((x) => x.startsWith('--dir=')) || '').split('=')[1]
const srcDir = argDir || join(here, '..', 'src')
const top = Number((process.argv.slice(2).find((x) => x.startsWith('--top=')) || '').split('=')[1] || 8)

if (!existsSync(srcDir)) { console.log(`✗ src 不存在：${srcDir}`); process.exit(1) }

/** 去注释（块注释 + 行注释），避免把说明文字算成叮嘱 */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

const INJECT = /spliceInjection\s*\(/g
const PROSE_LINE = /['"`]\\n[📊🎖📚🧭🧹⏳⚠️📌🎣📏🧱🧪🔏📐]/g
const ADVICE = /(建议|别忘了|记得|请|应当|不要|禁止)/g
const READOUT = /\b(recordQuality|recordLesson|recordDecision|recordOutcome|recordBoundOutcome|recordCombo|recordGateEffect|appendFileSync|append)\s*\(/g

const files = readdirSync(srcDir).filter((f) => f.endsWith('.js') && statSync(join(srcDir, f)).isFile())
const rows = []
const totals = { inject: 0, prose: 0, advice: 0, readout: 0 }
for (const f of files) {
  const code = stripComments(readFileSync(join(srcDir, f), 'utf8'))
  const n = (re) => (code.match(re) || []).length
  const r = { file: f, inject: n(INJECT), prose: n(PROSE_LINE), advice: n(ADVICE), readout: n(READOUT) }
  totals.inject += r.inject; totals.prose += r.prose; totals.advice += r.advice; totals.readout += r.readout
  if (r.inject || r.prose || r.advice || r.readout) rows.push(r)
}

const seams = totals.inject + totals.prose + totals.advice
console.log(`src 目录：${srcDir}（${files.length} 个文件）`)
console.log(`\n两方接口（缝）：注入点 ${totals.inject} + 叮嘱行 ${totals.prose} + 第二人称/祈使短语 ${totals.advice} = ${seams}`)
console.log(`读数型出口（台账写入）：${totals.readout}`)
console.log(`缝 / 读数 比值：${totals.readout ? (seams / totals.readout).toFixed(2) : 'n/a'}（越小越像一个个体的内部回路）`)

console.log(`\n分文件（按缝数降序，前 ${top}）：`)
console.log('文件 | 注入点 | 叮嘱行 | 祈使语 | 台账出口')
for (const r of rows.sort((a, b) => (b.inject + b.prose + b.advice) - (a.inject + a.prose + a.advice)).slice(0, top)) {
  console.log(`${r.file} | ${r.inject} | ${r.prose} | ${r.advice} | ${r.readout}`)
}
console.log('\n注：缝=同一份信息以「对话叮嘱」形态进入判断力；归约方向是把它改成「读数」进入下一步计算（见 docs/ONE-INDIVIDUAL.md §七）。')
process.exit(0)
