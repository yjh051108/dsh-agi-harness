// smoke — 插件形态冒烟：fake ctx 捕获裸 register → 直接 execute（真跑 Chrome）。
// 目标页用本地 file:// 临时页（零网络依赖）。用法：node smoke.mjs
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const entry = path.resolve(process.argv[2] || 'D:/dsh/02-web-ui/dsh-web-tools/lib/index.js')
const TITLE = 'dsh-web-tools smoke 页面'
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webtools-'))
const html = path.join(tmpDir, 'smoke.html')
fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>${TITLE}</title><h1>冒烟</h1><p id="k">value=42</p>`)
const target = pathToFileURL(html).href

console.log('t0 import', new Date().toISOString())
const mod = await import(pathToFileURL(entry).href)
console.log('t1 imported; WebSocket=', typeof WebSocket, '; exports=', Object.keys(mod).join(','))

const tools = {}
const cleanups = []
const ctx = {
  tools: {
    register: (t) => {
      if (!t.parameters || t.parameters.type !== 'object' || typeof t.parameters.properties !== 'object') {
        throw new Error('SCHEMA INVALID(parameters) for ' + t.name + ': ' + JSON.stringify(t.parameters))
      }
      if (!t.output || !t.output.schema || t.output.schema.type !== 'object') throw new Error('SCHEMA INVALID(output) for ' + t.name)
      tools[t.name] = t; return t
    },
  },
  effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return d },
  get: () => undefined,
  on: () => {},
  provide: () => {},
}
mod.apply(ctx, { port: 0 })
console.log('t2 apply; tools:', Object.keys(tools).join(','))

const R = []
async function T(name, fn) {
  console.log('t3 start', name, new Date().toISOString())
  try { const r = await fn(); R.push('PASS ' + name + (r !== undefined ? ' :: ' + r : '')) }
  catch (e) { R.push('FAIL ' + name + ' :: ' + e.message) }
  console.log('t3 end  ', name)
}

await T('web_status 对象契约', async () => {
  const r = await tools.web_status.execute({})
  if (typeof r !== 'object' || r === null) throw new Error('not an object: ' + JSON.stringify(r))
  if (r.ok !== true) throw new Error('ok!=true: ' + JSON.stringify(r))
  return JSON.stringify(r).slice(0, 110)
})

await T('web_dom 对象契约 + render（本地页标题）', async () => {
  const r = await tools.web_dom.execute({ url: target, maxChars: 400 })
  if (typeof r !== 'object' || r.ok !== true || !r.title) throw new Error('bad shape: ' + JSON.stringify(r))
  if (!String(r.title).includes(TITLE)) throw new Error('title mismatch: ' + r.title)
  const rendered = tools.web_dom.output.render({}, r)
  if (!Array.isArray(rendered) || !String(rendered[0]?.text || '').includes(r.title)) throw new Error('render failed')
  return 'ok title=' + r.title.slice(0, 30)
})

await T('web_shot 对象契约 + 文件落盘', async () => {
  const out = path.join(tmpDir, 'shot.png')
  const r = await tools.web_shot.execute({ url: target, outPath: out, waitMs: 600 })
  if (typeof r !== 'object' || r.ok !== true || !r.path) throw new Error('bad shape: ' + JSON.stringify(r))
  if (!fs.existsSync(out)) throw new Error('png missing')
  const st = fs.statSync(out)
  if (st.size < 1000) throw new Error('png too small: ' + st.size)
  return 'ok bytes=' + st.size + ' title=' + String(r.title || '').slice(0, 30)
})

console.log(R.join('\n'))
console.log(R.some((x) => x.startsWith('FAIL')) ? 'SMOKE-FAIL' : 'SMOKE-OK')
for (const c of cleanups.reverse()) { try { c() } catch { } }
try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { }
console.log('cleanup done')
