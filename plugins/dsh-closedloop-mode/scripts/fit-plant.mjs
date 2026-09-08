#!/usr/bin/env node
/**
 * fit-plant — 量尺（v0.3 转正件，源出 gh-triage-work 探针；#22 修复提取路径）。
 *
 * 用法：
 *   node scripts/fit-plant.mjs <sid>            单会话读数（JSON 行）
 *   node scripts/fit-plant.mjs --check          常量对照：死会话逐值 / live 会话单调 / 回滚史互式 / 篡改自测
 *   node scripts/fit-plant.mjs --check --tamper 注入假常量，必报红且指名该项（裁判自测的反面）
 *
 * 测量学纪律（观测量自指禁令的测量器版）：
 *   - 死会话（转录不可变）逐值断言；live 会话只断单调（≥基线+现值报数）——本工具自身运行于被测系统内，
 *     钉演进量字面值=伪精确；
 *   - rolledBack 读栈文件**顶层数组长度**；discrepancies = step.discrepancies(在栈) + rolledBack[].diffs(史)。
 *     前版读 step.converge.* 致两栈全 0 的缺陷已按实况修正。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const S_DIR = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'sessions') : path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'sessions')
const G_DIR = process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'graded-state') : path.join(process.env.HOME || process.env.USERPROFILE || '', '.dsh', 'graded-state')
const PROTO = /^(optimal_|decompose|freeze$|cost_|terminal_check|revise_do|audit_record)/
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function sessionRoot(sid) {
  const ws = ['--D-dsh--', '--dsh--']
  for (const w of ws) for (const p of [`${w}/session-${sid}`, `${w}/${sid}`]) {
    const f = path.join(S_DIR, p, 'session.jsonl.zstd')
    if (fs.existsSync(f)) return f
  }
  throw new Error(`转录不存在: ${sid}`)
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
const stackOf = (sid) => {
  const p = [`${G_DIR}/${sid}.optimal.json`, `${G_DIR}/session-${sid}.optimal.json`].find((x) => fs.existsSync(x))
  return p ? JSON.parse(fs.readFileSync(p, 'utf8')) : { steps: [], rolledBack: [] }
}

export function metrics(sid) {
  const lines = loadLines(sessionRoot(sid))
  const m = { protoCalls: 0, protoWriteKB: 0, injKB: 0, injFrames: 0, thinkKB: 0, readKB: 0, workKB: 0, steps: 0, turns: 0, compactionEnd: 0, t0: Infinity, t1: -Infinity }
  const callName = {}
  const stepSet = new Set()
  for (const ln of lines) {
    if (!ln.includes('"type":')) continue
    let e
    try { e = JSON.parse(ln) } catch { continue }
    const tm = e.time ?? e.time0
    if (typeof tm === 'number') { if (tm < m.t0) m.t0 = tm; if (tm > m.t1) m.t1 = tm }
    if (e.type === 'tool/call') {
      callName[e.data.callId] = e.data.name
      stepSet.add(`${e.data.turn}/${e.data.step}`)
      if (e.data.turn > m.turns) m.turns = e.data.turn
    } else if (e.type === 'compaction/end') m.compactionEnd++
    else if (e.type === 'assistant/message') {
      for (const b of e.data?.message?.content || []) {
        if (b.type === 'reasoning') m.thinkKB += (b.text || '').length / 1024
        else if (b.type === 'tool-call' && PROTO.test(b.name || '')) { m.protoCalls++; m.protoWriteKB += (b.arguments || '').length / 1024 }
      }
    } else if (e.type === 'tool/result') {
      const msg = e.data?.message || {}
      const nm = callName[msg.source?.callId] || ''
      let s = 0
      for (const c of msg.content || []) if (c.type === 'tool-result') s += JSON.stringify(c.content || '').length
      if (!PROTO.test(nm)) { if (nm === 'read') m.readKB += s / 1024; else m.workKB += s / 1024 }
    } else if (e.type === 'user/message') {
      const mm = e.data?.message || e.data
      const txt = typeof mm?.content === 'string' ? mm.content : JSON.stringify(mm?.content || '')
      if (/【(闭环|最优律|代价|分解|冻结|滚动|审核|组|终端|接线|测面|量尺|换代|面板|快环)|你的岗位|写闸/.test(txt)) { m.injKB += txt.length / 1024; m.injFrames++ }
    }
  }
  const st = stackOf(sid)
  const steps = st.steps || []
  m.stackSteps = steps.length
  m.closed = steps.filter((x) => x.status === 'closed').length
  m.rolledBack = (st.rolledBack || []).length
  m.discrepancies = steps.reduce((a, x) => a + (x.discrepancies || []).length, 0) + (st.rolledBack || []).reduce((a, r) => a + (r.diffs || []).length, 0)
  m.wallMin = Math.round((m.t1 - m.t0) / 60000)
  const r2 = (x) => Math.round(x * 10) / 10
  return {
    wall_min: m.wallMin, turns: m.turns + 1, step_keys: stepSet.size, compaction_end: m.compactionEnd,
    proto_calls: m.protoCalls, proto_write_kb: r2(m.protoWriteKB), inj_kb: r2(m.injKB), inj_frames: m.injFrames,
    think_kb: r2(m.thinkKB), read_kb: r2(m.readKB), work_res_kb: r2(m.workKB),
    stack_steps: m.stackSteps, closed: m.closed, rolled_back: m.rolledBack, discrepancies: m.discrepancies,
  }
}

/* 常量表：死会话转录不可变。**口径变更史（v1→v2，本会话 rolledBack 史在案）**：
   v1 分类子漏计【最优律·写闸】类引导帧（P 场 inj_kb=11.7 系漏计非真值，且对 v0.3 新表头未来向失效）；
   v2=旧表头∪写闸/闭环表头，语义完整覆盖「插件推给模型的引导驻留量」。docs/FIT-plant.md v1 原行不改，
   重标定值在换代块追加行并注两代差异——预测禁改指活预测表，度量修正走回滚史。 */
