/**
 * near-field — v0.6.2 近场变焦（PERSONA 机制半区：FOCUS_NEAR_FIELD 的盘上锚点）。
 * declare 时刻一次性回显"本步近场"≤400B：所属组切片+判据+上次实测+本步承诺+全局指针。
 * 宣誓的功能、非宣誓的体积：每单一步一锚，不每拍复读。全局在盘不在脑——其余一切压成指针。
 */
const cut = (s, n) => { const x = String(s || ''); return x.length > n ? x.slice(0, n) + '…' : x }

/** s=state，step=刚落盘的栈步（含 title/group/predictions/measure），prev=上一次实测读数 {title,v,band} 或 null */
export function nearField(s, step, prev) {
  const g = (s.groups || []).find((x) => x.title === step.group) || {}
  const gMark = g.settled ? '已落账' : '未落账'
  const accepts = (g.accept || []).map((a) => { const x = String(a); return x.length > 18 ? x.slice(0, 18) + '…' : x }).join('；')
  const keys = (step.predictions || []).map((p) => p.key).join(',')
  const prevLine = prev ? `上次实测：「${cut(prev.title, 10)}」V=${prev.v ?? '?'} 档=${prev.band ?? '?'}` : '上次实测：无（本单首步）'
  return [
    `【近场｜只做这一步·${step.title ? cut(step.title, 16) : ''}】`,
    `组「${cut(step.group, 10)}」(${gMark}) ${cut(g.spec, 28)}`,
    `判据: ${cut(accepts, 45)}`,
    prevLine,
    `承诺: 吻合[${keys}]·通道${(step.measure && step.measure.channels || []).length}·未闭不开新步`,
    `合同全文/历史/审材=盘档指针 optimal_stack·graded-state——全局在盘不在脑`,
  ].join('\n')
}
