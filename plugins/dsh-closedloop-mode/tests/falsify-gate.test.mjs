/**
 * falsify-gate.test — v0.8.30 判据可证伪门 · 执行层（变异 → 真跑 → finally 还原）
 * g1 字面壳绿 ⇒ vacuous，且产物字节级还原
 * g2 两壳皆红 ⇒ sensitive，且产物字节级还原
 * g3 无产物 ⇒ no-artifact，判据一次都不跑
 * g4 判据抛错 ⇒ broken ⇒ unproven（跑不了≠敏感），产物仍还原
 * g5 还原被破坏 ⇒ 抛 restore-failed（绝不留在假货态）
 * g6 字面池来源 = 判据源码 + 命令本体
 * g7 假货与原文同字节尺寸
 * g8 真实子进程 e2e：grep 型判据必判 vacuous
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const { runFalsifyGate, stubFor } = await import('../src/falsify.js')

/** 内存假文件系统（可计数/可注坏；键统一用 / 归一，兼容 Windows 反斜杠路径） */
function fakeFs(files = {}) {
  const norm = (p) => String(p).replace(/\\/g, '/')
  const map = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const reads = []
  return {
    map,
    reads,
    readFile: (p) => { reads.push(norm(p)); const v = map.get(norm(p)); if (v === undefined) throw new Error('ENOENT ' + p); return Buffer.from(v) },
    writeFile: (p, buf) => { map.set(norm(p), Buffer.from(buf)) },
    probe: (p) => {
      const v = map.get(norm(p))
      return v === undefined ? { exists: false, isFile: false, size: 0 } : { exists: true, isFile: true, size: Buffer.byteLength(v) }
    },
    text: (p) => map.get(norm(p)).toString('utf8'),
  }
}

test('g1 字面壳绿 ⇒ vacuous，且产物字节级还原', async () => {
  const fs = fakeFs({ 'D:/p/judge.mjs': 'const NEEDLE="alpha";', 'D:/p/out.txt': 'alpha alpha' })
  const r = await runFalsifyGate({
    cmd: 'node D:/p/judge.mjs D:/p/out.txt',
    writeSet: ['D:/p/judge.mjs', 'D:/p/out.txt'],
    cwd: 'D:/p',
    judgeSource: 'const NEEDLE="alpha";',
    run: async () => 'green',
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    probe: fs.probe,
  })
  assert.equal(r.verdict, 'vacuous', '字面壳通过=判据空转')
  assert.deepEqual(r.controls.map((c) => c.kind), ['literal', 'inert'])
  assert.equal(r.restored, true)
  assert.equal(fs.text('D:/p/out.txt'), 'alpha alpha', '产物必须还原为原文')
  assert.equal(fs.text('D:/p/judge.mjs'), 'const NEEDLE="alpha";', '判据脚本从未被变异')
})

test('g2 两壳皆红 ⇒ sensitive，且产物字节级还原', async () => {
  const fs = fakeFs({ 'D:/p/judge.mjs': 'x', 'D:/p/out.txt': 'payload' })
  const r = await runFalsifyGate({
    cmd: 'node D:/p/judge.mjs D:/p/out.txt',
    writeSet: ['D:/p/judge.mjs', 'D:/p/out.txt'],
    cwd: 'D:/p',
    judgeSource: 'x',
    run: async () => 'red',
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    probe: fs.probe,
  })
  assert.equal(r.verdict, 'sensitive')
  assert.equal(fs.text('D:/p/out.txt'), 'payload')
})

test('g3 无产物 ⇒ no-artifact，判据一次都不跑', async () => {
  let calls = 0
  const fs = fakeFs({ 'D:/p/judge.mjs': 'x' })
  const r = await runFalsifyGate({
    cmd: 'node D:/p/judge.mjs',
    writeSet: ['D:/p/judge.mjs'],
    cwd: 'D:/p',
    run: async () => { calls++; return 'green' },
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    probe: fs.probe,
    probe: fs.probe,
  })
  assert.equal(r.verdict, 'no-artifact')
  assert.equal(calls, 0, '没有产物就不该真跑判据（省时间，且不产生假证据）')
})

test('g4 判据抛错 ⇒ broken ⇒ unproven，产物仍还原', async () => {
  const fs = fakeFs({ 'D:/p/judge.mjs': 'x', 'D:/p/out.txt': 'payload' })
  const r = await runFalsifyGate({
    cmd: 'node D:/p/judge.mjs D:/p/out.txt',
    writeSet: ['D:/p/judge.mjs', 'D:/p/out.txt'],
    cwd: 'D:/p',
    judgeSource: 'x',
    run: async () => { throw new Error('spawn EPERM') },
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    probe: fs.probe,
  })
  assert.equal(r.verdict, 'unproven', '跑不了≠敏感（也不能算通过）')
  assert.equal(r.controls.every((c) => c.state === 'broken'), true)
  assert.equal(fs.text('D:/p/out.txt'), 'payload')
})

