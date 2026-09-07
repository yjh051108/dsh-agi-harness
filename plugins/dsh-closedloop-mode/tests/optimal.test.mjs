import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TMP = mkdtempSync(join(tmpdir(), 'oengine-'))
process.env.DSH_HOME = TMP

const { declareStep, convergeStep, rollbackStep, loadStack, saveStack, stackText, stackTop, findClosedFor, valueChainText } = await import('../src/optimal-engine.js')
const { initMode, trigger, onCostCommit, onGroupsEdit, onWeightsFreeze, onWeightsConfirmed, saveState, loadState } = await import('../src/mode-state.js')
const { optimalDeclareDefinition, optimalConvergeDefinition, optimalRollbackDefinition, optimalStackDefinition } = await import('../src/tools.js')

const base = (title, source = 'prior:AGMA a=m(Z1+Z2)/2') => ({ // v0.4.2 来源纪律：公式先验=显式 prior:（默认参数面，调用点零修改）
  title,
  invariants: ['m=0.5 全链统一'],
  predictions: [{ key: '中心距', value: '77.5mm', source }],
  cost: [{ failure: '中心距误读', defense: '按公式算非目测' }],
  law: [{ signal: '实测中心距偏出 ±0.1', action: '按公式重算参数,不手改目测啮合' }],
  measure: { right: '节圆相切滚动', wrongSignal: '齿顶互插', channels: ['盘档: state JSON 字段', '运行时: 日志测量'] },
  confidence: 'high',
})
const dvDown = { beforeBand: 'far', measuredBand: 'near', channels: ['盘档: 块 closed 且残差档降', '运行时: 实测距离变小'] }
const agreeOK = ['中心距: 实测 77.5 ≠ 77.5（分度圆直径/π 复算）']

function makeDev(sid, verify = 'self') { // v0.3 形变：慢环仪式走 v3 算子（合同→组→冻结→确认=rolling）
  let s = onCostCommit(trigger(initMode(), '任务'), { purpose: '为测试者验证最优律闭环（十二字以上）', assertions: [{ text: '质量', severity: 'major', source: '测试合同' }] })
  s = onGroupsEdit(s, [{ title: '组A', spec: 's', accept: ['a'], verify }]).state
  s = onWeightsConfirmed(onWeightsFreeze(s).state)
  saveState(sid, s)
  return {}
}
const mkExec = (sid) => ({ agent: { session: { id: sid, events: [], append: () => {} }, followup: () => {}, steer: () => {} } })

/* ---------- declare 契约门 ---------- */
test('declare：缺 law=拒（消灭调试的结构位）；缺双通道=拒；dip 无回升计划=拒', () => {
  const sid = 't-decl-gates'
  const noLaw = { ...base('x'), law: [] }
  assert.match(declareStep(sid, noLaw).error, /law 必填/)
  const oneChan = { ...base('x'), measure: { ...base('x').measure, channels: ['仅一条'] } }
  assert.match(declareStep(sid, oneChan).error, /通道/)
  const badDip = { ...base('x'), vExpect: 'dip' }
  assert.match(declareStep(sid, badDip).error, /dipPlan/)
})

test('v0.3.1 回归① at→near 的 dip 登记被拒（体验单活板门关闭）', () => {
  declareStep('trap-a', { title: 'T', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'dip', dipPlan: '声明倒退段，下一步回升清偿' })
  const r = convergeStep('trap-a', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.ok, false)
  assert.match(r.error, /活板门|不可满足/)
  assert.equal(stackTop(loadStack('trap-a')).status, 'open', '拒绝不落账，出路=rollback 改建模')
})

