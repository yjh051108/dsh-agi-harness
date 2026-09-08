/**
 * learn-key — v0.8.35 样本可聚合层（治本：把「一单一个键」换成结构粗桶）。
 *
 * 案底（本单实测）：quality-ledger 83 条记录 → 83 个唯一 taskSignature（重复率 0）。
 * 后果：qualityTrend 要 ≥2 同键、scoreCandidate 要 ≥5 同键 → 两条消费口永远拿不到样本，
 * 「同类任务学得更好」在数据上不可能发生——问题不在贝叶斯算子，在样本被切碎了。
 *
 * 纪律：
 *  - 纯函数：无 IO、无时钟、无随机（可合成数据单测）。
 *  - 桶只由**结构特征**决定：断言数档 × 严重度构成 × 是否改源码 × 组数档——措辞无关。
 *  - processLabel 取值域不含人签词（accepted/rejected 只能由真人帧写）；它是过程读数不是交付结论。
 */

/** 断言数档：0 / 1-2 / 3-5 / 6-10 / 11+ */
export function sizeBand(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v <= 2) return '1-2'
  if (v <= 5) return '3-5'
  if (v <= 10) return '6-10'
  return '11+'
}

/** 严重度构成：C=含 catastrophic / M=含 major / m=仅 minor / x=无断言 */
export function severityClass(assertions) {
  const list = Array.isArray(assertions) ? assertions : []
  if (!list.length) return 'x'
  const sev = new Set(list.map((a) => (a && a.severity) || 'minor'))
  if (sev.has('catastrophic')) return 'C'
  if (sev.has('major')) return 'M'
  return 'm'
}

/** 组数档：0 / 1 / 2-3 / 4+ */
export function groupsBand(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v === 1) return '1'
  if (v <= 3) return '2-3'
  return '4+'
}

/** 是否仓库源码路径（写入面里出现才算「改源码」——口径固定，不看文件名猜测） */
export function isSourcePath(p) {
  return /[\\/](src|lib|scripts|tests|client)[\\/]/i.test(String(p || ''))
}

/** 落账用特征（可审计的中间量；桶由它派生，改桶必先改这里） */
export function featuresOf({ assertions = [], groups = [], writeSet = [] } = {}) {
  const as = Array.isArray(assertions) ? assertions : []
  const gs = Array.isArray(groups) ? groups : []
  const ws = Array.isArray(writeSet) ? writeSet : []
  return {
    nA: as.length,
    size: sizeBand(as.length),
    sev: severityClass(as),
    nCmd: as.filter((a) => a && a.measure && a.measure.cmd).length,
    src: ws.some(isSourcePath) ? 'src' : 'other',
    nG: gs.length,
    gb: groupsBand(gs.length),
  }
}

/** 粗桶键：结构相同即同键（措辞/会话/时间不影响）。 */
export function bucketKey(args = {}) {
  const f = featuresOf(args)
  return `A${f.size}|S${f.sev}|W${f.src === 'src' ? 's' : 'o'}|G${f.gb}`
}

/** 机械过程标签（不是交付结论）：incomplete=未归零；clean=零回炉零失配；dirty=回炉≥5 或失配≥3；其余 mixed。 */
export function processLabel({ zeroed = false, rerolls = 0, missCount = 0 } = {}) {
  if (!zeroed) return 'incomplete'
  const r = Math.max(0, Number(rerolls) || 0)
  const m = Math.max(0, Number(missCount) || 0)
  if (r === 0 && m === 0) return 'clean'
  if (r >= 5 || m >= 3) return 'dirty'
  return 'mixed'
}

export const PROCESS_LABELS = ['clean', 'mixed', 'dirty', 'incomplete']
/** 人签词（本模块永不产出——出现即事故） */
export const HUMAN_LABELS = ['accepted', 'needed_fix', 'rejected', 'no_defect']
