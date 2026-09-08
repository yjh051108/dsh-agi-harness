#!/usr/bin/env node
/**
 * measure-intervene — 介入率活仪表（v0.8.27 双口径）。
 *
 * 分子分类（与旧脚本同口径，单一真相在 src/intervene.js）：转录帧 type==='user/message' 且
 * source.kind==='user' 且 source.rpcId 且非 source.goalId = 真人帧；goal 续单/plugin/agent-instructions 不计。
 * 分母：栈档 closed 步累计（带 24h 时窗切片，免「重开清零」骗分母）。
 * 两口径并列：rate（旧：窗口内真人帧÷闭合步）· rateOnDuty（新：只数落在未闭合步窗口内的真人帧÷闭合步）。
 * 产物：intervene-report.json（旧字段全保留 + onDuty* 新字段 + caveat 说明基线不可比）。
 *
 * 用法：node scripts/measure-intervene.mjs [输出路径]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import zlib from 'node:zlib'
import { classifyFrameSource, interveneMetrics } from '../src/intervene.js'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GS = join(HOME, 'graded-state')
const SESS = join(HOME, 'sessions')
const OUT = process.argv[2] || 'D:/dsh/harness-master-design/intervene-report.json'
const CUT24 = Date.now() - 24 * 36e5
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** zstd 多帧解码（DSH 转录按块拼接，每块独立 zstd 帧）。 */
function decode(f) {
  try {
    const b = readFileSync(f); const idxs = []; let i = 0
    while ((i = b.indexOf(MAGIC, i)) >= 0) { idxs.push(i); i += 4 }
    return idxs.map((s, k) => zlib.zstdDecompressSync(b.subarray(s, idxs[k + 1] || b.length)).toString('utf8')).join('\n')
  } catch { return null }
}
function findTranscript(sid) {
  try {
    for (const bk of readdirSync(SESS)) for (const cand of ['session-' + sid, sid]) {
      const f = join(SESS, bk, cand, 'session.jsonl.zstd')
      if (existsSync(f)) return f
    }
  } catch { /* 无 sessions 目录=无转录 */ }
  return null
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }

const rows = []
let tHum = 0, tOn = 0, tClosed = 0, tHum24 = 0, tOn24 = 0, tClosed24 = 0
for (const f of readdirSync(GS).filter((x) => x.endsWith('.closedloop.json'))) {
  const full = f.replace('.closedloop.json', '')
  const sid = full.replace(/^session-/, '')
  const cl = readJson(join(GS, f)) || {}
  let closed = (cl.closed || []).length
  const closedAt = {}
  for (const c of (cl.closed || [])) if (c && c.title && typeof c.at === 'number') closedAt[c.title] = c.at

  // 步（真分母来源：栈档）
  const st = readJson(join(GS, sid + '.optimal.json')) || readJson(join(GS, 'session-' + sid + '.optimal.json'))
  const steps = ((st && (st.steps || (st.stack && st.stack.steps))) || []).filter((x) => x && typeof x.at === 'number')
  const closedAll = steps.filter((x) => x.status === 'closed').length
  if (closedAll > closed) closed = closedAll

  // 真人帧
  const frames = []
  let auto = 0
  const tf = findTranscript(full) || findTranscript(sid)
  if (tf) {
    const text = decode(tf)
    if (text) for (const line of text.split('\n')) {
      if (!line.trim()) continue
      let k; try { k = JSON.parse(line) } catch { continue }
      if (k.type !== 'user/message') continue
      const kind = classifyFrameSource(k.data && k.data.source)
      if (kind === 'human') frames.push(k.time || 0)
      else if (kind !== 'other') auto++
    }
  }
  const all = interveneMetrics({ frames, steps, closedAt, cut: null })
  const m24 = interveneMetrics({ frames, steps, closedAt, cut: CUT24 })
  if (closed > 0) {
    rows.push({
      sid: sid.slice(0, 8), closed, human: all.humans, human24h: m24.humans, closed24h: m24.closed, auto,
      transcript: !!tf, rate: all.rate,
      // v0.8.27 新口径
      onDuty: all.humansOnDuty, onDuty24h: m24.humansOnDuty, rateOnDuty: all.rateOnDuty, onDutyShare24h: m24.onDutyShare,
    })
    tHum += all.humans; tOn += all.humansOnDuty; tClosed += closed
    tHum24 += m24.humans; tOn24 += m24.humansOnDuty; tClosed24 += m24.closed
  }
}
rows.sort((a, b) => b.closed - a.closed)
const div = (a, b) => (b > 0 ? +(a / b).toFixed(2) : null)
const report = {
  at: Date.now(),
  // 旧口径（面板消费字段，保留）
  totalHuman: tHum, totalClosed: tClosed, overallRate: div(tHum, tClosed),
  humans24h: tHum24, closed24h: tClosed24, rate24h: div(tHum24, tClosed24),
  // v0.8.27 新口径：在岗介入率
  totalOnDuty: tOn, onDutyOverallRate: div(tOn, tClosed),
  onDutyHumans24h: tOn24, onDutyRate24h: div(tOn24, tClosed24),
  n: rows.length, rows,
  caveat: '双口径（v0.8.27）：rate=窗口内真人帧÷闭合步（旧，含设计讨论/空档期对话）；rateOnDuty=只数落在「声明→闭合/下一步」窗口内的真人帧÷闭合步（在岗介入率，对应「人被迫下场救火」）。分子分类：kind=user+rpcId+非 goalId（goal 续单/plugin/agent-instructions 不计）。分母=栈档 closed 步累计。⚠ 基线 1.76 是旧口径，与新口径不可比。',
}
writeFileSync(OUT, JSON.stringify(report, null, 1))
console.log(`介入率（旧口径）：24h ${report.rate24h ?? '样本不足'} 人/闭合（真人${tHum24}÷闭合${tClosed24}）｜全史 ${report.overallRate}（基线 1.76·旧口径）`)
console.log(`在岗介入率（新）：24h ${report.onDutyRate24h ?? '样本不足'} 人/闭合（在岗帧${tOn24}÷闭合${tClosed24}）｜全史 ${report.onDutyOverallRate}`)
console.log(`账本 ${rows.length} 份｜本会话样例：` + rows.slice(0, 3).map((r) => `${r.sid} 闭${r.closed} 真人${r.human}（在岗${r.onDuty}）旧${r.rate} 新${r.rateOnDuty}`).join(' ｜ '))
