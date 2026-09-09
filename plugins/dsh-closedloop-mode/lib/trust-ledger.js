/**
 * trust-ledger — v0.8.37 偏差处置权还给模型 + 诚信留痕（开发者可见）。
 *
 * 语义变更（导演定向 2026-09-09）：
 *  - **偏差是观察，不是判决**：预测≠实测不再自动回炉；模型在 converge 时提交自己的处置
 *    （continue / turn / repair / stop + reason），处置权在模型，后果由后续事实检验。
 *  - **唯一的硬边界**：测量不可伪造、证据不可冒充、判据记录不可缺。
 *  - **诚信台账**：伪造证据 / 绕过 / 反复误判 → 落盘 graded-state/trust.jsonl，并在归零回执
 *    汇总提交开发者（信任是资产，破坏要留痕）。
 *
 * 纪律：纯函数 + 单一追加写（recordTrust）；时间由调用方传入。
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 模型可选的偏差处置（每步自评；引擎只记录，不代判） */
export const DISPOSITIONS = ['continue', 'turn', 'repair', 'stop']

/** 诚信事件类别：violation=伪造/冒充；evasion=试图绕过；misjudged=判断被后续事实推翻 */
export const TRUST_KINDS = ['violation', 'evasion', 'misjudged']

export function isDisposition(v) { return DISPOSITIONS.includes(String(v || '')) }

/** 处置一行（回执用；不写命令式文案） */
export function dispositionLine(deviationCount, disposition, reason) {
  if (!deviationCount) return ''
  const d = String(disposition || '')
  if (!isDisposition(d)) return `⚠ ${deviationCount} 处偏差待你处置（continue|turn|repair|stop + reason）`
  const tail = reason ? `｜${String(reason).slice(0, 80)}` : ''
  const map = {
    continue: '偏差已记录，继续推进（后果由后续事实检验）',
    turn: '偏差已记录，下一步拐弯吸收',
    repair: '偏差已记录，下一步修正（不回滚旧步）',
    stop: '偏差已记录，本单暂停待导演判断',
  }
  return `📝 偏差处置：${d}（${deviationCount} 处）——${map[d]}${tail}`
}

const dir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state')
export function trustFile() { return join(dir(), 'trust.jsonl') }

/** 记一笔诚信事件（追加写；失败静默不阻断主路）。 */
export function recordTrust({ sid = '', kind, detail = '', at = null, claimKey = '' } = {}) {
  const k = TRUST_KINDS.includes(String(kind)) ? String(kind) : 'misjudged'
  const rec = { at: at || Date.now(), sid: String(sid || ''), kind: k, claimKey: String(claimKey || ''), detail: String(detail || '').slice(0, 300) }
  try { mkdirSync(dir(), { recursive: true }); appendFileSync(trustFile(), JSON.stringify(rec) + '\n', 'utf8') } catch { /* 留痕失败不阻断 */ }
  return rec
}

export function readTrust(file) {
  const f = file || trustFile()
  if (!existsSync(f)) return []
  try { return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((x) => { try { return [JSON.parse(x)] } catch { return [] } }) } catch { return [] }
}

/** 归零回执用的一行汇总（无事件=空串，零注入）。 */
export function trustSummary({ sid = '', file } = {}) {
  const all = readTrust(file)
  if (!all.length) return ''
  const mine = sid ? all.filter((r) => !r.sid || r.sid === sid) : all
  if (!mine.length) return ''
  const by = {}
  for (const r of mine) by[r.kind] = (by[r.kind] || 0) + 1
  const parts = TRUST_KINDS.filter((k) => by[k]).map((k) => `${k}×${by[k]}`)
  const last = mine[mine.length - 1]
  return `🔎 诚信台账（开发者可见 · 落盘 ${trustFile()}）：${parts.join(' · ')}｜最近：${String(last.detail).slice(0, 80)}`
}
