/**
 * browser-tools — 预设内在化的浏览器能力（非插件、非特化）。
 *
 * 定调（用户，2026-08-30）：浏览器是通用 I/O 器件——眼睛（截图/渲染验证）、
 * 画布（任何页面渲染）、交互器件（点击/输入，后续扩展）；几乎任何东西都能被
 * 浏览器容纳操控，因此它作为预设条件装配的一部分常驻，而不是一个注入式特化插件。
 *
 * 能力（工具随环境段声明常开）：
 *   web_status  — 运行时与浏览器就绪状态
 *   web_shot    — 导航 + 等待 + 截图 → PNG 文件（read_image 直读）
 *   web_dom     — 导航 + 回读标题与页面文本（断言回读，替代 dump-dom）
 *
 * 实现（零 npm 依赖、零第三方 import——与 router-bootstrap 同路数）：
 *   · 复用系统 Chrome（配置可改），单实例常驻，preset 卸载时杀进程
 *   · CDP over Node 22 全局 WebSocket（仅 node: 内建）
 *   · page 目标懒创建；链接后 Page.enable/Runtime.enable 一次
 *   · 沙箱约束：profile 目录显式（DSH_HOME 下），地址 127.0.0.1
 *
 * 进化路径：交互（点击/输入）与多页管理按需加在下方工具区；
 * 若上游 anweat/dsh-browser（21 工具 Playwright 套件）在 DSH rc.2 + 包管理恢复后
 * 可用，则本模块是它的轻量子集，运行时二选一即可。
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'

export const name = 'browser-tools'
export const inject = ['tools']

const DEFAULTS = {
  port: 9339,
  chromePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  // v0.1.1：注释说「profile 目录显式（DSH_HOME 下）」但实现只用了 homedir()——宿主以 Administrator 跑时
  // 会落到 C:\Users\Administrator\.dsh（实测冒烟），与 DSH_HOME 不一致。改为优先 DSH_HOME。
  profileDir: path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.web-shot-profile'),
  width: 1280,
  height: 720,
  // v0.1.2 释放纪律（用户定向：「千万不要出现多后台忘了清后台防止爆炸内存」）：
  // 空闲 idleMs 后自动释放 Chrome（0=永不自动释放，纯常驻）。重建约 1–2s，远小于泄漏代价。
  idleMs: 10 * 60 * 1000,
}

function toolOutput() {
  return {
    schema: { type: 'object' },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
  }
}

export function apply(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) }
  let child = null
  let conn = null
  let pageWsUrl = null
  let wsObj = null
  let port = cfg.port
  let idleTimer = null
  let inflight = 0

  const log = (...a) => console.log('[browser-tools]', ...a)

  /** 统一释放（v0.1.2 单一出口）：关 WS → 杀 child → 杀同 profile 残留 → 清状态。
   *  四条触发路径共用它：卸载 / 空闲超时 / 宿主退出 / 多实例回收。 */
  function release(why) {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    try { wsObj && wsObj.close() } catch { }
    try { if (child && !child.killed) child.kill() } catch { }
    killProfileChrome()
    conn = null; child = null; pageWsUrl = null; wsObj = null
    if (why) log('release:', why)
  }

  /** 空闲计时（可配；0=关闭）。unref 不阻止宿主退出。 */
  function armIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    if (!(cfg.idleMs > 0)) return
    idleTimer = setTimeout(() => { if (inflight === 0) release('idle ' + Math.round(cfg.idleMs / 1000) + 's') }, cfg.idleMs)
    if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref()
  }

  /** 工具执行包壳：计时暂停 → 执行 → 重新计时（空闲只在真没人用时才释放）。 */
  async function withBrowser(fn) {
    inflight++
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
    try { return await fn() } finally { inflight--; armIdle() }
  }

  // 宿主退出（含正常退出/未捕获退出）同步杀——防孤儿 Chrome 常驻吃内存。
  // 只挂 'exit'（不挂 SIGINT/SIGTERM：那会顶掉宿主自己的终止语义）。
  const onHostExit = () => { try { killProfileChrome() } catch { } }
  process.once('exit', onHostExit)

  /* v0.5（用户定调）：单例常驻不重复 + 多例有提醒。
   *  ① 实例不主动回收（常驻）——CPU 安全靠「摘页」：每次调用后导航回 about:blank，
   *     空页零渲染 → 常驻也 ≈0% CPU（不再需要 90s 杀——那是"重复生"的来源）；
   *  ② spawn 前 killProfileChrome（单例保障——残留旧例先清）；
   *  ③ 每次调用探测同 profile 的 chrome 进程数，>1 时返回 multi 提醒。 */
  async function disarmPage() {
    try { await cdp('Page.navigate', { url: 'about:blank' }) } catch { }
  }
  function detectInstances() {
    try {
      // v0.1.2：只数**主进程**。两个坑：
      //  ① 旧实现把 renderer/gpu 子进程一起数（单个 Chrome≈10 进程）→「多例提醒」永远误报、回收误杀；
      //  ② `-notmatch '--type='` 经 Node→powershell 传参会被参数解析吞掉（实测 out 为空、exit 0）——
      //     故 PowerShell 只负责**取命令行**，过滤放到 JS 里做（零引号依赖）。
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object -ExpandProperty CommandLine`],
        { encoding: 'utf8', timeout: 8000 })
      const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean)
      return lines.filter((l) => l.includes(cfg.profileDir) && !l.includes('--type=')).length
    } catch { return 0 }
  }

  function findFreePort() {
    return new Promise((resolve) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const p = srv.address().port
        srv.close(() => resolve(p))
      })
    })
  }

  function httpGetJson(url) {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let d = ''
        res.on('data', (c) => (d += c))
        res.on('end', () => {
          try { resolve(JSON.parse(d)) } catch (e) { reject(e) }
        })
      }).on('error', reject).setTimeout(5000, function () { this.destroy(); reject(new Error('http timeout ' + url)) })
    })
  }

  /* 杀干净本 profile 的 chrome（含子进程）+ 清 profile 锁文件——spawn 前必须，
   * 否则残留进程与 Singleton 锁导致新实例 ECONNREFUSED（2026-08-30 实测 8 进程残留）。 */
  function killProfileChrome() {
    try {
      const esc = String(cfg.profileDir).replace(/\\/g, '\\\\')
      spawnSync('powershell.exe', ['-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${esc}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        { stdio: 'ignore', timeout: 15000 })
    } catch { }
    for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
      try { rmSync(path.join(cfg.profileDir, f), { force: true }) } catch { }
    }
  }

  async function ensureBrowser() {
    // 多实例自动回收（v0.1.2）：不只提醒——发现同 profile 多个 chrome 就杀干净单例重建。
    if (detectInstances() > 1) { log('reap extra instances'); release('reap') }
    if (!child || child.killed) {
      killProfileChrome()
      port = cfg.port || (await findFreePort())
      mkdirSync(cfg.profileDir, { recursive: true })
      child = spawn(cfg.chromePath, [
        '--headless', '--no-sandbox', '--disable-gpu',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--remote-debugging-port=' + port, '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + cfg.profileDir,
        '--window-size=' + cfg.width + ',' + cfg.height,
        'about:blank',
      ], { stdio: 'ignore' })
      child.on('error', (e) => log('chrome spawn error', e.message))
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 300))
        try {
          const v = await httpGetJson(`http://127.0.0.1:${port}/json/version`)
          if (v.webSocketDebuggerUrl) break
        } catch { /* retry */ }
      }
    }
    if (!pageWsUrl) {
      const list = await httpGetJson(`http://127.0.0.1:${port}/json/list`)
      const page = list.find((t) => t.type === 'page')
      if (page) pageWsUrl = page.webSocketDebuggerUrl
      else {
        pageWsUrl = await new Promise((resolve, reject) => {
          const req = http.request({ host: '127.0.0.1', port, path: '/json/new?about:blank', method: 'PUT' }, (res) => {
            let d = ''
            res.on('data', (c) => (d += c))
            res.on('end', () => { try { resolve(JSON.parse(d).webSocketDebuggerUrl) } catch (e) { reject(e) } })
          })
          req.on('error', reject); req.end()
        })
      }
    }
    return pageWsUrl
  }

  function connectOnce(url) {
    return new Promise((resolve, reject) => {
      if (conn && conn.ws.readyState === 1) return resolve()
      const ws = new WebSocket(url)
      wsObj = ws
      const c = { ws, seq: 0, pending: new Map() }
      conn = c
      ws.onopen = async () => {
        try {
          await cdp('Page.enable')
          await cdp('Runtime.enable')
          resolve()
        } catch (e) { reject(e) }
      }
      ws.onmessage = (ev) => {
        let m
        try { m = JSON.parse(String(ev.data)) } catch { return }
        if (m.id && c.pending.has(m.id)) {
          const { resolve: r, reject: j } = c.pending.get(m.id)
          c.pending.delete(m.id)
          if (m.error) j(new Error('CDP ' + m.error.code + ': ' + m.error.message))
          else r(m.result)
        }
      }
      ws.onerror = () => reject(new Error('ws error'))
      ws.onclose = () => { conn = null; pageWsUrl = null }
    })
  }

  function cdp(method, params) {
    const c = conn
    const id = ++c.seq
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { c.pending.delete(id); reject(new Error('CDP timeout: ' + method)) }, 20000)
      c.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v) },
        reject: (e) => { clearTimeout(t); reject(e) },
      })
      c.ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }

  async function nav(url, waitMs) {
    await ensureBrowser()
    await connectOnce(pageWsUrl)
    await cdp('Page.navigate', { url })
    await new Promise((r) => setTimeout(r, Math.max(400, waitMs || 900)))
  }

  async function extract() {
    const r = await cdp('Runtime.evaluate', {
      expression: 'JSON.stringify({title: document.title, url: location.href, text: document.body ? document.body.innerText : ""})',
      returnByValue: true,
    })
    try { return JSON.parse(r.result.value) } catch { return { title: '', text: '', url: '' } }
  }

  /* ── 卸载清理 ─────────────────────────────────────────── */
  ctx.effect(() => () => {
    try { process.removeListener('exit', onHostExit) } catch { }
    release('unload')
  }, 'browser-tools: cleanup')

  /* ── web_status ───────────────────────────────────────── */
  ctx.effect(() => ctx.tools.register({
    name: 'web_status',
    description: '浏览器验证运行时状态：chrome 就绪性/端口/复用实例。载入后调用一次。',
    parameters: { type: 'object', properties: {} },
    output: toolOutput(),
    async execute() {
      return withBrowser(async () => {
      try {
        await ensureBrowser()
        const v = await httpGetJson(`http://127.0.0.1:${port}/json/version`)
        const inst = detectInstances()
        return {
          ok: true, chrome: v.Browser, port, page: pageWsUrl ? 'ready' : 'lazy',
          profile: cfg.profileDir, instances: inst, idleMs: cfg.idleMs,
          resident: '空闲 ' + Math.round((cfg.idleMs || 0) / 1000) + 's 后自动释放（idleMs=0 可关闭）',
          ...(inst > 1 ? { multi: '多例提醒：检测到 ' + inst + ' 个同 profile chrome 进程——设计为单例常驻；残留旧例请重启或清理后再用' } : {}),
        }
      } catch (e) {
        return { ok: false, error: e.message }
      }
      })
    },
  }), 'web_status')

  /* ── web_shot ─────────────────────────────────────────── */
  ctx.effect(() => ctx.tools.register({
    name: 'web_shot',
    description: '打开 URL 并截图（PNG 落盘）。返回图片路径与页面标题——用 read_image 看画面。用于渲染/视觉验证。',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: 'http(s) 或 file:// URL' },
      waitMs: { type: 'number', description: '导航后等待毫秒（默认 1200，懒加载页面适当加大）' },
      outPath: { type: 'string', description: '保存路径（工作区内，默认 ./web-shot/<时间戳>.png）' },
    }, required: ['url'] },
    output: toolOutput(),
    async execute(args) {
      const url = String(args.url)
      if (!/^(https?|file):/i.test(url)) return { ok: false, error: 'url must be http(s) or file://' }
      return withBrowser(async () => {
      try {
        await nav(url, args.waitMs ?? 1200)
        const { title } = await extract()
        const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true })
        const buf = Buffer.from(shot.data, 'base64')
        const out = path.resolve(args.outPath || path.join(process.cwd(), 'web-shot', 'shot-' + Date.now() + '.png'))
        mkdirSync(path.dirname(out), { recursive: true })
        writeFileSync(out, buf)
        /* v0.5：摘页（常驻 0% CPU）+ 多例提醒 */
        await disarmPage()
        const inst = detectInstances()
        return {
          ok: true, bytes: buf.length, path: out, title: title.slice(0, 80), instances: inst,
          ...(inst > 1 ? { multi: '多例提醒：检测到 ' + inst + ' 个同 profile chrome 进程——设计为单例常驻；残留旧例请重启或清理后再用' } : {}),
        }
      } catch (e) {
                return { ok: false, error: e.message }
      }
      })
    },
  }), 'web_shot')

  /* ── web_dom ──────────────────────────────────────────── */
  ctx.effect(() => ctx.tools.register({
    name: 'web_dom',
    description: '打开 URL 并回读标题与页面可读文本（截断到 maxChars）。替代 dump-dom 的断言回读；页面可自行把测试结果写进 DOM 文本。',
    parameters: { type: 'object', properties: {
      url: { type: 'string', description: 'http(s) 或 file:// URL' },
      waitMs: { type: 'number', description: '等待毫秒（默认 1200）' },
      maxChars: { type: 'number', description: '文本截断上限（默认 8000）' },
    }, required: ['url'] },
    output: toolOutput(),
    async execute(args) {
      const url = String(args.url)
      if (!/^(https?|file):/i.test(url)) return { ok: false, error: 'url must be http(s) or file://' }
      return withBrowser(async () => {
      try {
        await nav(url, args.waitMs ?? 1200)
        const { title, text, url: finalUrl } = await extract()
        const max = Math.max(400, args.maxChars ?? 8000)
        const body = (text || '').slice(0, max)
        const truncated = (text || '').length > max
        await disarmPage()
        const inst = detectInstances()
        return {
          ok: true, title: title.slice(0, 120), url: finalUrl, body, truncated, instances: inst,
          ...(inst > 1 ? { multi: '多例提醒：检测到 ' + inst + ' 个同 profile chrome 进程——设计为单例常驻；残留旧例请重启或清理后再用' } : {}),
        }
      } catch (e) {
                return { ok: false, error: e.message }
      }
      })
    },
  }), 'web_dom')
}
