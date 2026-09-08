/**
 * quality-ledger — v0.7.0 同类任务质量账本（AGI 定义「成长性」的量化基础）。
 * 任务签名 = purpose 归一化 + 断言结构哈希；每单落质量记录；跨单趋势查询。
 */
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { bucketKey, featuresOf, processLabel } from './learn-key.js'

const storeDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'gate-weights')
const ledgerFile = () => join(storeDir(), 'quality-ledger.jsonl')

function ensureDir() { mkdirSync(storeDir(), { recursive: true }) }

/** 归一化 purpose：去标点/去数字/小写/取关键词前 3 */
export function normalizePurpose(purpose) {
  const raw = String(purpose || '').trim()
  // 中英混合：去标点/数字后，取前 12 个有效字符（中文无空格分隔）
  const cleaned = raw
    .replace(/[^\u4e00-\u9fa5a-zA-Z\s]/g, ' ')
    .replace(/\d+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  // 英文取前 3 个 ≥2 字母的词；中文取前 12 字符
  const words = cleaned.split(' ').filter(w => /^[a-z]{2,}$/.test(w))
  if (words.length >= 2) return words.slice(0, 3).join('|')
  return cleaned.replace(/\s/g, '').slice(0, 12)
}

/** 任务签名 = hash(normalizedPurpose + assertionStructure) */
export function taskSignature(purpose, assertions) {
  const norm = normalizePurpose(purpose)
  const structure = (assertions || []).map(a => a.severity).sort().join(',')
  return createHash('sha256').update(norm + '::' + structure).digest('hex').slice(0, 12)
}

/** 记录一单的质量数据。
 *  v0.8.35：新增 bucket/features/process 三字段——sig 是「这一单」的指纹（83/83 唯一，无法聚合），
 *  bucket 是「这一类」的结构粗桶（跨会话可攒样本）；process 是机械过程标签（非人签）。 */
export function recordQuality({ sid, purpose, assertions, groups, writeSet, rerolls, rerollLayers, predictionBias, humanInterventions, tokenCost, frictionCount, zTimeline, finalQuality, zeroed, missCount, process }) {
  ensureDir()
  const sig = taskSignature(purpose, assertions)
  const feats = featuresOf({ assertions, groups, writeSet })
  const bucket = bucketKey({ assertions, groups, writeSet })
  const rec = {
    at: new Date().toISOString(),
    sid,
    sig,
    bucket,
    features: feats,
    process: process || processLabel({ zeroed: zeroed === true, rerolls, missCount }),
    rerolls: rerolls || 0,
    rerollLayers: rerollLayers || {},
    predictionBias: predictionBias || [],
    humanInterventions: humanInterventions || 0,
    tokenCost: tokenCost || 0,
    frictionCount: frictionCount || 0,
    zTimeline: zTimeline || [],
    finalQuality: finalQuality || 'unknown',
  }
  appendFileSync(ledgerFile(), JSON.stringify(rec) + '\n', 'utf8')
  return rec
}

/** 查询同类趋势：最近 N 单 vs 之前 N 单。
 *  v0.8.35：样本键从 sig 换成粗桶（旧记录无 bucket 时按 sig 回退——不炸历史账）。
 *  @param {object} [opts] {groups, writeSet} 参与粗桶的结构特征 */
export function qualityTrend(purpose, assertions, windowSize = 5, opts = {}) {
  const sig = taskSignature(purpose, assertions)
  const bucket = bucketKey({ assertions, groups: opts.groups, writeSet: opts.writeSet })
  if (!existsSync(ledgerFile())) return null

  const records = []
  try {
    for (const line of readFileSync(ledgerFile(), 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r.bucket ? r.bucket === bucket : r.sig === sig) records.push(r)
      } catch { /* 坏行跳过 */ }
    }
  } catch { return null }

  if (records.length < 2) return null

  const recent = records.slice(-windowSize)
  const previous = records.slice(-windowSize * 2, -windowSize)

  if (previous.length === 0) {
    return { sig, bucket, total: records.length, recent: aggregate(recent), previous: null, trend: 'insufficient-data' }
  }

  const rAvg = aggregate(recent)
  const pAvg = aggregate(previous)
  const changes = {
    rerolls: pAvg.rerolls > 0 ? ((rAvg.rerolls - pAvg.rerolls) / pAvg.rerolls * 100).toFixed(0) + '%' : 'n/a',
    bias: pAvg.bias !== 0 ? ((rAvg.bias - pAvg.bias) / Math.abs(pAvg.bias) * 100).toFixed(0) + '%' : 'n/a',
    interventions: pAvg.interventions > 0 ? ((rAvg.interventions - pAvg.interventions) / pAvg.interventions * 100).toFixed(0) + '%' : 'n/a',
    friction: pAvg.friction > 0 ? ((rAvg.friction - pAvg.friction) / pAvg.friction * 100).toFixed(0) + '%' : 'n/a',
  }

  return { sig, bucket, total: records.length, recent: rAvg, previous: pAvg, changes, trend: changes.rerolls.startsWith('-') ? 'improving' : 'degrading' }
}

function aggregate(records) {
  if (!records.length) return { rerolls: 0, bias: 0, interventions: 0, friction: 0, tokens: 0 }
  const n = records.length
  return {
    rerolls: +(records.reduce((s, r) => s + (r.rerolls || 0), 0) / n).toFixed(2),
    bias: +(records.reduce((s, r) => {
      const biases = (r.predictionBias || []).filter(b => typeof b === 'number')
      return s + (biases.length ? biases.reduce((a, b) => a + Math.abs(b), 0) / biases.length : 0)
    }, 0) / n).toFixed(2),
    interventions: +(records.reduce((s, r) => s + (r.humanInterventions || 0), 0) / n).toFixed(2),
    friction: +(records.reduce((s, r) => s + (r.frictionCount || 0), 0) / n).toFixed(2),
    tokens: Math.round(records.reduce((s, r) => s + (r.tokenCost || 0), 0) / n),
  }
}
