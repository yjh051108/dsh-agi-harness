/**
 * friction-organ — v0.6.35 摩擦账本（P3 家族治本：隐形税第一次可测量——导演授权决策）。
 * 记录：每次闸拒（写闸/声明/收敛/探针）原子追加 {at, gate, head}；终检/面板读数=计数分布。
 * 数据：graded-state/<sid>.friction.jsonl（只追加）；纯函数+磁盘，可单测。
 * 边界（诚实）：不是真相（拒后绕路序列的完整因果不在账内——那靠 symbiote 侧统计），
 * 但它是「模型为协议付了多少次代价」的一手读数。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs'

const gradedStateDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state')
const fileFor = (sid, dir) => join(dir || gradedStateDir(), String(sid || 'unknown') + '.friction.jsonl')

const GATES = ['write-gate', 'declare', 'converge', 'probe', 'other']

/** 记一笔（只追加；单次失败静默——录音不能打断干活）。 */
export function noteFriction(sid, gate, head = '', dir) {
  try {
    const d = dir || gradedStateDir()
    mkdirSync(d, { recursive: true })
    const rec = { at: Date.now(), gate: GATES.includes(gate) ? gate : 'other', head: String(head || '').slice(0, 80), sid: String(sid || '') }
    appendFileSync(fileFor(sid, d), JSON.stringify(rec) + '\n', 'utf8')
    return rec
  } catch { return null }
}

/** 读摩擦账（无=[]）→ 按闸分布计数。 */
export function frictionSummary(sid, dir) {
  const d = dir || gradedStateDir()
  const f = fileFor(sid, d)
  if (!existsSync(f)) return { total: 0, byGate: {} }
  const byGate = {}
  let total = 0
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        byGate[r.gate] = (byGate[r.gate] || 0) + 1
        total++
      } catch { /* 坏行跳过 */ }
    }
  } catch { /* 不可读=空账 */ }
  return { total, byGate }
}

/** 终检行（人话版）：摩擦账实况一行。 */
export function frictionLine(sid, dir) {
  const s = frictionSummary(sid, dir)
  if (!s.total) return ''
  const dist = Object.entries(s.byGate).map(([g, n]) => `${g}×${n}`).join('·')
  return `🧱 摩擦账本：本会话被拒 ${s.total} 次（${dist}）——每笔都在 ${String(sid || '').slice(-8)}.friction.jsonl`
}
