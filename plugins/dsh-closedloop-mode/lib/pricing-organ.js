/**
 * pricing-organ — v0.6.0 影子定价账本（PRICING-ALGORITHM §6.3 落地；仿真六判据背书）。
 * 构造分离：ΔV 只从盘上 V 读数差取（测量内核），本模块只学成本——学的手够不到奖励的定义。
 * 记忆结构（round7 案底修正）：清洁成本快 EMA + 失败率 Laplace 长记忆（灾难永不淡忘）+ 修复慢 EMA。
 * 切换判据在盘（P6 定义）：records≥300 ∧ 覆盖≥0.9 ∧ 双窗回溯 Spearman≥0.7 —— 机器等自己达标，不等人。
 * 诚实盲区：tok 腿需 zstd 帧批解析（E1 结清路径），不进宿主热路径——J.tok=盲区标注，symbiote 批算后补。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const G_BANDS = [[1, 2], [3, 5], [6, 10], [11, Infinity]]
export const gBandOf = (g) => G_BANDS.findIndex(([a, b]) => g >= a && g <= b)
export const gBandName = (i) => i < 0 ? 'na' : i === 3 ? '11+' : G_BANDS[i][0] + '-' + G_BANDS[i][1]
const A_FAST = Math.pow(0.5, 1 / 30) // 半衰 30 记录
const A_SLOW = Math.pow(0.5, 1 / 200)

export function loadPricing(dir) {
  try {
    const f = join(dir, 'pricing.json')
    if (!existsSync(f)) return initPricing()
    const p = JSON.parse(readFileSync(f, 'utf8'))
    return (p && p.buckets) ? p : initPricing()
  } catch { return initPricing() }
}
export function initPricing() {
  return { v: 1, real: false, buckets: {}, history: [], gates: { records: 0, coverage: 0, windowsPassed: 0 } }
}
export function savePricing(dir, p) {
  try { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'pricing.json'), JSON.stringify(p), 'utf8'); return true } catch { return false }
}

/** 返工计数判定（v0.8.24 协议化）：结构化 cause 优先——只有 model 才算返工；external/process-death/
 *  deliberate 一律不喂定价账。无 cause 的旧账本回退旧正则口径（关键词命中即排除）。 */
export function countsTowardRework(r) {
  const c = r && r.cause
  if (c) return c === 'model'
  const txt = String((r && r.reason) || '')
  return !/process-death|external|外部|用户/i.test(txt) && !/E2E|e2e|虚报|验证闸|验闸|复测|活卡|测闸/.test(txt)
}

/** 会话观测（从盘档 s+stack 纯算，归位本模块——定价判定不住接线层，p6 红线架构正解）。
 *  dV=Σ正降幅+首闭相对 V₀=1；dt=步最早 at→now；rework=窗口内非外部 rolledBack×中位步时距（v1 近似，真值待慢 EMA 自校）；
 *  fragRed=V 序列回升（回归红信号）。tok 腿=批算盲区显式返回 null（E1 帧解路径，不进热路径）。*/
export function observeSession(s, stack, now = Date.now()) {
  const closed = (s && s.closed) || []
  const vSeries = closed.map((c) => c.v).filter((x) => typeof x === 'number')
  let dV = vSeries.reduce((a, v, i) => a + (i ? Math.max(0, vSeries[i - 1] - v) : 0), 0) + (vSeries.length ? Math.max(0, 1 - vSeries[0]) : 0)
  // ★ records=1 首笔抓到（664min 假窗）：t0 原取全栈最早步、串了历史单——修：本票步集=closed 标题命中的步（票内窗口，账不清历史但窗只看本票）
  const titles = new Set(closed.map((c) => c && c.title).filter(Boolean))
  const ats = (stack && Array.isArray(stack.steps) ? stack.steps : [])
    .filter((x) => x && typeof x.at === 'number' && titles.has(x.title))
    .map((x) => x.at)
  const t0 = ats.length ? Math.min(...ats) : now
  // 校准 1a（backfill 实证空转比 0.9：票内墙钟窗含人等待，res 虚高）：时间腿优先吃 ΣJ.dtMin（步窗和≈busy），J 缺位老单回退墙钟窗
  const stepSum = closed.reduce((a, c) => a + (c.J && typeof c.J.dtMin === 'number' ? c.J.dtMin : 0), 0)
  const dtMin = stepSum > 0.2 ? stepSum : Math.max(0.1, (now - t0) / 60000)
  const rb = (stack && stack.rolledBack) || []
  // 校准 1b：故意验闸的回炉（E2E/虚报/验证/复测/活卡字样在归因里）不喂定价账——那是闸的考卷不是工作的失败；案底本身留在 rolledBack 不动
  const DELIBERATE = /E2E|e2e|虚报|验证闸|验闸|复测|活卡|测闸/
  const rbWin = rb.filter((x) => x && typeof x.at === 'number' && x.at > t0 && countsTowardRework(x) && (!x.title || titles.has(x.title)))
  const js = closed.map((c) => c.J && c.J.dtMin).filter((x) => typeof x === 'number').sort((a, b) => a - b)
  const medJ = js.length ? js[Math.floor(js.length / 2)] : 5
  const reworkMin = rbWin.length * medJ
  const fragRed = vSeries.some((v, i) => i > 0 && v > vSeries[i - 1])
  return { g: closed.length, dtMin, dV: Math.max(dV, 0.001), reworkMin, rbCount: rbWin.length, fragRed, tok: null }
}

