#!/usr/bin/env node
/**
 * v04-metrics — 证伪四数采集（THEORY-v0.4 §9 证伪实验 / RESEARCH 附B）。
 * 用法：node scripts/v04-metrics.mjs <sid>   → 打印+落盘 ~/.dsh/graded-state/metrics-<sid8>.json
 *
 * 四指标（口径全机读，零模型自报）：
 *   1 protocolShare   协议 token 占比：PROTO 工具及其回执字节 / 转录总字节（fit-plant 口径延伸）
 *   2 humanInterventions 人工介入次数：真实 user 消息数（剔 plugin 源）
 *   3 fakeCompleteRate 假完成率：closed 动作中独立复核判坏占比（audit reject / 有审数；未抽检=null 诚实空位）
 *   4 stepsEfficiency  步数效率：closed 动作数 / 落账组数（+rollback 数=协议摩擦子读数，dip 借据同录）
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const sid = process.argv[2] || (process.env.DSH_SID ? String(process.env.DSH_SID) : null)
if (!sid) { console.error('用法: node scripts/v04-metrics.mjs <sid>'); process.exit(1) }
const S_DIR = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'sessions')
const G_DIR = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'graded-state') : path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'graded-state')
const PROTO = /^(optimal_|decompose|freeze$|cost_|terminal_check|revise_do|audit_record|cost_audit)/
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function findTranscript(s) {
  for (const w of ['--D-dsh--', '--dsh--']) for (const p of [`${w}/session-${s}`, `${w}/${s}`]) {
    const f = path.join(S_DIR, p, 'session.jsonl.zstd')
    if (fs.existsSync(f)) return f
  }
  return null
}
function loadLines(f) {
  const buf = fs.readFileSync(f)
  const parts = []
  for (let i = 0; i < buf.length; ) {
    const j = buf.indexOf(MAGIC, i + 4)
    const end = j === -1 ? buf.length : j
    try { parts.push(zlib.zstdDecompressSync(buf.subarray(i, end))) } catch { /* 残帧跳过 */ }
    i = end
  }
  return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)
}

// 转录两读数：协议占比 + 人工介入（一次遍历）
// 转录实况：tool call 住 assistant/message 的 content[].type=='tool-call'，回执住 user/message 的 tool_result/text 块——
// 按消息级归属：assistant 行含 PROTO tool-call → 该行字节全计（混排文本块=该动作的模型侧成本，同属协议）；
// 紧随的 user 行含 tool_result → 回执=协议产物，同计。真实 user 行=介入。
let protoBytes = 0, totalBytes = 0, humanMsgs = 0, lastWasProtoReceipt = false
const tFile = findTranscript(sid)
if (tFile) {
  for (const line of loadLines(tFile)) {
    totalBytes += Buffer.byteLength(line)
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (ev.type === 'assistant/message') {
      const calls = (ev.data?.message?.content || []).filter((b) => b?.type === 'tool-call').map((c) => String(c.name || ''))
      lastWasProtoReceipt = calls.length > 0 && calls.some((n) => PROTO.test(n))
      if (lastWasProtoReceipt) protoBytes += Buffer.byteLength(line)
    } else if (ev.type === 'user/message') {
      const kind = ev.data?.source?.kind
      if (kind === 'user') humanMsgs++ // 真人介入=带 source.kind==='user'（rpcId 在）
      else if (!kind || kind === 'tool') { // 无 source=harness 工具回执注入
        if (lastWasProtoReceipt) protoBytes += Buffer.byteLength(line)
      }
    }
  }
}
// 栈与盘档：动作账
const stackP = [path.join(G_DIR, `session-${sid}.optimal.json`), path.join(G_DIR, `${sid}.optimal.json`)].find((x) => fs.existsSync(x))
const stack = stackP ? JSON.parse(fs.readFileSync(stackP, 'utf8')) : { steps: [], rolledBack: [] }
const ledgerP = [path.join(G_DIR, `session-${sid}.closedloop.json`), path.join(G_DIR, `${sid}.closedloop.json`)].find((x) => fs.existsSync(x))
const ledger = ledgerP ? JSON.parse(fs.readFileSync(ledgerP, 'utf8')) : { closed: [], groups: [] }

const closedSteps = (stack.steps || []).filter((s) => s.status === 'closed')
const audited = (ledger.closed || []).filter((c) => c.audit && c.audit.last)
const reject = audited.filter((c) => c.audit.last.verdict === 'reject')
const settledGroups = (ledger.groups || []).filter((g) => g.settled).length
const metrics = {
  sid: String(sid).replace(/^session-/, '').slice(0, 8),
  at: Date.now(),
  transcriptFound: !!tFile,
  protocolShare: totalBytes > 0 ? Math.round((protoBytes / totalBytes) * 1000) / 1000 : null,
  humanInterventions: humanMsgs,
  fakeCompleteRate: audited.length ? Math.round((reject.length / audited.length) * 1000) / 1000 : null,
  auditedCount: audited.length,
  stepsEfficiency: { closedActions: closedSteps.length, settledGroups, perGroup: settledGroups > 0 ? Math.round((closedSteps.length / settledGroups) * 100) / 100 : null, rollbacks: (stack.rolledBack || []).length, dipSaturated: closedSteps.filter((s) => s.dv && s.dv.mode === 'dip-saturated').length },
}
fs.writeFileSync(path.join(G_DIR, `metrics-${metrics.sid}.json`), JSON.stringify(metrics, null, 2))
console.log(JSON.stringify(metrics))
