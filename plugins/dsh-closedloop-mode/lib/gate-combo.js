/**
 * gate-combo — v0.7.4 Phase 8+9：闸间组合效果学习 + 健康门升降（架构 §4.2/§6.4；仿真 H6 证互斥预算下多闸竞争稳定）。
 *
 * Phase8（学组合）：记「哪些闸同一拍一起活跃」与步结果（闭合/回炉）的关联——组合权重从数据来，非人设计。
 * Phase9（升降级）：comboWeight 低=历史常致回炉→建议少同时注入（不删只降频）；数据不足→null（诚实不据以决策）。
 * 纪律：纯增量，读不到=不干预；写盘失败静默（不碰主路）。降权只降出现频率，绝不硬拦（守「不替模型选」）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const storeDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'gate-weights')
const fileFor = (dir) => join(dir || storeDir(), 'gate-combo.json')
const MIN_TRIALS = 5
const comboKey = (ids) => [...ids].filter(Boolean).sort().join('+')

function load(dir) { try { const f = fileFor(dir); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {} } catch { return {} } }
function save(dir, d) { try { const dd = dir || storeDir(); mkdirSync(dd, { recursive: true }); writeFileSync(fileFor(dd), JSON.stringify(d, null, 2), 'utf8'); return true } catch { return false } }

/** Phase8：记一次组合交互（活跃闸集合 + 结果）。组合需 ≥2 闸才有意义。 */
export function recordCombo({ gates, closed = false, rerolled = false, dir } = {}) {
  const ids = (gates || []).filter(Boolean)
  if (ids.length < 2) return null
  const k = comboKey(ids)
  const d = load(dir)
  const e = d[k] || { trials: 0, closed: 0, rerolled: 0 }
  e.trials++
  if (closed) e.closed++
  if (rerolled) e.rerolled++
  d[k] = e
  save(dir, d)
  return { key: k, ...e }
}

/** 读组合权重（数据不足= null，不据以决策——诚实位）。 */
export function comboWeight(ids, dir) {
  const k = comboKey(ids)
  const e = load(dir)[k]
  if (!e || e.trials < MIN_TRIALS) return null
  return { weight: +(e.closed / e.trials).toFixed(3), rerollRate: +(e.rerolled / e.trials).toFixed(3), trials: e.trials }
}

/** Phase9 健康门：历史回炉率 > 阈值的组合=建议降权（不删只降频）。 */
export function downweightedGates(threshold = 0.5, dir) {
  const d = load(dir)
  const bad = []
  for (const [k, e] of Object.entries(d)) {
    if (e.trials >= MIN_TRIALS && e.rerolled / e.trials > threshold) bad.push({ combo: k.split('+'), rerollRate: +(e.rerolled / e.trials).toFixed(3) })
  }
  return bad.sort((a, b) => b.rerollRate - a.rerollRate)
}

/** 消费口：候选闸里若含「历史高回炉组合」→返回它（供 Phase4/7 注入面降该组合出现频）。 */
export function comboPenalty(candidateGates, dir) {
  const set = new Set((candidateGates || []).filter(Boolean))
  for (const { combo } of downweightedGates(0.5, dir)) {
    if (combo.every((g) => set.has(g))) return combo
  }
  return null
}