/** 会话闭合记录 → 桶观测。obs={g, dtMin, dV, reworkMin, fragRed}；dV≤0 拒收（推进无效不配进成本账） */
export function recordSession(p, obs) {
  if (!obs || !(obs.dV > 0) || !(obs.dtMin >= 0)) return { state: p, rejected: 'dV≤0 或时距缺失——不配进账（测量内核说了算）' }
  const bi = gBandOf(obs.g)
  const key = 'g:' + bi
  let b = p.buckets[key]
  if (!b) b = p.buckets[key] = { clean: null, fails: 0, tries: 0, repair: null, fragHits: 0, n: 0 }
  b.n++; b.tries++
  // z3 案底修（测试抓到 round7 灾难淡忘在我实现里重演）：清洁成本只计非回炉观测的时距——
  // 混入回炉步的 dt 会把巨灾体量偷渡进快 EMA 并二次抹除 repair 纯量。回炉观测只喂慢账。
  if (obs.reworkMin > 0) {
    b.fails++
    b.repair = b.repair == null ? obs.reworkMin : b.repair + A_SLOW * (obs.reworkMin - b.repair)
  } else {
    const cleanObs = Math.max(0, obs.dtMin - (obs.fragRed ? obs.fragPenalty || 24 : 0))
    b.clean = b.clean == null ? cleanObs : b.clean + A_FAST * (cleanObs - b.clean)
  }
  if (obs.fragRed) b.fragHits++
  const ratio = obs.dtMin / obs.dV // 观测 res/ΔV（分钟口径）
  p.history.push({ at: Date.now(), key, ratio, n: b.n })
  p.history = p.history.slice(-2000)
  p.gates.records++
  const seenBands = [...new Set(p.history.map((h) => h.key))].length
  p.gates.coverage = Math.min(1, Object.keys(p.buckets).filter((k) => p.buckets[k].n >= 8).length / Math.max(4, seenBands))
  return { state: p, key }
}

/** 期望成本/单位ΔV（三件合成；回退链：桶→全局中位→null=还在冷启动） */
export function estimate(p, g) {
  const b = p.buckets['g:' + gBandOf(g)]
  if (b && b.n >= 8 && b.clean != null) {
    const pHat = (b.fails + 1) / (b.tries + 2)
    const pFrag = (b.fragHits + 1) / (b.tries + 2)
    return (b.clean ?? 0) + pHat * (b.repair ?? 0) + pFrag * 24
  }
  const all = Object.values(p.buckets).filter((x) => x.clean != null)
  if (all.length >= 2) return all.reduce((a, x) => a + x.clean, 0) / all.length // 全局粗估（标注用）
  return null
}

/** 影子 C（资源转化率口径，仅展示与对照——不替换现 C）：1=按最优预期交付 */
export function shadowC(p, g, dtMin, dV) {
  const est = estimate(p, g)
  if (est == null || !(dV > 0)) return null
  const obs = dtMin / dV
  return Math.round(100 * Math.max(0, 2 - obs / Math.max(est, 0.01))) / 100
}

