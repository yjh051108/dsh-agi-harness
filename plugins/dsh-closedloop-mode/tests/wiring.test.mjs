/**
 * wiring v0.3 测例（判据：加载无错 / a2 全段可逆 / redteam 回执携审材 / audit_record 落账 rounds+1）。
 * 栈与盘档全在临时 DSH_HOME——真盘零接触。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-wire-'))
process.env.DSH_HOME = TMP

const idx = await import('../src/index.js')
const { TOOL_NAMES, scanIntent, auditStat } = idx
const { initMode, controlSurface, onWeightsFreeze, onWeightsConfirmed, onWeightsUnlock, saveState, loadState, markGroupSettled } = await import('../src/mode-state.js')
const { declareStep, convergeStep, loadStack } = await import('../src/optimal-engine.js')
const T = await import('../src/tools.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })

test('p0 fiber 合同：name/十五工具/off 回执/版本在位；index 默认导出完整', () => {
  assert.equal(idx.name, 'dsh-closedloop-mode')
  assert.equal(TOOL_NAMES.length, 15)
  assert.ok(TOOL_NAMES.includes('audit_record') && TOOL_NAMES.includes('cost_audit'))
  assert.ok(TOOL_NAMES.includes('probe_record'))
  assert.ok(TOOL_NAMES.includes('audit_dispatch'))
  assert.ok(TOOL_NAMES.includes('delivery_feedback'))
  assert.equal(typeof idx.apply, 'function')
  assert.deepEqual(idx.default && Object.keys(idx.default).sort(), ['Config', 'apply', 'inject', 'name'])
})

test('p0b audit_dispatch 单卡执行：内置审材+subagent 工具转交指引（回执=子代理最终消息，无需镜像）', async () => {
  const sid = 'audit-honest'
  let s = { ...initMode(), stage: 'brainstorm', task: 't' }
  s = { ...s, cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = onWeightsConfirmed(onWeightsFreeze({ ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }).state)
  saveState(sid, s)
  declareStep(sid, { title: 'A1', predictions: [{ key: 'k', value: '1', source: 'prior:fs 直读' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  convergeStep(sid, { agreed: ['k: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  s = loadState(sid)
  saveState(sid, { ...s, closed: [...(s.closed || []), { title: 'A1', group: 'G', at: 1, band: 'near', audit: null }] })
  const def = T.auditDispatchDefinition()
  const r1 = await def.execute({ title: 'A1' }, exec(sid))
  assert.match(r1.text, /subagent 工具转交/, '卡面指引：subagent 工具转交（fresh 会话直读盘档+内置审材）')
  assert.match(r1.text, /回执即回流/, '回流语义上牌（无需镜像文件）')
  assert.match(r1.text, /回执交 audit_record/, '硬验不变式保留')
  assert.doesNotMatch(r1.text, /程序化拉起/, '不谎报程序化拉起（已废除）')
})

test('p1 意图扫描纯函数：修改优先/确认白名单/长文本拒判', () => {
  assert.equal(scanIntent('确认'), 'approve')
  assert.equal(scanIntent('修改：把第三组拆了'), 'reject')
  assert.equal(scanIntent('先确认——不，修改一下方案'), 'reject', '修改优先')
  assert.equal(scanIntent('随便聊聊今天天气'), null)
  assert.equal(scanIntent('x'.repeat(300)), null)
})

test('p0c 绝对入口（v0.6.31）：环开 persona 首注一次/会话（幂等）+ 启动模式回执任务语（无黑话）', async () => {
  const sid = 'persona-entry'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  declareStep(sid, { title: 'PE', predictions: [{ key: 'k', value: '1', source: 'prior:s' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  const evs = {}
  const ctx = {
    effect: (fn) => { try { fn() } catch { } },
    on: (name, fn) => { evs[name] = fn },
    commands: { register: () => {} },
    tools: { register: () => () => {}, guard: () => () => {} },
    webServer: { register: () => () => {} },
    userQuestions: { ask: async () => ({ answers: [] }) },
  }
  idx.apply(ctx, {})
  const handler = evs['agent/pre-step']
  const agent = { session: { id: sid } }
  const mk = () => ({ messages: [{ role: 'user', content: [{ type: 'text', text: '干活吧' }] }] })
  const d1 = mk()
  await handler({ agent, messages: d1.messages }, async () => d1)
  assert.ok(loadState(sid).injected.has('persona-entry'), '绝对入口键落盘')
  assert.ok(d1.messages.some((x) => x.source?.kind === 'plugin' && String(x.content?.[0]?.text || '').includes('You are here to become great')), 'persona 首注在环开（成长导向）')
  const d2 = mk()
  await handler({ agent, messages: d2.messages }, async () => d2)
  assert.equal(d2.messages.filter((x) => x.source?.kind === 'plugin' && String(x.content?.[0]?.text || '').includes('You are here to become great')).length, 0, '二跑零复读（幂等）')
  const sid2 = 'receipt-lang'
  saveState(sid2, { ...initMode(), stage: 'final' })
  const r = await T.costSetDefinition().execute({ purpose: '绝对入口单回执语言测试目的十二字以上', assertions: [{ text: 'a', severity: 'catastrophic', source: 's' }, { text: 'b', severity: 'minor', source: 's' }] }, exec(sid2))
  assert.match(r.text, /超级任务完成模式已启动/, '启动模式任务语锚')
  assert.match(r.text, /完成条件 2 条（关键 1 · 重要 0 · 一般 1）/, 'severity 人话化')
  assert.ok(!r.text.includes('Q_N'), '黑话 Q_N 禁现')
  assert.ok(!r.text.includes('PERSONA'), 'persona 不再随回执')
  assert.ok(!/catastrophic×|minor×|major×/.test(r.text), 'severity 代码禁现')
})

test('p2 a2 主体：rolling 段『修改』→解锁且已闭账分毫不动（v0.2 缺陷复验）', () => {
  const sid = 'a2-test'
  let s = { ...initMode(), stage: 'brainstorm', task: 't' }
  s = { ...s, cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  s = onWeightsFreeze(s).state
  assert.equal(s.stage, 'weights')
  s = onWeightsConfirmed(s)
  assert.equal(s.stage, 'rolling')
  const r = declareStep(sid, { title: 'A1', predictions: [{ key: 'k', value: '1', source: 'prior:fs 直读' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  assert.equal(r.ok, true)
  convergeStep(sid, { agreed: ['k: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] } })
  s = { ...s, closed: [{ title: 'A1', group: 'G', at: 1, band: 'near', audit: null }] }
  saveState(sid, s)
  // 「修改」到达（rolling 段——v0.2 此处无口）
  const u = onWeightsUnlock(loadState(sid))
  assert.equal(u.weightsLocked, false)
  assert.equal(u.stage, 'brainstorm')
  assert.equal(u.closed.length, 1, '已闭账保留')
  assert.equal(loadStack(sid).steps.filter((x) => x.status === 'closed').length, 1, 'V 账本保留')
})

test('p3 declare 段门与写闸：非 rolling 拒；栈顶 open 换动作拒', async () => {
  const sid = 'gate-test'
  saveState(sid, { ...initMode(), stage: 'weights', cost: { purpose: 'p', assertions: [], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [] , weightsLocked: true })
  const dc = T.optimalDeclareDefinition()
  await assert.rejects(() => dc.execute({ title: 'X', predict: [{ key: 'k', value: 'v', source: 'prior:s' }], channels: ['a', 'b'] }, exec(sid)), /rolling/)
  saveState(sid, { ...loadState(sid), stage: 'rolling' })
  const r1 = await dc.execute({ title: '甲动作', predict: [{ key: 'k', value: 'v', source: 'prior:s' }], channels: ['fs: a', 'rt: b'], group: '' }, exec(sid))
  assert.match(r1.text, /准入=light/)
  await assert.rejects(() => dc.execute({ title: '乙动作', predict: [{ key: 'k', value: 'v', source: 'prior:s' }], channels: ['fs: a', 'rt: b'] }, exec(sid)), /写闸|未闭合/)
  assert.match(r1.text, /beforeBand=far/, '链式量引擎直读')
})

test('p4 redteam 组：converge 回执携机械审材；audit_record 真引文落账 rounds+1', async () => {
  const sid = 'rt-test'
  saveState(sid, {
    ...initMode(), stage: 'rolling', weightsLocked: true, task: 't',
    cost: { purpose: 'p', assertions: [{ text: '质量不降', severity: 'catastrophic', source: '标定' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
    groups: [{ title: 'RG', spec: 'sp', accept: ['ac'], verify: 'redteam', settled: null }],
  })
  const dc = T.optimalDeclareDefinition()
  await dc.execute({ title: 'R1', group: 'RG', predict: [{ key: 'n', value: '命中 1', source: 'prior:fs 直读' }], channels: ['fs: 盘直读', 'rt: 活测'] }, exec(sid))
  const cc = T.optimalConvergeDefinition()
  const rec = await cc.execute({ agreed: ['n: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }, group: 'RG' }, exec(sid))
  assert.match(rec.text, /另头审·引擎备材/, 'redteam 回执携审材')
  assert.match(rec.text, /#\d+「R1」/, '审材含目标切片')
  // 真引文回执 → audit_record 落账 rounds=1（落账门的纯面断言见 p5）
  const raw = fs.readFileSync(path.join(TMP, 'graded-state', 'rt-test.optimal.json'), 'utf8')
  const quote = '"title": "R1"'
  assert.ok(raw.includes(quote) || raw.includes('R1'), '引文素材在盘')
  const ar = T.auditRecordDefinition('audit_record')
  const verdictText = JSON.stringify({ verdict: 'pass', issues: [], quotes: [raw.match(/"title":\s*"R1"/)?.[0] || 'R1'] })
  const okr = await ar.execute({ title: 'R1', verdictText }, exec(sid))
  assert.match(okr.text, /审落账.*pass|rounds=1/, '落账成功')
  const st = loadState(sid)
  assert.equal(st.closed.find((c) => c.title === 'R1').audit.rounds, 1)
})

test('p5 组落账机械门（trySettleGroups 纯面）：redteam 缺审拒落/全审放行→final', () => {
  const steps = [{ title: 'R1', status: 'closed' }]
  let s = { ...initMode(), stage: 'rolling', weightsLocked: true, groups: [{ title: 'RG', spec: '', accept: ['x'], verify: 'redteam', settled: null, closeRequested: true }], closed: [{ title: 'R1', group: 'RG', at: 1, band: 'at', audit: null }] }
  let r = T.trySettleGroups(s, steps)
  assert.equal(r.state.groups[0].settled, null, '缺审不落账')
  assert.match(r.notes.join(), /redteam 门未过/)
  s = r.state
  s.closed[0].audit = { rounds: 1, last: { verdict: 'pass' } }
  r = T.trySettleGroups(s, steps)
  assert.ok(r.state.groups[0].settled, '过审落账')
  assert.equal(r.state.stage, 'final', '全组落账→final（机械）')
})

test('p5b user 硬签收门（r64）：无真人帧签收不落账，「签收 RG」真人帧放行，plugin 帧/模型自写不算', () => {
  const steps = [{ title: 'U1', status: 'closed' }]
  const mk = () => ({ ...initMode(), stage: 'rolling', weightsLocked: true, groups: [{ title: 'RG', spec: '', accept: [], verify: 'user', settled: null, closeRequested: true }], closed: [{ title: 'U1', group: 'RG', at: 1, band: 'at' }] })
  let s = mk()
  let r = T.trySettleGroups(s, steps, new Set())
  assert.equal(r.state.groups[0].settled, null, '无签收不落账')
  assert.match(r.notes.join(), /user 门未过/)
  // 判类器面：真人帧提取、plugin/goal 帧的"签收"一律不收
  const signs = T.collectUserSigns([
    { role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: '签收 假装组' }] },
    { role: 'user', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '签收 RG，辛苦了' }] },
    { role: 'assistant', source: { kind: 'user', rpcId: 'r0' }, content: [{ type: 'text', text: '签收 假role组' }] },
  ])
  assert.ok(signs.has('RG') && !signs.has('假装组') && !signs.has('假role组'), '只认真人 user 帧')
  r = T.trySettleGroups(s, steps, signs)
  assert.ok(r.state.groups[0].settled, '真人签收后落账')
  const all = T.collectUserSigns([{ role: 'user', source: { kind: 'user', rpcId: 'r2' }, content: [{ type: 'text', text: '签收全部' }] }])
  s = mk()
  r = T.trySettleGroups(s, steps, all)
  assert.ok(r.state.groups[0].settled, '「签收全部」通配')
})

test('p6 零判定拷贝（accept 红线）：接线层无引擎判定串', () => {
  for (const f of ['tools.js', 'index.js']) {
    const src = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
    for (const banned of ['channels.length < 2', 'dipPlan.length', 'rolledBack', 'pendingDip ===', 'signature ===']) {
      assert.equal(src.includes(banned), false, `${f} 含引擎判定拷贝: ${banned}`)
    }
  }
})

test('p7 认领制：回执承载引导即认领（同键注入静默），新键才注入——消灭双通道重复', async () => {
  const eng = await import('../src/optimal-engine.js')
  const sid = 'claim-1'
  saveState(sid, { ...initMode(), stage: 'rolling', weightsLocked: true, cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 's' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true }, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] })
  const dc = T.optimalDeclareDefinition()
  const cc = T.optimalConvergeDefinition()
  await dc.execute({ title: 'c1', group: 'G', predict: [{ key: 'v', value: '1', source: 'prior:s' }], channels: ['fs: a', 'rt: b'] }, exec(sid))
  await cc.execute({ agreed: ['v: 实测 1 ≠ 预测 1（异源）'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }, group: 'G' }, exec(sid))
  assert.equal(idx.faceDecision(loadState(sid), eng.stackTop(eng.loadStack(sid))).inject, false, '收盘回执已认领当前键→注入静默')
  await dc.execute({ title: 'c2', group: 'G', predict: [{ key: 'v', value: '2', source: 'prior:s' }], channels: ['fs: c', 'rt: d'] }, exec(sid))
  assert.equal(idx.faceDecision(loadState(sid), eng.stackTop(eng.loadStack(sid))).inject, true, '新动作=新键→注入恢复（补缝职责仍在）')
})

test('p8 v0.4.1-F1：autoConfirm=true freeze 直认不弹窗（修 0.3.2 弹窗劫持授权）；off 恢复弹窗主权', async () => {
  fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: true }), 'utf8')
  const sid = 'f1-test'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsFreeze(s).state)
  let popupCalls = 0
  const fr = T.freezeDefinition({ askUser: async () => { popupCalls++; return { answers: [{ selected: ['确认'] }] } } })
  const r1 = await fr.execute({}, exec(sid))
  assert.equal(popupCalls, 0, 'autoConfirm=true 不弹窗（授权高于弹窗）')
  assert.match(r1.text, /autoConfirm 直认/)
  assert.equal(loadState(sid).stage, 'rolling', '本调用内直认开快环（零阻塞项）')
  assert.match(JSON.stringify(loadState(sid).scanLog || {}), /freeze-direct/, '直认留痕')
  assert.equal(loadState(sid).freezeAck?.via, 'autoConfirm-direct', 'freezeAck 独立留痕')
  // F1 补回归：pre-step 扫描覆盖 scanLog 单槽后，freezeAck 不冲（live 场景：freeze 后下一条用户消息触发扫描覆盖）
  saveState(sid, { ...loadState(sid), scanLog: { at: Date.now(), len: 2, intent: 'approve', stage: 'rolling', head: '继续' } })
  assert.equal(loadState(sid).freezeAck?.via, 'autoConfirm-direct', 'scanLog 被扫描覆盖后 freezeAck 仍持久')
  // off=恢复弹窗主权（用户主权段不丢）
  fs.writeFileSync(path.join(TMP, 'graded-settings.json'), JSON.stringify({ autoConfirm: false }), 'utf8')
  const sid2 = 'f1-test2'
  let s2 = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s2 = { ...s2, groups: [{ title: 'G', spec: 'sp', accept: ['ac'], verify: 'self', settled: null }] }
  saveState(sid2, onWeightsFreeze(s2).state)
  const r2 = await fr.execute({}, exec(sid2))
  assert.equal(popupCalls, 1, 'autoConfirm=false 走弹窗通道')
  assert.match(r2.text, /UI 确认/)
  assert.equal(loadState(sid2).stage, 'rolling')
})

test('p9 v0.4.1-F2：测量读数失败诊断携脚本 stdout 尾行（真实 FAIL 原因，非截断命令）', () => {
  const probe = path.join(TMP, 'f2fail.mjs')
  fs.writeFileSync(probe, 'console.log("ok line"); console.log("FAIL: custom marker abc123"); process.exit(1);\n', 'utf8')
  const s = { cost: { assertions: [{ text: 't', severity: 'major', source: 's', measure: { cmd: `node "${probe}"`, kind: 'bool' } }] } }
  const vr = T.measureReads(s)
  assert.equal(vr.errs.length, 1, '读数失败入 errs')
  assert.match(vr.errs[0], /custom marker abc123/, '诊断携脚本尾行')
})

test('p10 v0.4.1-F5：audit_record 审后重测 V 重锚（vAfterAudit），闭合值 v 不可变；round-trip 键不漂移', async () => {
  const sid = 'f5-test'
  const probe = path.join(TMP, 'f5probe.mjs')
  fs.writeFileSync(probe,
    `import { readFileSync } from 'node:fs'\n` +
    `const d = JSON.parse(readFileSync(${JSON.stringify(path.join(TMP, 'graded-state', 'f5-test.closedloop.json'))}, 'utf8'))\n` +
    `const hit = (d.closed || []).find((c) => c.title === 'R5')\n` +
    `process.exit(hit && hit.audit && hit.audit.last && hit.audit.last.verdict === 'pass' ? 0 : 1)\n`, 'utf8')
  saveState(sid, {
    ...initMode(), stage: 'rolling', weightsLocked: true, task: 't',
    cost: { purpose: 'p', assertions: [{ text: '审过', severity: 'catastrophic', source: '标定', measure: { cmd: `node "${probe}"`, kind: 'bool' } }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
    groups: [{ title: 'RG', spec: 'sp', accept: ['ac'], verify: 'redteam', settled: null }],
  })
  const dc = T.optimalDeclareDefinition()
  await dc.execute({ title: 'R5', group: 'RG', predict: [{ key: 'n', value: '1', source: 'prior:fs 直读' }], channels: ['fs: 盘直读', 'rt: 活测'] }, exec(sid))
  const cc = T.optimalConvergeDefinition()
  const rec = await cc.execute({ agreed: ['n: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }, group: 'RG' }, exec(sid))
  assert.match(rec.text, /实测计分=4/, '闭合时刻审未落→z=0→V=4（w=4）')
  const raw = fs.readFileSync(path.join(TMP, 'graded-state', 'f5-test.optimal.json'), 'utf8')
  const ar = T.auditRecordDefinition('audit_record')
  const okr = await ar.execute({ title: 'R5', verdictText: JSON.stringify({ verdict: 'pass', issues: [], quotes: [raw.match(/"title":\s*"R5"/)?.[0] || 'R5'] }) }, exec(sid))
  assert.match(okr.text, /V 重锚=0/, '审后重测 V=0 重锚回执')
  const st = loadState(sid)
  const hit = st.closed.find((c) => c.title === 'R5')
  assert.equal(hit.v, 4, '闭合值 v 不可变（历史）')
  assert.equal(hit.vAfterAudit, 0, '审后重锚值落档')
  const { serializeState, deserializeState } = await import('../src/mode-state.js')
  assert.deepEqual(deserializeState(JSON.parse(JSON.stringify(serializeState(st)))), st, 'vAfterAudit round-trip 严格等值（键不漂移）')
})

test('p11 v0.4.1-F5 bootstrap 边缘：锚断言依赖锚在位 → 两通重测收敛稳定零（单通会留下自身权重）', async () => {
  const sid = 'f5b-test'
  const probe = path.join(TMP, 'f5bprobe.mjs')
  fs.writeFileSync(probe,
    `import { readFileSync } from 'node:fs'\n` +
    `const d = JSON.parse(readFileSync(${JSON.stringify(path.join(TMP, 'graded-state', 'f5b-test.closedloop.json'))}, 'utf8'))\n` +
    `const hit = (d.closed || []).find((c) => c.title === 'RB')\n` +
    `process.exit(hit && typeof hit.vAfterAudit === 'number' ? 0 : 1)\n`, 'utf8')
  saveState(sid, {
    ...initMode(), stage: 'rolling', weightsLocked: true, task: 't',
    cost: { purpose: 'p', assertions: [{ text: '锚在位', severity: 'catastrophic', source: '标定', measure: { cmd: `node "${probe}"`, kind: 'bool' } }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true },
    groups: [{ title: 'RG', spec: 'sp', accept: ['ac'], verify: 'redteam', settled: null }],
  })
  const dc = T.optimalDeclareDefinition()
  await dc.execute({ title: 'RB', group: 'RG', predict: [{ key: 'n', value: '1', source: 'prior:fs 直读' }], channels: ['fs: 盘直读', 'rt: 活测'] }, exec(sid))
  const cc = T.optimalConvergeDefinition()
  await cc.execute({ agreed: ['n: 实测 1 ≠ 预测 1(fs)'], dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] }, group: 'RG' }, exec(sid))
  const raw = fs.readFileSync(path.join(TMP, 'graded-state', 'f5b-test.optimal.json'), 'utf8')
  const ar = T.auditRecordDefinition('audit_record')
  await ar.execute({ title: 'RB', verdictText: JSON.stringify({ verdict: 'pass', issues: [], quotes: [raw.match(/"title":\s*"RB"/)?.[0] || 'RB'] }) }, exec(sid))
  const hit = loadState(sid).closed.find((c) => c.title === 'RB')
  assert.equal(hit.v, 4, '闭合值不变')
  assert.equal(hit.vAfterAudit, 0, '两通重测收敛稳定零（bootstrap 边缘闭合）')
})

test('p12 v0.4.5 语义错配三补丁：probe 携 stderr 病因 / 静默失败当场提示 / cost_set dry-run 纪律行（挂 measure 才有=零仪式税）', async () => {
  const sid = 'p12'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: '验证三补丁回归（十二字以上）', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: true, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  const pr = T.probeRecordDefinition()
  const f1 = path.join(TMP, 'p12-stderr.mjs')
  fs.writeFileSync(f1, "console.error('p12-boom-visible')\nprocess.exit(2)\n", 'utf8')
  const r1 = await pr.execute({ key: 'p12e', cmd: `node "${f1}"` }, exec(sid))
  assert.match(r1.text, /\[stderr\][\s\S]*p12-boom-visible/, 'stderr 病因入回执与台账（R3 空 output 案底直修）')
  const f2 = path.join(TMP, 'p12-silent.mjs')
  fs.writeFileSync(f2, 'process.exit(3)\n', 'utf8')
  const r2 = await pr.execute({ key: 'p12s', cmd: `node "${f2}"` }, exec(sid))
  assert.match(r2.text, /彻底静默失败.*直跑/, 'stdout/stderr 皆空=当场提示定位路径')
  const cs = T.costSetDefinition()
  const r3 = await cs.execute({ purpose: '验证 dryNote 退役后回执干净（挂 measure）十二字以上', assertions: [{ text: 'a', severity: 'major', source: 'x', measure: { cmd: 'node x', kind: 'bool' } }], nonGoals: [], nonGoalsConfirmed: true }, exec('p12-c1'))
  assert.doesNotMatch(r3.text, /dry-run 纪律/, 'v0.5.9 退役：纪律已升成真闸（报错=拒挂），条款住进拒绝文本不再复读（教育=违规事件）')
  const r4 = await cs.execute({ purpose: '无 measure 断言时回执同样无纪律行反向位验证', assertions: [{ text: 'b', severity: 'major', source: 'x' }], nonGoals: [], nonGoalsConfirmed: true }, exec('p12-c2'))
  assert.doesNotMatch(r4.text, /dry-run 纪律/, '无 measure=静默（零仪式税）')
})

test('p13 首轮漏事件兜底：仅 pre-step 也必须在生成前自动入环并注入第一拍', async () => {
  const sid = 'first-turn-fallback'
  const evs = {}
  const ctx = {
    effect: (fn) => { try { fn() } catch {} },
    on: (name, fn) => { evs[name] = fn },
    commands: { register: () => {} },
    tools: { register: () => () => {}, guard: () => () => {} },
    webServer: { register: () => () => {} },
    userQuestions: { ask: async () => ({ answers: [] }) },
  }
  idx.apply(ctx, {}) // 默认 autoStart=true；故意不触发 session/event
  const decision = { messages: [{ role: 'user', source: { kind: 'user', rpcId: 'human-1' }, content: [{ type: 'text', text: '请从零实现一个完整的网页交互项目并自行测试交付' }] }] }
  await evs['agent/pre-step']({ agent: { session: { id: sid } }, messages: decision.messages }, async () => decision)
  const injected = decision.messages.filter((m) => m.source?.kind === 'plugin').map((m) => String(m.content?.[0]?.text || '')).join('\n')
  assert.equal(loadState(sid).stage, 'brainstorm', '首轮在模型生成前已入环')
  assert.match(injected, /GROWTH_LOAD/, '人格已进入首轮上下文')
  assert.match(injected, /超级任务完成模式·第一拍/, '先看工具、索取缺料的第一拍已进入首轮上下文')
  assert.match(injected, /super_task_completion_mode/, '首拍点名入口工具名（不留给模型猜）')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
