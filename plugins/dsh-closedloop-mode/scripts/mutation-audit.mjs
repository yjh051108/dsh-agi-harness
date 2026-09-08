/**
 * mutation-audit.mjs — 沙箱变异审计（集成版：插件内可重复跑）
 *
 * 观察者 = 突变算子（无需人当神谕）；存活突变 = 装饰性断言 = 缺陷条目（自带可复现探针）。
 * 硬门：突变后语法无效 → 不入账（v1 会把语法错当"杀死"，虚高分数）。
 *
 * 用法：node scripts/mutation-audit.mjs [插件目录] [每类突变上限]
 * 产物：mutation-ledger.json（账本，默认落 DSH_HOME 或 --out 指定）
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OPS_VERSION, deriveMutations, applyMutation, revertMutation } from './lib/mutation-ops.mjs'
import { summarizeLedger, attributionOf, killRateOf, countedOf } from './lib/ledger-stats.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = resolve(process.argv[2] || join(HERE, '..'))
const PER_KIND = Number(process.argv[3] || 1)
const OUT = process.env.MUTATION_LEDGER || join(process.cwd(), 'mutation-ledger.json')
const SANDBOX = join(process.env.TEMP || '/tmp', 'cl-mut-sandbox')

/** 等价突变抑制清单（人复核，带理由）——不计入分母 */
const EQUIV_FILE = join(HERE, 'equivalents.json')
const equivalents = existsSync(EQUIV_FILE) ? (JSON.parse(readFileSync(EQUIV_FILE, 'utf8')).entries || []) : []

/** 文件 → 守护它的测试集（案底：一对一映射会漏掉 chain.test，产出假阳性） */
const TARGETS = [
  { file: 'src/write-gate.js', tests: ['tests/write-gate.test.mjs'] },
  { file: 'src/scope.js', tests: ['tests/scope.test.mjs'] },
  { file: 'src/optimal-engine.js', tests: ['tests/optimal.test.mjs', 'tests/chain.test.mjs', 'tests/maingate.test.mjs', 'tests/demands.test.mjs', 'tests/prepgap.test.mjs'] },
  { file: 'src/intent.js', tests: ['tests/intent-protocol.test.mjs', 'tests/freeze-decision.test.mjs', 'tests/user-signs.test.mjs'] },
  // 映射纪律（实测案底）：只收**沙箱自包含**测试（不 import 插件入口 index.js——它带宿主外部依赖，
  // 在审计沙箱里必红，会把整轮审计卡在基线绿门前）。tools-v3/panel-v3/v04-wiring 均因此不入映射。
  { file: 'src/mode-state.js', tests: ['tests/mode-state-v3.test.mjs', 'tests/auto-contract.test.mjs', 'tests/discrimination.test.mjs', 'tests/judge.test.mjs'] },
  { file: 'src/tools.js', tests: ['tests/infra-cwd.test.mjs', 'tests/delivery-attest.test.mjs', 'tests/probe-tokens.test.mjs', 'tests/user-signs.test.mjs', 'tests/judge-criteria.test.mjs', 'tests/tools-mutation-guard.test.mjs'] },
  { file: 'src/gate-core.js', tests: ['tests/gate-core.test.mjs', 'tests/model-fingerprint.test.mjs', 'tests/gate-core-model.test.mjs', 'tests/gate-core-guard.test.mjs'] },
  { file: 'src/run-cmd.js', tests: ['tests/run-cmd.test.mjs', 'tests/run-cmd-tokenize.test.mjs'] },
  { file: 'src/rank-organ.js', tests: ['tests/rank.test.mjs', 'tests/rank-guide.test.mjs', 'tests/rollback-cause.test.mjs', 'tests/rank-pricing-guard.test.mjs'] },
  { file: 'src/pricing-organ.js', tests: ['tests/pricing.test.mjs', 'tests/rollback-cause.test.mjs', 'tests/rank-pricing-guard.test.mjs'] },
  { file: 'src/intervene.js', tests: ['tests/intervene-metric.test.mjs'] },
]

const run = (args, cwd) => {
  try { execFileSync(process.execPath, args, { cwd, stdio: 'ignore', timeout: 180000 }); return 0 } catch { return 1 }
}

