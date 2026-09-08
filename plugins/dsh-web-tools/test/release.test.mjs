// release.test — 浏览器进程释放纪律真机回归（v0.1.2）。
// 用法：node test/release.test.mjs   （需要系统 Chrome；退出码 0=全过）
// 覆盖：① 卸载清 ② 空闲超时自动释放 ③ 多实例自动回收 + 重建单例
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const ENTRY = path.join(ROOT, 'lib', 'index.js')
const PROFILE = path.join(os.tmpdir(), 'webtools-release-test-profile')

const chromeCount = () => {
  try {
    // 只数主进程；过滤在 JS 里做（PowerShell 传参吞 `-notmatch '--type='`，实测空输出）
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object -ExpandProperty CommandLine`],
      { encoding: 'utf8', timeout: 15000 })
    const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean)
    return lines.filter((l) => l.includes(PROFILE) && !l.includes('--type=')).length
  } catch { return -1 }
}
const waitFor = async (fn, ms = 8000, step = 300) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)) }
  return fn()
}
const results = []
const T = async (name, fn) => {
  try { const r = await fn(); results.push('PASS ' + name + (r ? ' :: ' + r : '')) }
  catch (e) { results.push('FAIL ' + name + ' :: ' + e.message) }
}

const boot = async (config) => {
  const tools = {}
  const cleanups = []
  const ctx = {
    tools: { register: (t) => { tools[t.name] = t; return t } },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return d },
    get: () => undefined, on: () => {}, provide: () => {},
  }
  const mod = await import(pathToFileURL(ENTRY).href + '?t=' + Date.now())
  mod.apply(ctx, { profileDir: PROFILE, idleMs: 0, ...config })
  return { tools, cleanup: () => { for (const c of cleanups.reverse()) { try { c() } catch { } } } }
}

// 清理可能的历史残留
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${PROFILE.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })

let A = null
await T('启动一次浏览器（web_status）', async () => {
  A = await boot({ idleMs: 0 })
  const r = await A.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  const n = chromeCount()
  if (n < 1) throw new Error('chrome 未起来 count=' + n)
  return 'chrome=' + r.chrome + ' instances=' + n
})

await T('① 卸载清：cleanup 后同 profile chrome 归 0', async () => {
  A.cleanup()
  const n = await waitFor(() => (chromeCount() === 0 ? 1 : 0), 8000)
  if (n !== 1) throw new Error('残留 count=' + chromeCount())
  return 'count=0'
})

await T('② 空闲超时自动释放（idleMs=1500）', async () => {
  const B = await boot({ idleMs: 1500 })
  const r = await B.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  if (chromeCount() < 1) throw new Error('chrome 未起来')
  const ok = await waitFor(() => (chromeCount() === 0 ? 1 : 0), 9000)
  if (!ok) throw new Error('空闲未释放 count=' + chromeCount())
  B.cleanup()
  return 'idle 释放后 count=0'
})

await T('③ 多实例回收 + 重建单例', async () => {
  const C = await boot({ idleMs: 0 })
  await C.tools.web_status.execute({})
  // 人为再起一个同 profile 的 chrome（模拟泄漏的旧例）
  const { spawn } = await import('node:child_process')
  const extra = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless', '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + PROFILE + '-extra', 'about:blank'],
    { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1500))
  const before = chromeCount()
  const r = await C.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  const after = r.instances
  try { extra.kill() } catch { }
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${(PROFILE + '-extra').replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })
  if (after !== 1) throw new Error('多实例未回收：before=' + before + ' after=' + after)
  C.cleanup()
  return 'before=' + before + ' → after=1（单例）'
})

// 收尾
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${PROFILE.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })
try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { }
try { fs.rmSync(PROFILE + '-extra', { recursive: true, force: true }) } catch { }

console.log(results.join('\n'))
const failed = results.filter((x) => x.startsWith('FAIL'))
console.log(failed.length ? 'RELEASE-TEST-FAIL=' + failed.length : 'RELEASE-TEST-OK')
process.exit(failed.length ? 1 : 0)
