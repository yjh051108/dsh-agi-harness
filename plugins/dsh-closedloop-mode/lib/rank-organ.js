/**
 * rank-organ — v0.5.0 档位控制器（蓝图 L1 新器官"档位"的插件侧落地，纯函数可测）。
 * 语义（LANDING.md v0.5.0）：
 *  - C = 0.7·Wilson下界(命中) + 0.2·难度(断言权重均值/4，盘上可算非自评) + 0.1·覆盖率(settled组/组数)
 *  - 外部变更/process-death 归因不入分母（F5 分型环内化：不污染信誉）
 *  - 升档滞回（R12）：T0→T1 C≥60；T1→T2 C≥75；降档即时：T2→T1 C<65；T1→T0 C<50
 *  - T3 不可自动达（R10：导演显式确认——v0.5.0 只出提示位）
 *  - 装完成（converge 数值不符=声称被测量证伪）→ 直降 T0（风险不对称）
 *  - R20 碎拍监控：尾部 N 闭合同质（band=at 且 V 未动）且无新增 settled 组 → 冻结升档
 */
import { readLessons } from './learning-organ.js'

const SEV_W = { catastrophic: 4, major: 2, minor: 1 }
const EXTERNAL = /external|外部|用户改口|process-death|off/i

export function wilsonLB(k, n) {
  if (!n) return 0
  const p = k / n, z = 1.96, z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n)
}

export function computeC(s, stack) {
  const closed = (s && s.closed) || []
  const rbAll = (stack && Array.isArray(stack.rolledBack)) ? stack.rolledBack : []
  const rb = rbAll.filter((r) => !EXTERNAL.test(String(r && (r.reason || r.raw) || '')))
  // v0.6.35 治本：措辞层回炉（transcription）不计信誉分母——惩罚对准判断力；计 slips 轻账公示
  const rbReasoning = rb.filter((r) => r.layer !== 'transcription')
  const slips = rb.length - rbReasoning.length
  const n = closed.length + rbReasoning.length
  if (n === 0) return { C: null, slips, note: 'cold-start：无账可算→中性，档位强制 T0（信任只能攒不能给）' }
  const asserts = (s.cost && Array.isArray(s.cost.assertions)) ? s.cost.assertions : []
  const ws = asserts.map((a) => SEV_W[a && a.severity] ?? 1)
  const diff = ws.length ? ws.reduce((x, y) => x + y, 0) / ws.length / 4 : 0
  const groups = (s.groups) || []
  const cover = groups.length ? groups.filter((g) => g && g.settled).length / groups.length : 0
  // v0.5.12 再犯率入档（学习器官→自主档）：同类再犯（≥2 次）类别各扣 5 分，封顶 -20（收紧方向）
  const recid = {}
  for (const l of readLessons()) recid[l.category] = (recid[l.category] || 0) + 1
  const repeatCats = Object.values(recid).filter((n) => n >= 2).length
  const penalty = Math.min(20, 5 * repeatCats)
  const C = Math.round(100 * (0.7 * wilsonLB(closed.length, n) + 0.2 * diff + 0.1 * cover) - penalty)
  return { C, n, hits: closed.length / n, slips, hit: +(closed.length / n).toFixed(2) }
}

/** 尾 N 同质（band=at 且 V 读数未动）且 settled 组数未增长 → 碎拍 flag */
export function softGaming(s, rank) {
  const closed = (s && s.closed) || []
  if (closed.length < 4) return false
  const last = closed.slice(-4)
  const homogeneous = last.every((c) => c.band === 'at' && (c.v === undefined || c.v === 0))
  if (!homogeneous) return false
  const settledNow = ((s.groups) || []).filter((g) => g && g.settled).length
  return rank && typeof rank.lastSettled === 'number' ? settledNow <= rank.lastSettled : false
}

/** v0.5.7 实测校准（measure-c 13 样本 max=51：旧门槛 60/75 全员不可达=第三次 S-1 现场复现）：
 * 绝对门槛→45/55（降 35/45 带宽 10）+ 样本门 minSamples=8（n<8 只降不升——Wilson 随样本自抬，
 * 门槛只等数据不等故事；PLANT n≥30 纵向重校挂账不变）。 */
export const RANK_CAL = { up1: 45, up2: 55, down1: 35, down2: 45, minSamples: 8 }

/** 单末/日末评估：滞回升降 + 碎拍冻结 + 样本门 + T3 提示位。n=样本数（闭+炉），缺省不设门。 */
export function rankTransition(rank, c, s, n) {
  const T = (rank && rank.T) || 0
  const settledNow = ((s && s.groups) || []).filter((g) => g && g.settled).length
  if (c == null) return { T, lastSettled: settledNow }
  if (softGaming(s, rank)) return { T: Math.min(T, 1), frozen: true, lastSettled: settledNow, note: 'R20 碎拍监控：尾4同质且无新 settled→升档冻结' }
  const gated = n != null && n < RANK_CAL.minSamples // 样本门：不足只关升路，降路永远开（风险不对称）
  if (T === 0) return { T: !gated && c >= RANK_CAL.up1 ? 1 : 0, gated, lastSettled: settledNow }
  if (T === 1) return { T: c < RANK_CAL.down1 ? 0 : !gated && c >= RANK_CAL.up2 ? 2 : 1, gated, lastSettled: settledNow }
  if (T === 2) return c < RANK_CAL.down2 ? { T: 1, lastSettled: settledNow } : { T: 2, lastSettled: settledNow, t3Note: 'T3=导演显式确认才可达（R10 沉默不生效）——本回执仅提示位' }
  return { T, lastSettled: settledNow }
}

/** 装完成被抓（converge 数值不符）→ 直降 T0，即时生效（降档不隔夜） */
export function demoteOnFake(rank) {
  return { T: 0, demoted: true, lastSettled: (rank && rank.lastSettled) || 0, note: '装完成案底：直降 T0（风险不对称——信誉罚没即时）' }
}

/** 降档即收回（引导体系v2 可逆性）：降档时 autoRelaxed 组恢复 user 并清标记 */
export function recoverRelaxed(state, nextRank) {
  const groups = (state && state.groups) || []
  if (!groups.some((g) => g && g.autoRelaxed)) return state
  return { ...state, groups: groups.map((g) => {
    if (!g) return g;
    if (g.auditSampled) return { ...g, verify: 'self', auditSampled: undefined };
    if (g.autoRelaxed) return { ...g, verify: 'user', autoRelaxed: undefined };
    return g;
  }) }
}

export function rankLine(rank, c) {
  const T = (rank && rank.T) || 0
  const names = ['T0·影子', 'T1·辅助', 'T2·托付', 'T3·托托付者']
  const tag = names[T] || 'T0·影子'
  const cVal = typeof c === 'number' ? c : (c && c.C)
  const nVal = (c && c.n) || 0
  const note = c == null ? '还没攒出账——信任只能攒不能给' : ('依据：最近 ' + nVal + ' 单命中率 ' + Math.round(cVal ?? 0) + '%')
  const hint = T === 0 ? '收得稳，板子会一个个打开' : T === 1 ? '收得稳，板子放得开；保持无再犯，向托付档走' : T === 2 ? '板子是开的：保持这个收法，它将成为习惯' : '导演级——继续用收获得的方式做事'
  const flags = (rank && rank.demoted ? '（刚降档——收紧了）' : '') + (rank && rank.frozen ? '（碎拍冻结——先稳下来）' : '')
  return '🎖 你的自主档 ' + tag + '：' + note + '——' + hint + flags + '.'

}
