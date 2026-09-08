/**
 * intent — 意图通道单一真相（v0.8.13 起）：
 *   ① JSON 信封（零散文词法猜测） ② 散文分句 + 否定感知回退 ③ 弹窗选项**结构化前缀协议**决策
 * 为什么独立成模块：同一语义曾有两套实现——index.js 的 scanIntent（文本扫描）与 tools.js 的 freeze
 * 弹窗子串匹配（/确认/.test(label)）——修了前者没修后者，弹窗（主通道）仍把「暂不确认」判成 approve。
 * 单一真相=漏洞只修一处；导出面只此一份（index.js 仅做兼容再导出）。
 */

/** 意图枚举（唯一合法取值）。 */
export const INTENTS = ['approve', 'reject']
const INTENT_ENUM = new Set(INTENTS)

/** 冻结弹窗选项（label 是协议：'·' 前段=意图前缀；intent 字段=结构化真值）。 */
export const FREEZE_OPTIONS = [
  { label: '确认·开执行阶段', intent: 'approve', description: '按此权重进入每步实时定序' },
  { label: '反驳·解锁重排', intent: 'reject', description: '回标定态改权重/组结构，已闭账不丢' },
]

/** 信封扫描**单一真相**（v0.8.17）：从正文里找出 `closedloop` 信封值（围栏块优先、裸对象兜底）。
 *  返回 { value, saw }：saw=true=看见了 closedloop 信封（value 可能形态非法）；saw=false=没有信封。
 *  parseIntentEnvelope / parseSignEnvelope 都走这里——围栏/括号扫描只此一份（v0.8.13 的案底：两处实现=漏洞只修一处）。 */
export function parseClosedloopEnvelope(text) {
  const t = String(text || '')
  if (!t.includes('{')) return { value: null, saw: false }
  const blocks = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let m
  while ((m = fence.exec(t))) blocks.push(m[1])
  const i = t.indexOf('{'), j = t.lastIndexOf('}')
  if (i >= 0 && j > i) blocks.push(t.slice(i, j + 1))
  let saw = false
  for (const b of blocks) {
    let o
    try { o = JSON.parse(String(b).trim()) } catch { continue }
    if (!o || typeof o !== 'object' || !('closedloop' in o)) continue
    saw = true
    return { value: o.closedloop, saw }
  }
  return { value: null, saw }
}

/** JSON 意图信封（v0.8.13 意图通道协议化）：正文含 ```json {"closedloop":{"intent":"approve"}} ```
 *  或裸对象 {"closedloop":"reject"} → 命中即以信封为准（只做 JSON.parse + 定界符切分，不对散文做词法猜测）。
 *  返回 { intent, invalid }：invalid=true=**看见了信封但形态非法**（非枚举值）——调用方须 fail-closed 返回
 *  null，绝不退回散文猜测（weights 段 approve 会直接锁合同，猜错=把导演的「不要」当「要」）。 */
export function parseIntentEnvelope(text) {
  const { value, saw } = parseClosedloopEnvelope(text)
  if (!saw) return null
  const raw = typeof value === 'string' ? value : (value && typeof value === 'object' && typeof value.intent === 'string' ? value.intent : null)
  const norm = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return INTENT_ENUM.has(norm) ? { intent: norm, invalid: false } : { intent: null, invalid: true }
}

/** JSON 签收信封（v0.8.17）：{"closedloop":{"sign":"组A"}} 或 {"closedloop":{"sign":["组A","全部"]}}。
 *  返回签名数组（已规范化、去重、去空）；无信封=null。形态非法（sign 非字符串/字符串数组）=[]（fail-closed）。 */
export function parseSignEnvelope(text) {
  const { value, saw } = parseClosedloopEnvelope(text)
  if (!saw) return null
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value.sign : null
  const arr = typeof raw === 'string' ? [raw] : (Array.isArray(raw) ? raw : null)
  if (!arr) return []
  return [...new Set(arr.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean))]
}