const DEAD = {
  '4e0ae1fd-5d01-48bb-bdfd-cee5136938b3': { wall_min: 21, turns: 3, step_keys: 90, compaction_end: 0, proto_calls: 15, proto_write_kb: 19.3, inj_kb: 14.9, inj_frames: 13, think_kb: 153, read_kb: 40, work_res_kb: 36, closed: 3 },
}
/* live 会话（本工具运行于其内，演进量只断单调）：基线=FIT-plant.md 记录行快照 */
const LIVE = {
  'session-b74630b0-c63f-4ce5-8a96-daac4de47c99': { wall_min: 1716, proto_calls: 53, proto_write_kb: 51, inj_kb: 72, compaction_end: 152, read_kb: 445 },
}

export function runCheck({ tamper = false } = {}) {
  const out = []
  let red = 0
  const consts = structuredClone(DEAD)
  if (tamper) consts['4e0ae1fd-5d01-48bb-bdfd-cee5136938b3'].wall_min = 999
  for (const [sid, table] of Object.entries(consts)) {
    const mm = metrics(sid)
    for (const [k, v] of Object.entries(table)) {
      const ok = Math.abs(mm[k] - v) < 0.61 // 常量行为前轮 toFixed 快照——±0.6KB 为舍入带非模糊容差
      if (!ok) red++
      out.push(`${ok ? '绿' : '红'} 死会话逐值 ${sid.slice(0, 8)}.${k}: 常量 ${v} vs 现测 ${mm[k]}`)
    }
    const st = stackOf(sid)
    const rbOk = mm.rolled_back === (st.rolledBack || []).length
    out.push(`${rbOk ? '绿' : '红'} 回滚史互式 ${sid.slice(0, 8)}: 提取 ${mm.rolled_back} == 文件现读 ${(st.rolledBack || []).length}（非零=${mm.rolled_back > 0}）`)
    if (!rbOk) red++
  }
  for (const [sid, base] of Object.entries(LIVE)) {
    const mm = metrics(sid)
    for (const [k, v] of Object.entries(base)) {
      const ok = mm[k] >= v
      if (!ok) red++
      out.push(`${ok ? '绿' : '红'} live 单调 ${sid.slice(8, 16)}.${k}: 基线 ${v} ≤ 现测 ${mm[k]}`)
    }
    const st = stackOf(sid)
    out.push(`live 回滚史现读: rolled_back=${mm.rolled_back}（文件 ${(st.rolledBack || []).length}） discrepancies=${mm.discrepancies}（step 在栈+rb.diffs 合式）`)
    if (!(mm.rolled_back === (st.rolledBack || []).length && mm.rolled_back > 0)) red++
  }
  out.push(red === 0 ? `\n== 全绿（${out.length} 项）==` : `\n== ${red} 项红（${out.length} 项中）==`)
  return { red, lines: out }
}

if (process.argv[1] && process.argv[1].endsWith('fit-plant.mjs')) {
  const sid = process.argv[2]
  if (sid === '--check') {
    const { red, lines } = runCheck({ tamper: process.argv.includes('--tamper') })
    console.log(lines.join('\n'))
    process.exit(red ? 1 : 0)
  } else if (sid) {
    console.log(JSON.stringify(metrics(sid)))
  } else {
    console.log('用法: fit-plant <sid> | --check [--tamper]')
  }
}
