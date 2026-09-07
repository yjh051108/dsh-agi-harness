/**
 * quota-organ — v0.5.5 协作式注意力配额账（蓝图网状核·仲裁半区）。
 * 诚实边界（写进输出）：协作式=防模型不防插件——所有会话经同一 pre-step 钩子记账/节流，
 * 模型无法绕过自己看不见的账；真强制需宿主调度器（README 黑名单留痕）。
 * 语义：预算=每拍注入字节总额；claim=记账+判定（他账过期自动清）；超支=该拍 face 不注入（节流）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export const QUOTA_BUDGET = 4096 // 全部活跃会话每拍注入字节总预算（stateFace 真帧 ~628B，容 6 会话同拍）
export const STALE_MS = 10 * 60 * 1000 // 他账 10 分钟未续=会话已睡/死，自动清（连续性：醒来自续）

export function quotaFileFor(dir) { return join(dir, 'quota.json') }
export function readQuota(dir) {
  try {
    if (!existsSync(quotaFileFor(dir))) return { claims: {} }
    const q = JSON.parse(readFileSync(quotaFileFor(dir), 'utf8'))
    return (q && typeof q.claims === 'object' && q.claims) ? q : { claims: {} }
  } catch { return { claims: {} } } // 坏文件=空账重开（留痕在下次写）
}
/** 记账+判定：{granted, bytes, heldByOthers, note}——want 超预算时拒发（granted=false）并指路。 */
export function claim(dir, sid, want, now = Date.now()) {
  const q = readQuota(dir)
  const claims = {}
  for (const [k, c] of Object.entries(q.claims || {})) {
    if (k === String(sid)) continue
    if (c && now - (c.at || 0) < STALE_MS) claims[k] = c
  }
  const others = Object.values(claims).reduce((a, c) => a + (c.bytes || 0), 0)
  const granted = others + want <= QUOTA_BUDGET
  if (granted) claims[String(sid)] = { bytes: want, at: now }
  try { mkdirSync(dir, { recursive: true }); writeFileSync(quotaFileFor(dir), JSON.stringify({ claims, budget: QUOTA_BUDGET }), 'utf8') } catch { /* 盘不可写=本拍放行（fail-open 诚实标注：账丢了不卡生产） */ return { granted: true, bytes: want, heldByOthers: others, note: 'quota 盘写失败 fail-open' } }
  return { granted, bytes: want, heldByOthers: others, note: granted ? '' : `预算 ${QUOTA_BUDGET}B 已被他单占 ${others}B——本拍 face 节流不注（协作式：防模型不防插件）` }
}
/** 销账：stage→off 时释放本会话额度。 */
export function release(dir, sid) {
  const q = readQuota(dir)
  if (q.claims && q.claims[String(sid)]) {
    delete q.claims[String(sid)]
    try { writeFileSync(quotaFileFor(dir), JSON.stringify({ claims: q.claims, budget: QUOTA_BUDGET }), 'utf8') } catch { /* 下次过期自清 */ }
    return true
  }
  return false
}