test('v0.3.1 回归② 回 at 即清（同栈：near→near 挂账 → improve near→at 清账）', () => {
  const sid = 'clr-a'
  declareStep(sid, { title: '暂差', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'dip', dipPlan: '下一步 near→at 回升清偿' })
  const r1 = convergeStep(sid, { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'near', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r1.step.pendingDip, true, '中档 dip 照挂（闸不松）')
  declareStep(sid, { title: '回升', predictions: [{ key: 'v', value: '3', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: c', 'rt: d'] } })
  const r2 = convergeStep(sid, { agreed: ['v: 实测 3 ≠ 预测 3（异源）'], dv: { beforeBand: 'near', measuredBand: 'at', channels: ['fs: c', 'rt: d'] } })
  assert.equal(r2.step.status, 'closed')
  assert.equal(loadStack(sid).steps[0].pendingDip, false, '回 at 即清')
})

test('v0.3.1 回归③ 存量死角账被饱和步救援', () => {
  saveStack('res-a', { steps: [{ n: 1, title: '旧引擎死角账', status: 'closed', pendingDip: true, dv: { before: 'at', after: 'near', mode: 'dip' }, agreed: [], discrepancies: [], at: 1 }], rolledBack: [] })
  declareStep('res-a', { title: '饱和收官', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'dip', dipPlan: 'at→at 饱和验证步' })
  const r = convergeStep('res-a', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.dv.mode, 'dip-saturated')
  assert.equal(loadStack('res-a').steps[0].pendingDip, false, '达 at 终结一切债务（含存量死角）')
})

test('declare：无源预测声明期直拒（v0.3 定理4 硬化位——v0.2 为占位标签）', () => {
  const noSrc = { ...base('x'), predictions: [{ key: 'k', value: 'v' }] }
  assert.match(declareStep('t-theorem4', noSrc).error, /既定规则/)
})

test('数值对硬校验（v0.3 冒烟活证两洞）：错配/占位强制转不吻合，真数对放行', () => {
  const d1 = (sid) => declareStep(sid, { title: 'T', predictions: [{ key: '字节数', value: '14', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  d1('v-mis')
  let r = convergeStep('v-mis', { agreed: ['字节数: 实测 13 ≠ 预测 14（runtime node）'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'invalidated')
  assert.match(r.step.discrepancies.join(), /13 与声明值 14 不等/)
  // Bug-A fix: agreed 无覆盖数字预测 key 时，不强制不吻合（等待测量声明即可；key 不匹配为用户笔误场景）
  d1('v-no-cover')
  r = convergeStep('v-no-cover', { agreed: ['合同摘要已输出'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'closed', 'agreed 无数字预测覆盖=等待测量，不强制不吻合（Bug-A fix）')
  // 占位词场景：agreed 覆盖了 key 但用占位值 → 不吻合
  d1('v-ph')
  r = convergeStep('v-ph', { agreed: ['字节数: 实测 尚未发生 ≠ 预测（runtime）'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'invalidated', '占位词=假吻合（覆盖了 key 但值是占位）')
  d1('v-ok')
  r = convergeStep('v-ok', { agreed: ['字节数: 实测 14 ≠ 预测 14（runtime node×手算异源）'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'closed')
})

test('dip 饱和语义（smoke2 #A 修复）：at 档 dip 收官不挂账且清同档旧账；improve 谎报照拦；中档 dip 照挂', () => {
  const d = (sid, t, plan) => declareStep(sid, { title: t, predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'dip', dipPlan: plan || 'at 档终局验证动作，无更低可回升——饱和即清偿' })
  declareStep('sat-imp', { title: '谎报improve', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  assert.match(convergeStep('sat-imp', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } }).error, /ΔV 闸未过/, 'at 档 improve 谎报照拦')
  d('sat-dip', '饱和收官')
  const r = convergeStep('sat-dip', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'closed')
  assert.equal(r.step.pendingDip, undefined, '底档 dip 不挂回升义务')
  assert.equal(r.step.dv.mode, 'dip-saturated')
  declareStep('mid-dip', { title: '暂差', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'dip', dipPlan: '下一步回升（far→near）' })
  const rm = convergeStep('mid-dip', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['fs: a', 'rt: b'] } })
  assert.equal(rm.step.pendingDip, true, '中档 dip 回升义务照挂（闸未减弱）')
})

test('v0.3.3 maintain（验证类任务死锁修复）：at→at 合法闭合无回升义务；非 at 档拒；倒退拒；清旧账；at 档 improve 拒绝文教路', () => {
  const dm = (sid) => declareStep(sid, { title: 'T', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'maintain' })
  // 正路：at→at 保持目标态 = 合法 closed，mode=maintain，无 pendingDip
  dm('mn-ok')
  const r = convergeStep('mn-ok', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.step.status, 'closed', 'maintain at→at 闭合')
  assert.equal(r.step.dv.mode, 'maintain')
  assert.notEqual(r.step.pendingDip, true, 'maintain 不挂回升义务')
  // 清旧账：栈上存量 pendingDip 被回 at 饱和口径一并清偿（与 dip-saturated 同口径）
  saveStack('mn-clr', { steps: [{ n: 1, title: '旧挂账', status: 'closed', pendingDip: true, dv: { before: 'near', after: 'near', mode: 'dip' }, agreed: [], discrepancies: [], at: 1 }], rolledBack: [] })
  dm('mn-clr')
  const rc = convergeStep('mn-clr', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } })
  assert.equal(rc.step.status, 'closed')
  assert.equal(loadStack('mn-clr').steps[0].pendingDip, false, 'maintain 回 at 清一切挂账')
  // 拒路①：far/near 档谈保持=逃避改善义务
  dm('mn-far')
  const r1 = convergeStep('mn-far', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r1.ok, false)
  assert.match(r1.error, /maintain 只在 at 档合法/)
  assert.equal(stackTop(loadStack('mn-far')).status, 'open', '拒不落账')
  // 拒路②：measured 掉档=倒退，不配 maintain
  declareStep('mn-bad', { title: 'T', predictions: [{ key: 'v', value: '2', source: 'prior:s2' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] }, vExpect: 'maintain' })
  const r2 = convergeStep('mn-bad', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /倒退/)
  // 教路：at 档 improve 谎报的拒绝文本必须指出 maintain 出路（消灭"只能编 dip 故事"的闹剧）
  declareStep('mn-teach', { title: 'T', predictions: [{ key: 'v', value: '2', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  assert.match(convergeStep('mn-teach', { agreed: ['v: 实测 2 ≠ 预测 2（异源）'], dv: { beforeBand: 'at', measuredBand: 'at', channels: ['fs: a', 'rt: b'] } }).error, /maintain/)
})

test('declare 正常：open 落盘,回执含契约计数（v0.3 需 rolling 段）', async () => {
  const sid = 't-decl-ok'
  makeDev(sid)
  const r = await optimalDeclareDefinition().execute(base('块一'), mkExec(sid))
  assert.match(r.text, /已声明/)
  assert.equal(stackTop(loadStack(sid)).status, 'open')
})

/* ---------- converge 三要素闸 ---------- */
test('converge：缺 dv=拒（ΔV 不报=未验证）', () => {
  const sid = 't-conv-dv'
  declareStep(sid, base('块'))
  assert.match(convergeStep(sid, { agreed: agreeOK, discrepancies: [] }).error, /dv 必填/)
})
test('converge：ΔV 不降（far→far）=拒并提示 re-linearize/dip', () => {
  const sid = 't-conv-flat'
  declareStep(sid, base('块'))
  const r = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['盘档: a', '运行时: b'] } })
  assert.match(r.error, /ΔV 闸未过/)
})
test('converge：通道同源=指向同一测量（换标签不算异源，v0.8 结构判定）', () => {
  const sid = 't-conv-chan'
  declareStep(sid, base('块'))
  const r = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['test-suite: x.mjs', 'production-gate: x.mjs'] } })
  assert.match(r.error, /同源/)
  assert.match(r.error, /换标签不改独立性/)
})
test('converge：同标签不同测量不误杀（旧前缀判定的假阳性已修）', () => {
  const sid = 't-conv-chan2'
  declareStep(sid, base('块'))
  const r = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['runtime: node --test a.mjs', 'runtime: node --test b.mjs'] } })
  assert.equal(r.step.status, 'closed', '两条真实不同的命令=独立，标签相同不拦')
})
test('converge：对账不要求「≠」字形，但实测须等于声明值（v0.8）', () => {
  const sid = 't-conv-num'
  declareStep(sid, base('块'))
  const r = convergeStep(sid, { agreed: ['中心距: 实测 22 预测 22'], discrepancies: [], dv: dvDown })
  assert.equal(r.step.status, 'invalidated', '旧实现只看行内两数互等（可闭声明 77.5 的预测）——此洞已堵')
  assert.match(r.step.discrepancies.join(), /声明值 77\.5/)
})
test('converge：discrepancies 非空 → invalidated（免 dv,结论已定）', () => {
  const sid = 't-conv-bad'
  declareStep(sid, base('块'))
  const r = convergeStep(sid, { agreed: [], discrepancies: ['中心距: 实测 78 vs 预测 77.5'] })
  assert.equal(r.ok, true)
  assert.equal(r.step.status, 'invalidated')
})

/* ---------- V 账本与栈视图 ---------- */
test('converge 三要素全过 → closed + vLedger + V 时间线 + findClosedFor 命中', () => {
  const sid = 't-v-ledger'
  declareStep(sid, base('块'))
  const c = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: dvDown })
  assert.equal(c.step.status, 'closed')
  assert.equal(c.step.vLedger, 'far→near')
  assert.ok(findClosedFor(sid, '块'))
  assert.match(stackText(loadStack(sid)), /档位时间线：#1「块」far→near/)
})

/* ---------- 定理6 反漂移 ---------- */
test('rollback 记签名；同签名重 declare 直拒；改来源放行', () => {
  const sid = 't-antidrift'
  declareStep(sid, base('块X'))
  convergeStep(sid, { agreed: [], discrepancies: ['中心距: 实测 78 vs 77.5'] })
  const rb = rollbackStep(sid, '预测模型错在模数取值,改用实测模数')
  assert.equal(rb.ok, true)
  assert.match(declareStep(sid, base('块X')).error, /既定规则/)
  assert.equal(declareStep(sid, base('块X', 'prior:ISO 1122 修正式')).ok, true)
})

test('r69 对账拒语前置结构口径（执行者不读源码）：无数值实证/与声明不等各有指路句', () => {
  makeDev('t-rule')
  declareStep('t-rule', { title: '规则', predictions: [{ key: '字节数', value: '14', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const dv = { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }
  // v0.8：不再整块拒（无字形要求），改为逐条不吻合——拒语仍必须自带条款
  const r1 = convergeStep('t-rule', { agreed: ['字节数: 已测'], discrepancies: [], dv })
  assert.equal(r1.step.status, 'invalidated')
  assert.match(r1.step.discrepancies.join(), /无数值实证/)
  assert.match(r1.step.discrepancies.join(), /声明值 14/)
  makeDev('t-rule2')
  declareStep('t-rule2', { title: '规则', predictions: [{ key: '字节数', value: '14', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const r2 = convergeStep('t-rule2', { agreed: ['字节数: 实测值 未报告', '其他: 实测 5 ≠ 预测 5（盘: a）'], discrepancies: [], dv })
  assert.equal(r2.step.status, 'invalidated')
  assert.match(r2.step.discrepancies.join(), /无数值实证/)
})

/* ---------- v0.8 结构判定（形状判定→结构判定）新增锁 ---------- */
const sDecl = (sid, key, val) => declareStep(sid, { title: 'S', predictions: [{ key, value: val, source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
const sDv = (a, b) => ({ beforeBand: 'far', measuredBand: 'near', channels: [a, b] })

test('s1 agreedPairs 结构入参零格式仍可闭', () => {
  const sid = 'v08-pairs'
  sDecl(sid, '接口数', '6')
  const r = convergeStep(sid, { agreedPairs: [{ key: '接口数', measured: '6', predicted: '6', channel: 'runtime:node test' }], discrepancies: [], dv: sDv('runtime:node --test a.mjs', 'fs:D:/x/y.js') })
  assert.equal(r.step.status, 'closed')
})
test('s2 无字形单值写法可闭（实测=声明即吻合）', () => {
  const sid = 'v08-single'
  sDecl(sid, '接口数', '6')
  const r = convergeStep(sid, { agreed: ['接口数: 6'], discrepancies: [], dv: sDv('runtime:node --test a.mjs', 'fs:D:/x/y.js') })
  assert.equal(r.step.status, 'closed', '旧实现此处直接整块拒（缺 ≠）——现在只看数值')
})
test('s3 复述换数拦（行内预测与声明不符=措辞层）', () => {
  const sid = 'v08-restamp'
  sDecl(sid, '接口数', '6')
  const r = convergeStep(sid, { agreed: ['接口数: 实测 6 预测 9'], discrepancies: [], dv: sDv('runtime:node --test a.mjs', 'fs:D:/x/y.js') })
  assert.equal(r.step.status, 'invalidated')
  assert.match(r.step.discrepancies.join(), /复述的预测 9 与声明值 6 不符/)
})
test('s4 通道独立性有据（ref 指到路径/命令）入栈记 evidenced=true', () => {
  const sid = 'v08-evidenced'
  sDecl(sid, '接口数', '6')
  const r = convergeStep(sid, { agreed: ['接口数: 6'], discrepancies: [], dv: sDv('runtime:node --test optimal.test.mjs', 'fs:src/optimal-engine.js') })
  assert.equal(r.step.status, 'closed')
  assert.equal(r.step.dv.evidenced, true)
})
test('s5 纯散文通道标注仍可闭，但如实记 evidenced=false（不装有据）', () => {
  const sid = 'v08-prose'
  sDecl(sid, '接口数', '6')
  const r = convergeStep(sid, { agreed: ['接口数: 6'], discrepancies: [], dv: sDv('盘档: 我看了状态', '运行时: 我跑了确认') })
  assert.equal(r.step.status, 'closed')
  assert.equal(r.step.dv.evidenced, false)
})

test('r70 刀二 agreedPairs 结构化对账：对象入参→工具自渲染合规行→零格式战闭步', () => {
  makeDev('t-pairs')
  declareStep('t-pairs', { title: '结构化', predictions: [{ key: '字节数', value: '14', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const r = convergeStep('t-pairs', {
    agreedPairs: [{ key: '字节数', measured: '14', predicted: '14', channel: 'runtime node×手算异源' }],
    discrepancies: [],
    dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] },
  })
  assert.equal(r.step.status, 'closed', JSON.stringify(r.step.discrepancies))
  assert.ok(r.step.agreed.some((a) => a.includes('字节数: 实测 14 ≠ 预测 14')), '渲染行与匹配器合规形全同')
})

test('r71 刀三 师傅层：同型基线+偏差反馈（just-in-time 校准，无史零注入）', async () => {
  const { baselineLine, deviationLine } = await import('../src/optimal-engine.js')
  const steps = [
    { status: 'closed', agreed: ['字节数: 实测 14 ≠ 预测 14（fs）', '行数: 实测 30 ≠ 预测 27（fs）'] },
    { status: 'closed', agreed: ['字节数: 实测 25 ≠ 预测 23（fs）'] },
    { status: 'open', agreed: ['字节数: 实测 99 ≠ 预测 99（fs）'] }, // open 步不入史
  ]
  const st = (await import('../src/optimal-engine.js')).deviationStats(steps, '字节数')
  assert.equal(st.n, 2, '只数已闭步')
  assert.equal(st.last.dev, 2, '上次偏差 实测25-预测23=+2')
  assert.equal(st.meanDev, 1, '均值 (0+2)/2=1')
  const bl = baselineLine(steps, [{ key: '字节数', value: '23' }])
  assert.match(bl, /同型基线「字节数」：上次预测 23 实测 25 偏差 \+2；同类 2 次均值偏差 \+1/, '基线行带可校准数字')
  assert.equal(baselineLine(steps, [{ key: '无史键', value: '1' }]), '', '无史零注入')
  const dl = deviationLine({ agreed: ['行数: 实测 30 ≠ 预测 27（fs）'] })
  assert.match(dl, /本步偏差（实测-预测）：「行数」\+3/, '偏差行数值正确')
  assert.equal(deviationLine({ agreed: ['非数字: 实测 ok ≠ 预测 ok（fs）'] }), '', '非数值对零注入')
})

test('r72 v0.6.34 锚点净化：read: 带括注/反斜杠 不再误拒（P3-3）', async () => {
  const eng = await import('../src/optimal-engine.js')
  const r = eng.checkPredictionSources('t', [{ key: 'k', value: '1', source: 'read:D:/dsh/dsh-closedloop-mode/package.json（本轮 read 实测原文）' }])
  assert.equal(r.ok, true, '括注净化后过（P3-3 案底：括注污染=文件不存在误拒）')
  const r2 = eng.checkPredictionSources('t', [{ key: 'k', value: '1', source: 'read:C:\\dsh\\不存在\\x.mjs' }])
  assert.equal(r2.ok, false)
})

test('r73 v0.6.34 probe -e 早拒指路（P3-2）', async () => {
  const T2 = await import('../src/tools.js')
  await assert.rejects(() => T2.probeRecordDefinition().execute({ key: 'e-inline', cmd: 'execFile:node|-e|console.log(1)' }, { agent: { session: { id: 't-e' } } }), /-e（P3-2 案底/.test ? /P3-2 案底/ : /P3-2 案底|不支持 -e/)
})

test('r74 v0.6.34 组收官提示+档位进度行（P2-1/激励面）', async () => {
  const T2 = await import('../src/tools.js')
  const sid = 't-p21'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  declareStep(sid, { title: 'A', group: 'G', predictions: [{ key: 'k', value: '1', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const r = await T2.optimalConvergeDefinition().execute({ agreedPairs: [{ key: 'k', measured: '1', predicted: '1', channel: 'fs' }], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } }, { agent: { session: { id: sid } } })
  assert.match(r.text, /组「G」动作已全闭合/, 'P2-1 收官提示在回执')
  assert.match(r.text, /档位进度：样本/, '档位进度行在回执')
})

test('r75 v0.6.35 回炉机械分层：真不一致=reasoning；假吻合/占位=transcription；混合保守 reasoning；computeC 分母只计推理层', async () => {
  const eng = await import('../src/optimal-engine.js')
  assert.equal(eng.classifyRollbackLayer(['k: 实测 31 与预测 30 不一致（这是不吻合…）']), 'reasoning')
  assert.equal(eng.classifyRollbackLayer(['k: 假吻合（数值预测需「实测 <A> ≠ 预测 <B>」对…）']), 'transcription')
  assert.equal(eng.classifyRollbackLayer(['k: 假吻合（占位词…）', 'k: 实测 31 与预测 30 不一致']), 'reasoning')
  assert.equal(eng.classifyRollbackLayer([]), 'reasoning', '无记录=保守')
  const { computeC } = await import('../src/rank-organ.js')
  const s = { closed: [{ title: 'a', band: 'near' }], groups: [{ title: 'G', settled: true }], cost: { assertions: [{ text: 'a', severity: 'major', source: 's' }] } }
  const stack = { rolledBack: [{ reason: 'x', layer: 'transcription' }, { reason: 'y', layer: 'reasoning' }] }
  const r = computeC(s, stack)
  assert.equal(r.n, 2, '分母=闭1+推理1（措辞层不计）')
  assert.equal(r.slips, 1, '措辞层轻账计数')
})

test('r76 v0.6.35 摩擦账本：记笔/分布/终检行（只追加）', async () => {
  const { noteFriction, frictionSummary, frictionLine } = await import('../src/friction-organ.js')
  const dir = TMP
  noteFriction('sid-x', 'write-gate', '被拒', dir)
  noteFriction('sid-x', 'write-gate', '被拒2', dir)
  noteFriction('sid-x', 'converge', '格式', dir)
  const s = frictionSummary('sid-x', dir)
  assert.equal(s.total, 3)
  assert.equal(s.byGate['write-gate'], 2)
  assert.match(frictionLine('sid-x', dir), /摩擦账本：本会话被拒 3 次（write-gate×2·converge×1）/)
})

test('r77 v0.6.36 终检行渲染：friction>0 时回执必含摩擦账本行（const 重赋值案底修复——账实相符）', async () => {
  const { noteFriction } = await import('../src/friction-organ.js')
  const T2 = await import('../src/tools.js')
  const sid = 't-term'
  let s = { ...initMode(), stage: 'final', weightsLocked: true, cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: { by: 't' } }], closed: [{ title: 'a1', group: 'G', at: 1, band: 'at' }] }
  saveState(sid, s)
  noteFriction(sid, 'write-gate', '测试', join(TMP, 'graded-state'))
  const r = await T2.terminalCheckDefinition().execute({}, { agent: { session: { id: sid } } })
  assert.match(r.text, /摩擦账本：本会话被拒 1 次（write-gate×1）/, 'friction>0=终检行必现')
  const sid2 = 't-term0'
  saveState(sid2, { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: { by: 't' } }], closed: [{ title: 'a1', group: 'G', at: 1, band: 'at' }] })
  const r2 = await T2.terminalCheckDefinition().execute({}, { agent: { session: { id: sid2 } } })
  assert.ok(!r2.text.includes('摩擦账本'), '零摩擦=零注入')
})

/* ---------- v0.4.4 数值对 raw-token 等值（版串假吻合案底直修） ---------- */
test('v0.4.4 版串 raw 等值闭合（R4 假吻合活案例）/ 占位词对仍拒 / 数字段不等仍拒 / 单位后缀旧行为兼容', () => {
  const mkDecl = (sid) => {
    makeDev(sid)
    declareStep(sid, { title: '版串', predictions: [{ key: '版串', value: 'v0.4.4', source: 'prior:版串形态 v0.4.4（未实测，converge 复验）' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['盘: a', '跑: b'] } })
  }
  const dv = { beforeBand: 'far', measuredBand: 'near', channels: ['盘: 状态 JSON 字段', '跑: 日志测量'] }
  // t1 版串 raw 等值 → closed（旧闸此 case=假吻合 invalidated——R4 案底）
  mkDecl('t-raw1')
  const c1 = convergeStep('t-raw1', { agreed: ['版串: 实测 v0.4.4 ≠ 预测 v0.4.4（探针复跑）'], discrepancies: [], dv })
  assert.equal(c1.step.status, 'closed', JSON.stringify(c1.step.discrepancies))
  // t2 占位词对（raw 等值但全对无数字）→ 仍假吻合（陷阱保留）
  mkDecl('t-raw2')
  const c2 = convergeStep('t-raw2', { agreed: ['版串: 实测 完成 ≠ 预测 完成（盘: x）'], discrepancies: [], dv })
  assert.equal(c2.step.status, 'invalidated')
  assert.match(JSON.stringify(c2.step.discrepancies), /占位词/)
  // t3 复述的预测与声明不符 → 拒（措辞层：实测其实对了，错在换数）
  mkDecl('t-raw3')
  const c3 = convergeStep('t-raw3', { agreed: ['版串: 实测 v0.4.4 ≠ 预测 v0.4.3（盘: x）'], discrepancies: [], dv })
  assert.equal(c3.step.status, 'invalidated')
  assert.match(JSON.stringify(c3.step.discrepancies), /复述的预测 v0\.4\.3 与声明值 v0\.4\.4 不符/)
  // t4 纯数字对旧行为：15≠14 → 不一致
  mkDecl('t-raw4')
  declareStep('t-raw4', { title: '字节', predictions: [{ key: '字节', value: '14', source: 'prior:14（未实测）' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['盘: a', '跑: b'] } })
  const c4 = convergeStep('t-raw4', { agreed: ['字节: 实测 15 ≠ 预测 14（盘: x）'], discrepancies: [], dv })
  assert.equal(c4.step.status, 'invalidated')
  // t5 案底修正（v0.8.1）：声明 v0.4.4 却用「完成 2 处 ×2」自等自闭=假吻合洞，旧闸放行——
  // 新规则实测必须对上**声明值**，自等不行。
  mkDecl('t-raw5')
  const c5 = convergeStep('t-raw5', { agreed: ['版串: 实测 完成 2 处 ≠ 预测 完成 2 处（盘: x）'], discrepancies: [], dv })
  assert.equal(c5.step.status, 'invalidated', '自等自闭已堵：实测须等于声明值')
  assert.match(JSON.stringify(c5.step.discrepancies), /声明值 v0\.4\.4/)
  // t6 单位后缀/词数混排声明值仍可闭（兼容真实写法）
  mkDecl('t-raw6')
  declareStep('t-raw6', { title: '行数', predictions: [{ key: '行数', value: '命中 30', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['盘: a', '跑: b'] } })
  const c6 = convergeStep('t-raw6', { agreed: ['行数: 实测 30 行 ≠ 预测 命中 30（盘: x）'], discrepancies: [], dv })
  assert.equal(c6.step.status, 'closed', JSON.stringify(c6.step.discrepancies))
})

/* ---------- dip 例外与回升义务 ---------- */
test('dip：预声明步 V 不降可闭合但挂 pendingDip；连续 dip 禁止', () => {
  const sid = 't-dip'
  declareStep(sid, { ...base('暂差块'), vExpect: 'dip', dipPlan: '拆旧结构先乱后治,下一块清残差回升' })
  const c = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['盘档: 结构已拆', '运行时: 渲染耗时降'] } })
  assert.equal(c.step.status, 'closed')
  assert.equal(c.step.pendingDip, true)
  assert.equal(c.step.dv.mode, 'dip')
  // 第二步又试 dip 且不降 → 连续 dip 拒
  declareStep(sid, { ...base('又暂差'), vExpect: 'dip', dipPlan: '还想暂差一次试试水' })
  assert.match(convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['盘档: a', '运行时: b'] } }).error, /连续 dip 禁止/)
})
test('dip 清偿：后续改善步闭合后 pendingDip 清除', () => {
  const sid = 't-dip-clear'
  declareStep(sid, { ...base('暂差块'), vExpect: 'dip', dipPlan: '重构 J-curve,下块回升' })
  convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'far', channels: ['盘档: a', '运行时: b'] } })
  declareStep(sid, base('回升块'))
  const c = convergeStep(sid, { agreed: agreeOK, discrepancies: [], dv: { beforeBand: 'far', measuredBand: 'at', channels: ['盘档: 断言全中', '运行时: 测量到位'] } })
  assert.equal(c.step.status, 'closed')
  const st = loadStack(sid).steps.find((x) => x.title === '暂差块')
  assert.notEqual(st.pendingDip, true)
})

/* ---------- 闭合即推进：无推导闭合不得推进（打点位已删，D 拍板彻底化） ---------- */
test('打点位已从导出面消失（tools 无 markTaskDefinition；推导闭合是唯一推进前置）', async () => {
  const tools = await import('../src/tools.js')
  assert.equal(tools.markTaskDefinition, undefined)
})
test('converge 自动落账（v0.3 形变）：closed 入盘档已闭集（原 items.completed 面已随轨迹合同废除）', async () => {
  const sid = 't-auto-mark'
  makeDev(sid)
  const exec = mkExec(sid)
  await optimalDeclareDefinition().execute(base('块一'), exec)
  const c = await optimalConvergeDefinition().execute({ agreed: agreeOK, discrepancies: [], dv: dvDown, group: '组A' }, exec)
  assert.match(c.text, /账面锚点/)
  const cl = loadState(sid).closed.find((x) => x.title === '块一')
  assert.ok(cl && cl.group === '组A' && cl.band === 'near', 'recordClosed 落账齐（title/group/band=实测 after）')
})
test('rollback reason<8 字拒绝；closed 锚点不可撤（v0.3：rolling 段）', async () => {
  const sid = 't-rb'
  makeDev(sid)
  const exec = mkExec(sid)
  await optimalDeclareDefinition().execute(base('块R'), exec)
  await assert.rejects(() => optimalRollbackDefinition().execute({ reason: '短' }, exec), /reason/)
  await optimalConvergeDefinition().execute({ agreed: agreeOK, discrepancies: [], dv: dvDown }, exec)
  await assert.rejects(() => optimalRollbackDefinition().execute({ reason: '想撤一个已闭合锚点不行吧' }, exec), /锚点/)
})

/* ---------- legacy 迁移 + 价值链 ---------- */
test('旧 .predict.json 自动迁移为 .optimal.json 且可读', () => {
  const sid = 't-legacy'
  mkdirSync(join(TMP, 'graded-state'), { recursive: true })
  writeFileSync(join(TMP, 'graded-state', sid + '.predict.json'), JSON.stringify({ steps: [{ n: 1, title: '旧步', invariants: [], predictions: [{ key: 'k', value: '1', source: 'prior:s' }], cost: [], law: [], measure: null, vExpect: 'improve', dipPlan: '', confidence: 'medium', status: 'closed', agreed: [], discrepancies: [], dv: null, signature: 'z', at: 1 }] }))
  const s = loadStack(sid)
  assert.equal(s.steps[0].title, '旧步')
  assert.ok(existsSync(join(TMP, 'graded-state', sid + '.optimal.json')))
})
test('valueChainText：空=[]；3 小类=远档初值', () => {
  assert.equal(valueChainText([]), '')
  const v = valueChainText([{ title: 'a' }, { title: 'b' }, { title: 'c' }])
  assert.match(v, /残差档 \*\*far\(远档\)\*\*/)
})

/* ---------- v0.2 V 账本同源件 ---------- */
const { costBand, vLadderOf } = await import('../src/optimal-engine.js')

test('costBand 边界四点（0→at/1→near/2→near/3→far）', () => {
  assert.equal(costBand(0), 'at')
  assert.equal(costBand(1), 'near')
  assert.equal(costBand(2), 'near')
  assert.equal(costBand(3), 'far')
  assert.equal(costBand(12), 'far')
})

test('vLadderOf：closed 序列+dip 挂账计数（open 步不入列）', () => {
  const steps = [
    { n: 1, title: 'a', status: 'closed', dv: { before: 'far', after: 'near', mode: 'improve' } },
    { n: 2, title: 'b', status: 'closed', dv: { before: 'near', after: 'at', mode: 'dip' }, pendingDip: true },
    { n: 3, title: 'c', status: 'open', dv: null },
  ]
  const l = vLadderOf(steps)
  assert.equal(l.run.length, 2)
  assert.deepEqual(l.run[1], { n: 2, title: 'b', from: 'near', to: 'at', mode: 'dip', pendingDip: true })
  assert.equal(l.dipPending, 1)
  assert.equal(vLadderOf([]).run.length, 0)
})

test('stackText 与 vLadderOf 同源（时间线含挂账注记）', () => {
  const steps = [{ n: 1, title: 'x', status: 'closed', invariants: [], predictions: [], law: [], agreed: [], discrepancies: [], dv: { before: 'far', after: 'near', mode: 'improve' }, pendingDip: true }]
  const t = stackText({ steps })
  assert.match(t, /#1「x」far→near/)
  assert.match(t, /dip 挂账 1 笔/)
})

