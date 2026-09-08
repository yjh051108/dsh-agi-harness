#!/usr/bin/env node
/**
 * check-falsify — 判据可证伪门 · 真实案卷复现（判据用，<3s）
 *
 * 两条机器能当场核的断言（任一不符 → exit 1）：
 *   ① 池核案（本次诊断的原物）：check.mjs 的 33 组文本 grep 判据 + poolcore-backrooms.html
 *      —— 原产物上 `--all` 实测 PASS exit 0；负对照门必须判 **VACUOUS**。
 *   ② 行为型判据（真执行产物读运行时读数）—— 必须判 **SENSITIVE**（不许把真尺子误杀）。
 *
 * fixture 不在本机时该项标 SKIP（不冒充绿）。
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const { runFalsifyGate, CONTROLS_FULL } = await import('../src/falsify.js')

/** 真跑判据（零壳：node + argv） */
const realRun = (cmd) => {
  const parts = cmd.split(/\s+/)
  const bin = parts[0] === 'node' ? process.execPath : parts[0]
  const r = spawnSync(bin, parts.slice(1), { encoding: 'utf8', timeout: 60000 })
  if (r.error) return 'broken'
  return r.status === 0 ? 'green' : 'red'
}

const results = []

/* ---------- ① 池核案：文本 grep 判据必须被判空转 ---------- */
const POOL_DIR = 'D:/dsh/_inspect/poolcore'
const POOL_JUDGE = join(POOL_DIR, 'check.mjs')
const POOL_ARTIFACT = join(POOL_DIR, 'poolcore-backrooms.html')
if (!existsSync(POOL_JUDGE) || !existsSync(POOL_ARTIFACT)) {
  results.push({ name: 'poolcore-vacuous', state: 'SKIP', detail: 'fixture 不在本机：' + POOL_DIR })
} else {
  const cmd = `node ${POOL_JUDGE} --all ${POOL_ARTIFACT}`
  const gate = await runFalsifyGate({
    cmd,
    writeSet: [POOL_JUDGE, POOL_ARTIFACT],
    cwd: POOL_DIR,
    run: realRun,
    controls: CONTROLS_FULL,
  })
  const controls = gate.controls.map((c) => `${c.kind}=${c.state}`).join(' ')
  results.push({
    name: 'poolcore-vacuous',
    state: gate.verdict === 'vacuous' ? 'PASS' : 'FAIL',
    detail: `verdict=${gate.verdict} · ${controls} · 产物=${gate.artifacts.length} · 还原=${gate.restored}`,
  })
}

/* ---------- ② 行为型判据：不许误杀 ---------- */
{
  const dir = mkdtempSync(join(tmpdir(), 'check-falsify-beh-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.mjs')
  writeFileSync(judge, [
    "import { pathToFileURL } from 'node:url'",
    'const m = await import(pathToFileURL(process.argv[2]).href)',
    'process.exit(m.answer === 42 ? 0 : 1)',
  ].join('\n'))
  writeFileSync(artifact, 'export const answer = 42\n')
  const gate = await runFalsifyGate({
    cmd: `node ${judge} ${artifact}`,
    writeSet: [judge, artifact],
    cwd: dir,
    run: realRun,
    controls: CONTROLS_FULL,
  })
  results.push({
    name: 'behavior-sensitive',
    state: gate.verdict === 'sensitive' ? 'PASS' : 'FAIL',
    detail: `verdict=${gate.verdict} · ${gate.controls.map((c) => `${c.kind}=${c.state}`).join(' ')} · 还原=${gate.restored}`,
  })
}

for (const r of results) console.log(`[falsify] ${r.state.padEnd(4)} ${r.name} — ${r.detail}`)
const bad = results.filter((r) => r.state === 'FAIL')
console.log(`[falsify] ${bad.length ? 'FAIL' : 'PASS'} — 断言 ${results.length} · 未过 ${bad.length} · SKIP ${results.filter((r) => r.state === 'SKIP').length}`)
process.exit(bad.length ? 1 : 0)
