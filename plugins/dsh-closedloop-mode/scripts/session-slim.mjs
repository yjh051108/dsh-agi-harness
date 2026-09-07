/**
 * session-slim.mjs — 会话日志瘦身查看器（分析专用，只读）。
 *
 * 为什么需要：dsh-agent-loop 在每次 request/header 事件里存全量 system+工具 schema
 * （设计用于 fork/回放重建请求上下文；实例重建/工具变更时重录）。重度开发会话中
 * 可占日志 ~10%——分析会话时纯属噪音（本插件的注入是 user/message，不在此列）。
 *
 * 用法：node scripts/session-slim.mjs <session.jsonl[.zstd]> [--stats] [--grep 正则]
 *   默认输出：去掉 request/header/request/context 后的事件流摘要（类型+首行截断）。
 *   --stats：输出各事件类型行数与 request/header 字节占比。
 *   --grep：只在"非 header 事件"里搜正则（打印命中行截断）——防系统提示词刷屏。
 */
import { readFileSync, existsSync } from 'node:fs'
import z from 'node:zlib'

function readAny(p) {
  const buf = readFileSync(p)
  if (!p.endsWith('.zstd')) return buf.toString('utf8')
  const M = [0x28, 0xb5, 0x2f, 0xfd]
  const pos = []
  for (let i = 0; i + 4 <= buf.length; i++) if (buf[i] === M[0] && buf[i + 1] === M[1] && buf[i + 2] === M[2] && buf[i + 3] === M[3]) pos.push(i)
  const parts = []
  for (let k = 0; k < pos.length; k++) {
    const s = pos[k], e = k + 1 < pos.length ? pos[k + 1] : buf.length
    try { parts.push(z.zstdDecompressSync(buf.subarray(s, e))) } catch { }
  }
  return Buffer.concat(parts).toString('utf8')
}

const [path, ...flags] = process.argv.slice(2)
if (!path || !existsSync(path)) { console.error('用法: node session-slim.mjs <session.jsonl[.zstd]> [--stats|--grep 正则]'); process.exit(1) }
const lines = readAny(path).split('\n').filter(Boolean)
const SKIP = new Set(['request/header', 'request/context'])
const body = (o) => {
  const c = o?.data?.content
  if (Array.isArray(c)) return c.filter((x) => x?.type === 'text').map((x) => x.text).join(' ')
  if (typeof o?.data?.name === 'string') return o.data.name + ' ' + String(o.data.arguments || '').slice(0, 80)
  return JSON.stringify(o?.data ?? {}).slice(0, 100)
}

if (flags[0] === '--stats') {
  const types = {}; let hdrBytes = 0; let tot = 0
  for (const l of lines) {
    tot += l.length
    try { const o = JSON.parse(l); types[o.type] = (types[o.type] || 0) + 1; if (o.type === 'request/header') hdrBytes += l.length } catch { }
  }
  console.log('lines=', lines.length, '| header 字节占比=', Math.round(hdrBytes / tot * 100) + '%')
  console.log(Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => '  ' + t + ': ' + n).join('\n'))
  process.exit(0)
}

if (flags[0] === '--grep') {
  const re = new RegExp(flags[1] || '', 'i')
  let n = 0
  for (const l of lines) {
    try {
      const o = JSON.parse(l)
      if (SKIP.has(o.type)) continue
      const txt = body(o)
      if (re.test(txt)) { console.log(o.type + ' :: ' + txt.slice(0, 140)); if (++n > 40) break }
    } catch { }
  }
  process.exit(0)
}

for (const l of lines) {
  try {
    const o = JSON.parse(l)
    if (SKIP.has(o.type)) continue
    if (['user/message', 'assistant/message', 'tool/call', 'turn/start', 'turn/end'].includes(o.type)) {
      console.log(o.type + ' | ' + body(o).replace(/\n/g, ' ').slice(0, 120))
    }
  } catch { }
}
