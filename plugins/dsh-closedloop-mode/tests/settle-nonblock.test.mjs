/**
 * settle-nonblock.test — v0.8.32 卡死修复（判据执行不再堵事件环 + 负对照记忆化）
 *
 * 案底（用户实测）：可证伪门在 trySettleGroups 里用 execFileSync 同步跑 3 条负对照 + 1 次真跑，
 * 重判据（dotnet test / BFS 脚本）一次落账把整个宿主堵死几分钟——表现「卡死 + 注入延迟高」。
 *
 * n1 异步执行器三态（green / red / broken）
 * n2 事件环不堵：判据跑 600ms 期间定时器必须按时触发（同步版这里会饿死）
 * n3 负对照记忆化：同一判据第二次落账不再真跑（cached=true，run 调用次数不增）
 * n4 指纹失效：产物变了 → 记忆失效重跑
 * n5 负对照超时封顶：control 超时 < 真跑超时（判据在假货上跑太久=跑不了）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { execCmdAsync } = await import('../src/run-cmd.js')
const { judgeRunner, falsifyBlock } = await import('../src/tools.js')

test('n1 异步执行器三态', async () => {
  assert.equal((await execCmdAsync('node -e "console.log(1)"', { timeout: 5000 })).trim(), '1')
  await assert.rejects(() => execCmdAsync('node -e "process.exit(2)"', { timeout: 5000 }), (e) => e.clazz === 'red')
  // 缺脚本=物料未就位（pending，与同步版同分类）；缺可执行=broken
  await assert.rejects(() => execCmdAsync('node D:/definitely/missing.mjs', { timeout: 5000 }), (e) => e.clazz === 'pending')
  await assert.rejects(() => execCmdAsync('D:/definitely/not-a-binary.exe', { timeout: 5000 }), (e) => e.clazz === 'broken')
  await assert.rejects(() => execCmdAsync('echo a && echo b', { timeout: 5000 }), /禁壳/)
})

test('n2 事件环不堵：判据跑 600ms 期间定时器仍按时触发', async () => {
  let fired = 0
  const t0 = Date.now()
  const tick = setInterval(() => { fired++ }, 100)
  await execCmdAsync('node -e "setTimeout(()=>{},600)"', { timeout: 5000 })
  clearInterval(tick)
  const ms = Date.now() - t0
  assert.ok(ms >= 500, `判据应真跑 ~600ms（实测 ${ms}ms）`)
  assert.ok(fired >= 3, `事件环必须活着（600ms 内 100ms 定时器至少 3 次，实测 ${fired}）——同步版这里会饿死`)
})

test('n3 负对照记忆化：第二次不再真跑', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-memo-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.txt')
  writeFileSync(judge, 'export const x = 1\n')
  writeFileSync(artifact, 'payload\n')
  let calls = 0
  const run = async () => { calls++; return 'red' }
  const cmd = `cmd: node ${judge} ${artifact}`
  const a = await falsifyBlock([cmd], { writeSet: [judge, artifact], cwd: dir, run })
  const afterFirst = calls
  const b = await falsifyBlock([cmd], { writeSet: [judge, artifact], cwd: dir, run })
  assert.ok(afterFirst >= 3, `首次应跑 3 条负对照（实测 ${afterFirst}）`)
  assert.equal(calls, afterFirst, '第二次命中记忆，不再真跑')
  assert.equal(b.details[0].cached, true)
  assert.equal(a.details[0].cached, false)
})

test('n4 指纹失效：产物变了就重跑', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-fp-'))
  const judge = join(dir, 'judge.mjs')
  const artifact = join(dir, 'out.txt')
  writeFileSync(judge, 'export const x = 1\n')
  writeFileSync(artifact, 'payload\n')
  let calls = 0
  const run = async () => { calls++; return 'red' }
  const cmd = `cmd: node ${judge} ${artifact}`
  await falsifyBlock([cmd], { writeSet: [judge, artifact], cwd: dir, run })
  const n1 = calls
  writeFileSync(artifact, 'payload changed\n') // 指纹变
  await falsifyBlock([cmd], { writeSet: [judge, artifact], cwd: dir, run })
  assert.ok(calls > n1, `产物变化后必须重跑（${n1} → ${calls}）`)
})

test('n5 负对照超时封顶：control 分支超时更短', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nb-cap-'))
  const runner = judgeRunner(dir, { controlMs: 300 })
  const t0 = Date.now()
  const st = await runner('node -e "setTimeout(()=>{},5000)"', { control: true })
  const ms = Date.now() - t0
  assert.equal(st, 'broken', '超时=跑不了（不是红）')
  assert.ok(ms < 2000, `control 超时应封顶在 300ms 量级（实测 ${ms}ms）`)
})
