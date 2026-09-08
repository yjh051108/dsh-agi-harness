/**
 * standard-ratchet.mjs — 标准棘轮（集成版，仪器版本化）
 *
 * 规则：每个模块的变异杀死率基线**只能升不能降**（降=机拒，退出码 2，不落盘）。
 * 关键细节（案底）：**换算子集=换测量仪器**——v1 算子粗，报 1.0；v2 算子细，同一代码只剩 0.65。
 *   不同仪器的读数不可比，所以基线携带 opsVersion；仪器变了就**重立基线**并明示，
 *   否则棘轮会变成陷阱（新仪器一上来就"降标准"被拒，永远动不了）。
 *
 * 用法：
 *   node scripts/standard-ratchet.mjs --record                  按当前 ledger 记/升基线
 *   node scripts/standard-ratchet.mjs --simulate <file>=<rate>   模拟一次调整（用于演示/复核）
 *   node scripts/standard-ratchet.mjs                            只看现状
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPS_VERSION } from './lib/mutation-ops.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const LEDGER = process.env.MUTATION_LEDGER || join(resolve(HERE, '..'), 'mutation-ledger.json')
const BASELINE = process.env.STANDARD_BASELINE || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'closedloop-standards.json')

export function standardsFromLedger(ledgerPath = LEDGER) {
  const j = JSON.parse(readFileSync(ledgerPath, 'utf8'))
  const per = {}
  for (const r of j.ledger) {
    if (r.skipped || r.syntaxOk === false) continue
    per[r.file] ??= { total: 0, killed: 0 }
    per[r.file].total++
    if (r.killed) per[r.file].killed++
  }
  const out = {}
  for (const [f, v] of Object.entries(per)) out[f] = +(v.killed / v.total).toFixed(3)
  return { opsVersion: j.summary?.opsVersion || OPS_VERSION, standards: out }
}

export function ratchet(next, prev) {
  const refused = [], improved = []
  for (const [f, v] of Object.entries(next.standards)) {
    const old = prev.standards?.[f]
    if (old === undefined) continue
    if (v < old) refused.push({ file: f, from: old, to: v })
    else if (v > old) improved.push({ file: f, from: old, to: v })
  }
  return { accepted: refused.length === 0, refused, improved }
}

export function record(next, prev) {
  if (prev.opsVersion && next.opsVersion && prev.opsVersion !== next.opsVersion) {
    writeFileSync(BASELINE, JSON.stringify(next, null, 1))
    console.log(`🔁 仪器变更 ${prev.opsVersion} → ${next.opsVersion}：旧基线不可比，已重立基线（非降标准）`)
    console.log('   ' + JSON.stringify(next.standards))
    return 0
  }
  const r = ratchet(next, prev)
  if (!r.accepted) {
    console.log('⛔ 标准棘轮拒绝：以下模块杀死率低于既有基线（降标准=机拒，不落盘）')
    for (const x of r.refused) console.log(`   ${x.file}: ${x.from} → ${x.to}`)
    console.log('   唯一合法路径：把断言补回去，让杀死率回到或高于基线。')
    return 2
  }
  writeFileSync(BASELINE, JSON.stringify(next, null, 1))
  console.log(`✅ 标准棘轮落账（opsVersion=${next.opsVersion}）：${JSON.stringify(next.standards)}`)
  for (const x of r.improved) console.log(`   ↑ ${x.file}: ${x.from} → ${x.to}（自挣）`)
  return 0
}

const load = () => (existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { opsVersion: null, standards: {} })

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2)
  if (argv.includes('--record')) process.exit(record(standardsFromLedger(), load()))
  else if (argv.includes('--simulate')) {
    const [file, rate] = (argv[argv.indexOf('--simulate') + 1] || '').split('=')
    if (!file || rate === undefined) { console.log('用法: --simulate <file>=<rate>'); process.exit(1) }
    const prev = load()
    process.exit(record({ opsVersion: prev.opsVersion || OPS_VERSION, standards: { ...prev.standards, [file]: Number(rate) } }, prev))
  } else console.log(JSON.stringify({ baseline: load(), current: standardsFromLedger() }, null, 1))
}
