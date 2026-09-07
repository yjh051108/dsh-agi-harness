/**
 * judge — v0.6.32 刀二：converge 语义裁判（导演定向「正则不健壮，接 API 单次判断，花费不多」）。
 * 混合三路：正则快路（零成本，agreedMatch）→ 失败时单次 API 裁判 → 裁判不可用/故障=正则判定保底。
 * 边界（铁）：证据锚不豁免——预测数字必须在探针实跑 output（declare 时机械验，防编造测量）；
 * 裁判只接管「格式笨」（句式/单位/前导数字），不管「证据真」。无 DSH_JUDGE_KEY=零行为变化。
 */
const BASE_DEFAULT = 'https://api.deepseek.com/chat/completions'
const MODEL_DEFAULT = 'deepseek-chat'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/** 会话同源凭证（v0.6.33 导演定向「api 直接按会话当前 api 对应」）：
 *  与宿主同源 .credentials.yaml 的 DEEPSEEK_API_KEY ref（deepseek-official 会话默认凭证）
 *  + 标准端点与 deepseek-chat 通用模型；DSH_JUDGE_KEY 仍作显式覆盖。 */
function sessionApiKey() {
  const base = process.env.DSH_HOME || join(homedir(), '.dsh')
  try {
    const raw = readFileSync(join(base, '.credentials.yaml'), 'utf8')
    const m = /^  DEEPSEEK_API_KEY:\s*(\S+)/m.exec(raw)
    if (m) return m[1]
  } catch { /* 凭证库不可读=走 env/空 */ }
  return process.env.DEEPSEEK_API_KEY || null
}

/** 裁判提示词（纯函数，固定形——防提示注入：输入只作为被判定数据出现）。 */
export function judgePrompt({ key, value, line }) {
  return [
    '你是数值对账判定器。判断下面这条「对账陈述」是否报告了指定预测的实测结果且数值与预测一致。',
    '预测 key：' + key,
    '预测值：' + value,
    '对账陈述：' + line,
    '判定标准：陈述里必须含该 key 的实测读数（真实数字），读数与预测值一致（单位后缀如「行/字节/个」可忽略；四舍五入差异不算一致）。空话、占位词（如「已完成」「正常」）不算。',
    '只输出一个 JSON：{"match": true 或 false, "reason": "一句话依据"}',
  ].join('\n')
}

/** 解析裁判回执（纯函数）：合法 → {match, reason}；否则 null。 */
export function parseJudgeResponse(text) {
  try {
    const a = String(text || '').indexOf('{')
    const b = String(text || '').lastIndexOf('}')
    if (a < 0 || b <= a) return null
    const v = JSON.parse(String(text).slice(a, b + 1))
    if (typeof v.match !== 'boolean') return null
    return { match: v.match, reason: String(v.reason || '').slice(0, 120) }
  } catch { return null }
}

/** 实调 API（fetch，超时保底 5s；任何故障返回 null=保底路径）。 */
export async function callJudge(q, opts = {}) {
  const apiKey = opts.apiKey || process.env.DSH_JUDGE_KEY || sessionApiKey()
  if (!apiKey) return null
  const base = opts.base || process.env.DSH_JUDGE_BASE || BASE_DEFAULT
  const model = opts.model || process.env.DSH_JUDGE_MODEL || MODEL_DEFAULT
  const timeoutMs = opts.timeoutMs ?? 5000
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: judgePrompt(q) }], max_tokens: 120, temperature: 0 }),
      signal: ctrl.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data?.choices?.[0]?.message?.content ?? ''
    return parseJudgeResponse(text)
  } catch { return null } finally { clearTimeout(t) }
}

let _override = null
/** 测试注入位（假裁判）；生产传 null 还原。 */
export function setJudge(fn) { _override = fn || null }
/** 取当前裁判：测试注入 > env/会话同源凭证 > null（=正则保底）。 */
export function getJudge() {
  if (_override) return _override
  return (process.env.DSH_JUDGE_KEY || sessionApiKey()) ? (q) => callJudge(q) : null
}
