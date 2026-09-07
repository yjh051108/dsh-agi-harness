/**
 * self-audit.mjs — 分级会话体验审计（成本/摩擦量化，自优化闭环的"读表器"）。
 *
 * 用法：node scripts/self-audit.mjs <session.jsonl[.zstd]> [更多文件...]
 * 输出：每会话一段报告——工具调用分布、插件注入按类明细、收敛事件、
 *       真错误统计（isError 信封——防把被扫描日志文本当报错）、token 账本。
 */
import { readFileSync } from 'node:fs'
import z from 'node:zlib'

function readAny(p) {
  const buf = readFileSync(p)
  if (!p.endsWith('.zstd')) return buf.toString('utf8')
  const M = [0x28, 0xb5, 0x2f, 0xfd]
  const pos = []
  for (let i = 0; i + 4 <= buf.length; i++) if (buf[i] === M[0] && buf[i + 1] === M[1] && buf[i + 2] === M[2] && buf[i + 3] === M[3]) pos.push(i)
  const parts = []
  for (let k = 0; k < pos.length; k++) { try { parts.push(z.zstdDecompressSync(buf.subarray(pos[k], k + 1 < pos.length ? pos[k + 1] : buf.length))) } catch { } }
  return Buffer.concat(parts).toString('utf8')
}

const GRADED_TOOLS = ['commit_star', 'edit_plan', 'lock_stage', 'mark_task', 'redteam_verdict', 'revise_do', 'optimal_declare', 'optimal_converge', 'optimal_rollback', 'optimal_stack']

function classifyInjection(txt) {
  // 组开头条以（北极星 起头、正文含【新大类——先判正文归属（防 star-short 虚高）
  if (txt.slice(0, 400).includes('【新大类')) return 'group-open'
  if (txt.startsWith('【头脑风暴')) return 'brainstorm'
  if (txt.startsWith('【分级·第一步')) return 'phaseL1'
  if (txt.startsWith('【分级·第二步')) return 'phaseL2'
  if (txt.startsWith('【分级·第三步')) return 'approved'
  if (txt.startsWith('【审核】')) return 'review'
  if (txt.startsWith('（北极星·本组') && !txt.slice(0, 400).includes('【')) return 'star-short'
  if (txt.startsWith('【北极星·元认知】')) return 'star-long'
  if (txt.startsWith('【当前小类') || txt.startsWith('【当前块')) return 'focus'
  if (txt.startsWith('【新大类')) return 'group-open'
  if (txt.startsWith('【大类收官')) return 'group-check'
  if (txt.startsWith('【收尾')) return 'final'
  if (txt.startsWith('【分级·已按意见解锁')) return 'reject-ack'
  if (txt.startsWith('✅ 分级模式已关闭')) return 'off-receipt'
  if (txt.startsWith('【自动续轮已暂停')) return 'pause'
  return 'other'
}

function audit(path) {
  const lines = readAny(path).split('\n').filter(Boolean)
  const calls = {}, injByKind = {}, injMsgs = { n: 0, chars: 0 }
  let gateErrors = 0, errSamples = [], usage = { in: 0, out: 0, cache: 0 }, steps = 0, turns = 0
  let converges = 0, rollbacks = 0, declares = 0
  for (const l of lines) {
    let o; try { o = JSON.parse(l) } catch { continue }
    const t = o.type, d = o.data || {}
    if (t === 'step/start') steps++
    if (t === 'turn/start') turns++
    if (t === 'tool/call' && d.name) {
      calls[d.name] = (calls[d.name] || 0) + 1
      if (d.name === 'optimal_declare') declares++
      if (d.name === 'optimal_converge') converges++
      if (d.name === 'optimal_rollback') rollbacks++
    }
    if (t === 'tool/result') {
      const blocks = (d.message?.content || []).flatMap((x) => x?.type === 'tool-result' ? [x] : [])
      for (const b of blocks) {
        if (b.isError) {
          gateErrors++
          if (errSamples.length < 5) errSamples.push((b.content || []).map((x) => x.text || '').join(' ').slice(0, 110))
        }
      }
    }
    if (t === 'user/message' && d.source?.kind === 'plugin') {
      const txt = (d.content || []).map((x) => x?.text || '').join('')
      injMsgs.n++; injMsgs.chars += txt.length
      const kind = classifyInjection(txt)
      injByKind[kind] = injByKind[kind] || { n: 0, chars: 0 }
      injByKind[kind].n++; injByKind[kind].chars += txt.length
    }
    if (t === 'assistant/chunk' && d.chunk?.type === 'usage') {
      const u = d.chunk.usage
      usage.in += u.inputTokens || 0; usage.out += u.outputTokens || 0; usage.cache += u.cacheReadTokens || 0
    }
  }
  const gradedTotal = GRADED_TOOLS.reduce((a, k) => a + (calls[k] || 0), 0)
  return { file: path.split(/[\\/]/).slice(-2, -1)[0] || path, steps, turns, calls, gradedTotal, declares, converges, rollbacks, gateErrors, errSamples, inj: injMsgs, injByKind, usage }
}

const files = process.argv.slice(2)
if (!files.length) { console.error('用法: node self-audit.mjs <session.jsonl[.zstd]> [...]'); process.exit(1) }
for (const f of files) {
  const a = audit(f)
  console.log('\n════ 审计 ' + a.file + ' ════')
  console.log('turn=' + a.turns + ' step=' + a.steps + ' | 协议工具=' + a.gradedTotal + '（declare ' + a.declares + ' / converge ' + a.converges + ' / rollback ' + a.rollbacks + '）')
  console.log('插件注入=' + a.inj.n + ' 条 / ' + a.inj.chars + ' 字符（估 ' + Math.round(a.inj.chars / 2.2) + ' tok）')
  const kinds = Object.entries(a.injByKind).sort((x, y) => y[1].chars - x[1].chars)
  console.log('  注入明细: ' + kinds.map(([k, v]) => k + '×' + v.n + '(' + Math.round(v.chars / v.n) + '字/条)').join(', '))
  console.log('token 账本: 新输入=' + a.usage.in + ' 输出=' + a.usage.out + ' cache读=' + a.usage.cache + '（每步均值=' + Math.round(a.usage.cache / Math.max(1, a.steps)) + '）')
  console.log('真错误(isError)= ' + a.gateErrors + (a.errSamples.length ? '\n  · ' + a.errSamples.join('\n  · ') : ''))
  const top = Object.entries(a.calls).sort((x, y) => y[1] - x[1]).slice(0, 8)
  console.log('工具分布: ' + top.map(([k, v]) => k + ':' + v).join(', '))
}
