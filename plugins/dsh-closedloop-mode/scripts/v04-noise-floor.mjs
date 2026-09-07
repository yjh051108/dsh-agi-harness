#!/usr/bin/env node
/**
 * v04-noise-floor — ⓪ 前置实测：测量噪声地板（THEORY-v0.4 §3.6/§7-⓪）。
 * 同一仓库状态，3 条真实 measure 各跑 2 次 → z 抖动=地板；阻尼 I 的 eps 与"停滞 k"阈必须 > 它。
 * 沙箱纪律：spawnSync 直起 node 子进程，stdout/stderr 指**文件描述符**（无 piped stdio，绕开禁区）。
 * 用法：node scripts/v04-noise-floor.mjs（插件根目录）
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseOutput, zOf } from '../src/v04-core.js'

const root = process.cwd()
const out = join(root, '.noise')
if (existsSync(out)) rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const G_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state')
mkdirSync(G_DIR, { recursive: true })

const TESTS = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).map((f) => join('tests', f))
const MEASURES = [
  { id: 'suite-green', kind: 'ratio', target: 1, args: ['--test', ...TESTS], parse: (t) => { const p = Number(/# pass (\d+)/.exec(t)?.[1] || NaN); const f = Number(/# fail (\d+)/.exec(t)?.[1] || NaN); return { value: p + f > 0 ? p / (p + f) : NaN } } },
  { id: 'build-green', kind: 'bool', args: ['scripts/build.mjs'] },
  { id: 'probe-selftest', kind: 'ratio', target: 1, args: null, read: () => ({ value: 1 }) }, // 确定性读：地板零点校准
]

function runOnce(m, i) {
  if (m.read) return m.read()
  const f = join(out, `${m.id}.${i}.txt`)
  const fd = openSync(f, 'w')
  const r = spawnSync(process.execPath, m.args, { cwd: root, stdio: ['ignore', fd, fd], windowsHide: true })
  closeSync(fd)
  const text = readFileSync(f, 'utf8')
  return m.parse ? m.parse(text) : { exit: r.status === 0 ? 0 : 1 }
}

const rows = []
for (const m of MEASURES) {
  const zs = []
  for (const i of [1, 2]) {
    const o = runOnce(m, i)
    zs.push(zOf({ id: m.id, kind: m.kind, w: 1, cmd: 'node', target: m.target ?? null }, o))
  }
  rows.push({ id: m.id, z: zs, jitter: Math.abs(zs[1] - zs[0]) })
}
const floor = Math.max(...rows.map((r) => r.jitter))
const report = { at: Date.now(), samples: rows.length * 2, floor, rows, note: 'floor=同状态重测 z 最大抖动；阻尼 eps 与停滞判定必须 > 此值' }
writeFileSync(join(G_DIR, 'noise-floor-probe.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
