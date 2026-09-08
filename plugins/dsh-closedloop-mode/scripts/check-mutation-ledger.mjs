#!/usr/bin/env node
/**
 * check-mutation-ledger — 变异审计账本**快检**（判据用，<1s，不重跑审计）。
 *
 * 为什么需要它：审计本体 34s+，直接当组判据会被 dry-run/超时闸误判「跑不了」。
 * 快检只做两件机器能当场核的事：
 *   ① 新鲜度：账本 mtime 必须 ≥ 受守护源码/测试/变异算子清单的最新 mtime——过期账本=不新鲜=拒绝出绿；
 *   ② 零幸存：summary.survived === 0（等价变异已由人复核单列，不计分母）。
 * 退出码：0=新鲜且零幸存 · 1=有幸存变异 · 2=账本缺失/过期（stale，绝不拿旧账本充绿）。
 */
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = join(HERE, '..')
const LEDGER = process.env.MUTATION_LEDGER || join(PLUGIN, 'mutation-ledger.json')

if (!existsSync(LEDGER)) {
  console.error('⛔ 账本不存在：' + LEDGER + '（先跑 mutation-audit.mjs）')
  process.exit(2)
}
const ledgerM = statSync(LEDGER).mtimeMs
const newest = (dir, filter) => {
  let m = 0
  const p = join(PLUGIN, dir)
  if (!existsSync(p)) return 0
  for (const f of readdirSync(p)) {
    if (!filter(f)) continue
    try { m = Math.max(m, statSync(join(p, f)).mtimeMs) } catch { /* 忽略不可读项 */ }
  }
  return m
}
const srcM = Math.max(newest('src', (f) => f.endsWith('.js')), newest('tests', (f) => f.endsWith('.mjs')), newest(join('scripts', 'lib'), (f) => f.endsWith('.mjs')))
if (srcM > ledgerM) {
  console.error(`⛔ 账本过期：源码/测试更新于 ${new Date(srcM).toISOString()}，账本停在 ${new Date(ledgerM).toISOString()}——先重跑审计（stale 账本不许充绿）`)
  process.exit(2)
}
const j = JSON.parse(readFileSync(LEDGER, 'utf8'))
const s = j.summary || {}
const targets = new Set((j.ledger || []).filter((r) => !r.skipped).map((r) => r.file))
const survived = (s.survived || 0)
console.log(`账本快检：目标 ${targets.size} 文件 · 变异 ${s.mutations} · 杀死 ${s.killed} · 幸存 ${survived} · 等价 ${s.equivalentExcluded} · 杀死率 ${s.killRate}`)
if (survived > 0) {
  console.error('⛔ 存在幸存变异（逐条处置：补测试杀死 或 入 equivalents.json 带机械理由）')
  process.exit(1)
}
console.log('✅ 账本新鲜且零幸存')