// 散文回退（信封缺席时）：分句 + 否定感知——旧实现纯子串，「先不要确认」「别确认」「not ok」都含 approve
// 子串→误判 approve（weights 段=直接锁合同）。现按分句判定：分句内否定词先于确认词=否定式（reject）。
const REJECT_RE = /修改|拒绝|取消|不同意|建议|改成|改为|调整为|调整|reject/i
const APPROVE_RE = /确认|通过|同意|确定|继续|开工|开始|approve|confirm|(?<![a-z])ok(?![a-z])/i
const NEG_RE = /不|别|勿|没|未|甭|休|\b(?:not|no|never|don'?t|doesn'?t|won'?t)\b/i
const CLAUSE_SEP = /[，。！？；、,;!?\n\r]+|——|—|~/

/** 散文分句扫描（不导出——单测走 scanIntent/scanIntentFull）。reject 优先=既有 a2 契约。 */
function scanProse(t) {
  const clauses = t.split(CLAUSE_SEP).map((x) => x.trim()).filter(Boolean)
  let approved = false
  for (const c of clauses) {
    if (REJECT_RE.test(c)) return 'reject'
    if (APPROVE_RE.test(c)) {
      const ap = c.search(APPROVE_RE), ng = c.search(NEG_RE)
      if (ng >= 0 && ng < ap) return 'reject'
      approved = true
    }
  }
  return approved ? 'approve' : null
}

/** 意图判定全量形态（v0.8.13）：信封优先（不受长度门限制）→ 散文分句扫描（>200 字不猜）。
 *  source 溯源：json / json-invalid / too-long / text / null——scanLog 落盘可查。 */
export function scanIntentFull(text) {
  const t = String(text || '').trim()
  if (!t) return { intent: null, source: null }
  const env = parseIntentEnvelope(t)
  if (env) return env.invalid ? { intent: null, source: 'json-invalid' } : { intent: env.intent, source: 'json' }
  if (t.length > 200) return { intent: null, source: 'too-long' }
  const intent = scanProse(t)
  return { intent, source: intent ? 'text' : null }
}

/** 确认/修改意图（纯函数可测；修改优先——v0.2 语义继承）。导出供 a2 测例。 */
export function scanIntent(text) {
  return scanIntentFull(text).intent
}

/** 选项标签→意图（结构化前缀协议）：取 '·' 前段与 FREEZE_OPTIONS 的 label 前缀逐字比。
 *  未知标签=null（**不猜**）——旧实现 /确认/.test(label) 会把「暂不确认」「确认修改」判成 approve。 */
export function labelIntent(label) {
  const s = String(label || '').trim()
  if (!s) return null
  const head = s.split('·')[0].trim()
  const hit = FREEZE_OPTIONS.find((o) => o.label === s || o.label.split('·')[0] === head)
  return hit ? hit.intent : null
}

/** 弹窗答案→冻结决策（v0.8.13 结构化）：返回 { intent, via }，intent ∈ approve/reject/null。
 *  优先级：①显式结构化值（answer.decision/intent）②选项标签（逐字/前缀，含混=null）
 *  ③无选项时补充文字走 scanIntentFull（否定感知）。**任何未识别形态一律 null=fail-closed**。 */
export function decideFreezeAnswer(a) {
  const selected = Array.isArray(a?.selected) ? a.selected.map((x) => String(x)) : []
  const custom = String(a?.custom || '').trim()
  const explicit = String(a?.decision ?? a?.intent ?? '').trim().toLowerCase()
  if (INTENT_ENUM.has(explicit)) return { intent: explicit, via: 'json' }
  const hits = new Set()
  for (const s of selected) { const i = labelIntent(s); if (i) hits.add(i) }
  if (hits.size === 1) return { intent: [...hits][0], via: 'label' }
  if (hits.size > 1) return { intent: null, via: 'ambiguous' }
  if (selected.length) return { intent: null, via: 'unknown-label' }
  const full = scanIntentFull(custom)
  return { intent: full.intent, via: full.intent ? `custom:${full.source}` : (full.source || 'empty') }
}
