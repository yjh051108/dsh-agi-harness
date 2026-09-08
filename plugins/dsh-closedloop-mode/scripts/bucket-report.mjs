/**
 * bucket-report — 学习样本的桶分布读数（只读，不写回盘）。
 *
 * 背景（本单实测基线）：quality-ledger 83 条记录 → 83 个唯一 taskSignature（唯一率 100%），
 * 即「一单一个键」——qualityTrend 要 ≥2 同键、scoreCandidate 要 ≥5 同键，两条消费口永远拿不到样本。
 * v0.8.35 起新记录带 bucket（结构粗桶）+ features + process；本脚本报：历史/新账的桶覆盖与分布。
 *
 * 用法: node scripts/bucket-report.mjs [--limit=10] [--file=<quality-ledger.jsonl>]
 * 诚实位：历史记录没有 features 字段 → 无法回溯分桶（正是本单新增该字段的理由），报告单列一行。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const num = (k, d) => { const a = args.find((x) => x.startsWith(`--${k}=`)); const v = a ? Number(a.split('=')[1]) : NaN; return Number.isFinite(v) ? v : d }
const limit = num('limit', 10)
const fileArg = (args.find((x) => x.startsWith('--file=')) || '').split('=')[1]
const ledger = fileArg || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'gate-weights', 'quality-ledger.jsonl')

if (!existsSync(ledger)) {
  console.log(`账本不存在：${ledger}`)
  console.log('记录数 0 · 桶数 0 · 唯一率 n/a · 最大桶 0（冷启动——还没有任何终验记账）')
  process.exit(0)
}

const rows = []
for (const line of readFileSync(ledger, 'utf8').split('\n')) {
  if (!line.trim()) continue
  try { rows.push(JSON.parse(line)) } catch { /* 坏行跳过 */ }
}

const withBucket = rows.filter((r) => typeof r.bucket === 'string' && r.bucket)
const legacy = rows.length - withBucket.length
const sigs = new Set(rows.map((r) => r.sig).filter(Boolean))
const buckets = new Map()
for (const r of withBucket) {
  const b = buckets.get(r.bucket) || { n: 0, clean: 0, mixed: 0, dirty: 0, incomplete: 0, rerolls: 0 }
  b.n++
  if (r.process && b[r.process] !== undefined) b[r.process]++
  b.rerolls += Number(r.rerolls) || 0
  buckets.set(r.bucket, b)
}
const sorted = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n)
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) : 'n/a')

console.log(`账本：${ledger}`)
console.log(`记录数 ${rows.length} · 带桶 ${withBucket.length} · 无桶(历史) ${legacy}`)
console.log(`sig 唯一率 ${pct(sigs.size, rows.length)}%（${sigs.size}/${rows.length}）· 桶数 ${buckets.size}${withBucket.length ? ` · 桶均样本 ${(withBucket.length / buckets.size).toFixed(2)}` : ''}`)
if (withBucket.length) {
  const max = sorted[0]
  console.log(`最大桶 ${max[0]} → n=${max[1].n}（样本门 ≥5 ${max[1].n >= 5 ? '已达' : '未达'}）`)
  console.log('\n桶 | n | clean/mixed/dirty/incomplete | 平均回炉')
  for (const [k, b] of sorted.slice(0, limit)) {
    console.log(`${k} | ${b.n} | ${b.clean}/${b.mixed}/${b.dirty}/${b.incomplete} | ${(b.rerolls / b.n).toFixed(2)}`)
  }
} else {
  console.log('分布：暂无——历史记录无 features 字段（不可回溯分桶）；新记录落盘后本表自动出数。')
}
