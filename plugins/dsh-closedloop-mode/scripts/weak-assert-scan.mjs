#!/usr/bin/env node
/**
 * weak-assert-scan — 弱断言报告（v0.8.23，**只报告不扣分**）。
 * 用法：node scripts/weak-assert-scan.mjs [测试目录]
 * 输出：逐文件 weak/total 与最差清单（ratio 降序）。退出码恒为 0——它是观测面，不是门。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { weakReport } from './lib/assert-scan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(process.argv[2] || join(HERE, '..', 'tests'))
if (!existsSync(DIR)) { console.error('⛔ 目录不存在：' + DIR); process.exit(2) }

const files = readdirSync(DIR).filter((f) => f.endsWith('.test.mjs')).map((f) => ({ file: join(DIR, f), text: readFileSync(join(DIR, f), 'utf8') }))
const rep = weakReport(files)
console.log(`弱断言报告：${rep.files.length} 个测试文件 · 断言 ${rep.totals.total} 条 · 弱断言 ${rep.totals.weak} 条（占比 ${rep.totals.ratio}）`)
console.log('说明：弱断言=只断言真值（裸标识/成员链）；静态判定会误伤，本报告不作扣分依据（NEXT.md P2）。')
if (rep.worst.length) {
  console.log('最差清单（ratio 降序）：')
  for (const w of rep.worst.slice(0, 10)) console.log(`  ${w.file.replace(DIR + '\\', '').replace(DIR + '/', '')}  weak ${w.weak}/${w.total}（${w.ratio}）`)
} else {
  console.log('✅ 未发现弱断言（全部断言都带比较/量词/取反）')
}
const sample = rep.files.flatMap((r) => r.weakList.map((a) => `${r.file.split(/[\\/]/).pop()} → ${a}`)).slice(0, 5)
if (sample.length) console.log('样例：\n  ' + sample.join('\n  '))