function spearman(a, b) {  if (a.length < 5 || a.length !== b.length) return 0
  const rank = (x) => { const idx = x.map((v, j) => [v, j]).sort((p, q) => p[0] - q[0]); const r = new Array(x.length); idx.forEach((p, k) => r[p[1]] = k + 1); return r }
  const ra = rank(a), rb = rank(b), n = a.length
  const m1 = (n + 1) / 2
  let num = 0, d1 = 0, d2 = 0
  for (let j = 0; j < n; j++) { num += (ra[j] - m1) * (rb[j] - m1); d1 += (ra[j] - m1) ** 2; d2 += (rb[j] - m1) ** 2 }
  return d1 && d2 ? num / Math.sqrt(d1 * d2) : 0
}

/** P6 切换判据（数据判据非时间判据）：records≥300 ∧ 覆盖≥0.9 ∧ 最近两窗各20回溯 Spearman≥0.7
 *  输入 pairs=[{shadowC, trueQ}]（trueQ=会话真值口径 ΔV/总时距 的排序标尺）；达标→real=true（单向棘轮，只在盘上判据松口） */
/** r29 学习含量判定（住定价模块）+r31 单语义收口：回炉只看本单窗口（首闭时间起），本店陈年案底不点亮草稿。 */
export function learningContent(s, stack) {
  const closed = (s && s.closed) || []
  const durMin = closed.reduce((a, c) => a + (c.J && typeof c.J.dtMin === 'number' ? c.J.dtMin : 0), 0)
  const firstClose = closed.length ? Math.min(...closed.map((c) => c.at || Infinity)) : Infinity
  const rb = ((stack && stack.rolledBack) || []).filter((x) => x && typeof x.at === 'number' && x.at >= firstClose)
  return closed.length >= 2 || durMin >= 10 || rb.length >= 1 || closed.some((c) => c.vAfterAudit)
}

/** ④活体半区：真实定价的持续健康判据——切实价后若近 40 对 (shadowC,trueQ) 秩相关 <0.5，
 *  自动回影子并计数案底（回影不是惩罚是止血：账还在攒，重新达标还能再切——切换双向，机器等自己两头都等）。 */
export function evaluateHealth(p) {
  const pr = (p.pairs || []).slice(-40).filter((x) => x.shadowC != null && isFinite(x.trueQ))
  if (pr.length < 20) return { ok: true, note: '样本不足（健康判据不瞎判）' }
  const sp = spearman(pr.map((x) => x.shadowC), pr.map((x) => x.trueQ))
  return { ok: sp >= 0.5, sp, note: `近${pr.length}对影子-真值秩相关=${sp.toFixed(2)}` }
}

export function evaluateSwitch(p, pairs) {
  if (p.real) return { real: true, note: '已切实价（回退双路：evaluateHealth 活体自动回影子；反向判据不达=停在影子——无人签字，机器两头都等）' }
  // r23 接断头：仿真通道报警则阀门锁死——两条证据通道任一喊疼都不切（AND 门收紧不放宽=棘轮）
  if (p.simSick) return { real: false, note: `影子期：仿真通道报病（simSick=${p.simSick}），双通道 AND 门未满——治世界再切` }
  if (p.gates.records < 300) return { real: false, note: `影子期：records=${p.gates.records}/300` }
  // r33 样本门：多步带（g≥3 的 band：3-5/6-10/11+）<30 笔不切——仪式单统计不配当切实价的依据
  const multi = (pairs || []).filter((x) => x.band && x.band !== '1-2' && x.band !== 'na').length
  if (multi < 30) return { real: false, note: `影子期：多步样本不足（${multi}/30）——g≥3 的单攒够前，玩具带统计不构成切价依据` }
  if (p.gates.coverage < 0.9) return { real: false, note: `影子期：覆盖=${(p.gates.coverage * 100).toFixed(0)}%/90%` }
  const w1 = pairs.slice(-20), w0 = pairs.slice(-40, -20)
  if (w1.length < 20 || w0.length < 20) return { real: false, note: '影子期：窗口未满' }
  const s1 = spearman(w1.map((x) => x.shadowC ?? 0), w1.map((x) => x.trueQ))
  const s0 = spearman(w0.map((x) => x.shadowC ?? 0), w0.map((x) => x.trueQ))
  if (s1 >= 0.7 && s0 >= 0.7) { p.real = true; p.cutoverAt = Date.now(); return { real: true, note: `达标切换：双窗 Spearman=${s0.toFixed(2)}/${s1.toFixed(2)}≥0.7（体检窗 7 天开表）` } }
  return { real: false, note: `影子期：双窗=${s0.toFixed(2)}/${s1.toFixed(2)}<0.7`}
}