rmSync(SANDBOX, { recursive: true, force: true })
mkdirSync(SANDBOX, { recursive: true })
for (const item of ['src', 'tests', 'package.json', 'scripts']) {
  const p = join(PLUGIN, item)
  if (existsSync(p)) cpSync(p, join(SANDBOX, item), { recursive: true })
}

// 基线先绿门（案底：pristine 里存在失败测试时，任何突变都会因"套件本来就红"而假性被杀，
// 分数虚高——实测 0.941 的假象 vs 真实的 0.824）。不绿=拒绝出账本。
const baselineFailures = []
for (const t of TARGETS) {
  if (t.tests.some((rel) => !existsSync(join(SANDBOX, rel)))) continue
  for (const rel of t.tests) if (run(['--test', rel], SANDBOX) !== 0) baselineFailures.push(rel)
}
if (baselineFailures.length) {
  console.error('⛔ 基线不绿，拒绝出账本（否则所有突变都会假性被杀）：' + baselineFailures.join(', '))
  process.exit(1)
}

const ledger = []
for (const t of TARGETS) {
  const srcPath = join(SANDBOX, t.file)
  if (!existsSync(srcPath) || !t.tests.every((r) => existsSync(join(SANDBOX, r)))) { ledger.push({ file: t.file, skipped: '缺文件' }); continue }
  const pristine = readFileSync(srcPath, 'utf8')
  for (const m of deriveMutations(pristine, { perKind: PER_KIND })) {
    const mutated = applyMutation(pristine, m)
    if (revertMutation(mutated, m) !== pristine) { ledger.push({ file: t.file, kind: m.kind, line: m.line, skipped: '不可逆' }); continue }
    writeFileSync(srcPath, mutated)
    const syntaxOk = run(['--check', srcPath], SANDBOX) === 0
    let killed = false, note = '语法无效（不入账）', failed = []
    if (syntaxOk) {
      for (const rel of t.tests) if (run(['--test', rel], SANDBOX) !== 0) failed.push(rel)
      killed = failed.length > 0
      note = killed ? `tests FAIL（被杀于 ${failed.join(',')}）` : '全部测试 PASS（突变存活）'
    }
    writeFileSync(srcPath, pristine)
    const eq = equivalents.find((e) => e.file === t.file && e.kind === m.kind && e.from === m.from && e.to === m.to)
    ledger.push({ file: t.file, tests: t.tests, kind: m.kind, from: m.from, to: m.to, line: m.line, syntaxOk, killed, killedBy: failed, note, ...(eq ? { equivalent: true, equivReason: eq.reason } : {}) })
  }
}

// 口径与统计走 lib/ledger-stats（单一真相，可单测）：counted/killRate/attribution 同源
const counted = countedOf(ledger)
const killed = counted.filter((x) => x.killed).length
const survived = counted.filter((x) => !x.killed)
const equivalent = ledger.filter((x) => x.equivalent)
const stats = summarizeLedger(ledger)
const summary = {
  opsVersion: OPS_VERSION,
  plugin: PLUGIN,
  mutations: counted.length,
  syntaxInvalid: ledger.filter((x) => x.syntaxOk === false).length,
  equivalentExcluded: equivalent.length,
  killed,
  survived: survived.length,
  killRate: killRateOf(ledger),
  // v0.8.22 归因结构化：每条变异的杀手指向不再只活在 note 字符串里
  attribution: stats.attribution,
  singleKiller: stats.singleKiller,
  equivalents: equivalent.map((x) => ({ file: x.file, kind: x.kind, mutant: `${x.from} → ${x.to}`, reason: x.equivReason })),
  defects: survived.map((x) => ({ file: x.file, kind: x.kind, mutant: `${x.from} → ${x.to}`, at: x.line, probe: `在 ${x.file} 把 ${x.from} 改成 ${x.to} 后跑 ${x.tests.join(',')} 仍全绿` })),
}
mkdirSync(dirname(resolve(OUT)), { recursive: true })
writeFileSync(OUT, JSON.stringify({ summary, ledger }, null, 1))
console.log(JSON.stringify(summary, null, 1))