test('g5 还原被破坏 ⇒ 抛 restore-failed', async () => {
  const files = { 'D:/p/judge.mjs': 'x', 'D:/p/out.txt': 'payload' }
  let phase = 'backup'
  const norm = (p) => String(p).replace(/\\/g, '/')
  const map = new Map(Object.entries(files))
  const readFile = (p) => {
    if (norm(p) === 'D:/p/out.txt') {
      if (phase === 'backup') return Buffer.from(map.get('D:/p/out.txt'))
      return Buffer.from('TAMPERED') // 还原校验时读到假货
    }
    return Buffer.from(map.get(norm(p)))
  }
  const writeFile = (p, buf) => { map.set(norm(p), Buffer.from(buf)) }
  const probe = (p) => {
    const v = map.get(norm(p))
    return v === undefined ? { exists: false, isFile: false, size: 0 } : { exists: true, isFile: true, size: Buffer.byteLength(v) }
  }
  await assert.rejects(
    () => runFalsifyGate({
      cmd: 'node D:/p/judge.mjs D:/p/out.txt',
      writeSet: ['D:/p/judge.mjs', 'D:/p/out.txt'],
      cwd: 'D:/p',
      judgeSource: 'x',
      run: async () => { phase = 'verify'; return 'green' },
      readFile,
      writeFile,
      probe,
    }),
    /restore-failed/,
  )
})

test('g6 字面池来源 = 判据源码 + 命令本体', async () => {
  const seen = []
  const fs = fakeFs({ 'D:/p/judge.mjs': 'x', 'D:/p/out.txt': 'payload' })
  await runFalsifyGate({
    cmd: 'node D:/p/judge.mjs --from-command D:/p/out.txt',
    writeSet: ['D:/p/judge.mjs', 'D:/p/out.txt'],
    cwd: 'D:/p',
    judgeSource: 'const WANT = "JUDGE_LITERAL";',
    run: async () => { seen.push(fs.text('D:/p/out.txt')); return 'red' },
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    probe: fs.probe,
  })
  assert.equal(seen[0].includes('JUDGE_LITERAL'), true, '判据脚本里的字面量必须进壳')
  assert.equal(seen[0].includes('--from-command'), true, '命令本体里的字面量也要进壳（宁可多不可漏）')
})

test('g9 不留痕：变异后内容与 mtime 都还原（真文件系统）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-mtime-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.txt')
  writeFileSync(judge, 'const t = 1\n')
  writeFileSync(artifact, 'payload\n')
  const before = statSync(artifact).mtimeMs
  await new Promise((r) => setTimeout(r, 30)) // 让"不还原"的情形能被检出（mtime 分辨率）
  await runFalsifyGate({
    cmd: `node ${judge} ${artifact}`,
    writeSet: [judge, artifact],
    cwd: dir,
    judgeSource: 'const t = 1\n',
    run: async () => 'red',
  })
  assert.equal(readFileSync(artifact, 'utf8'), 'payload\n', '内容还原')
  // utimesSync 用 Date（毫秒精度），原始 mtimeMs 可能带亚毫秒——判「没被推高」而不是「逐位相等」
  const after = statSync(artifact).mtimeMs
  assert.ok(Math.abs(after - before) < 2, `mtime 不得被推高（before=${before} after=${after}）——否则账本快检误判 stale`)
})

test('g7 假货与原文同字节尺寸', () => {
  const orig = Buffer.from('x'.repeat(1234), 'utf8')
  assert.equal(stubFor('literal', ['a', 'b'], orig.length, '.txt').length, 1234)
  assert.equal(stubFor('inert', ['a'], orig.length, '.mjs').length, 1234)
  assert.equal(stubFor('empty', [], orig.length, '.txt').length, 0)
  assert.equal(stubFor('inert', [], 64, '.mjs').toString('utf8').startsWith('export {}'), true)
})

test('g8 真实子进程 e2e：grep 型判据必判 vacuous', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'falsify-e2e-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.txt')
  writeFileSync(judge, [
    "import { readFileSync } from 'node:fs'",
    'const txt = readFileSync(process.argv[2], "utf8")',
    'process.exit(txt.includes("NEEDLE") ? 0 : 1)',
  ].join('\n'))
  writeFileSync(artifact, 'NEEDLE and some real work\n')
  const realRun = async (cmd) => {
    const parts = cmd.split(/\s+/)
    const r = spawnSync(process.execPath, parts.slice(1), { encoding: 'utf8' })
    if (r.error) return 'broken'
    return r.status === 0 ? 'green' : 'red'
  }
  const gate = await runFalsifyGate({
    cmd: `node ${judge} ${artifact}`,
    writeSet: [judge, artifact],
    cwd: dir,
    run: realRun,
  })
  assert.equal(gate.verdict, 'vacuous', '真进程里 grep 型判据照样被字面壳骗过 ⇒ 判据空转')
  assert.equal(readFileSync(artifact, 'utf8'), 'NEEDLE and some real work\n', '产物已还原')
})
