/**
 * hardening.test — v0.5.9 生产硬化回归（六红逐条钉死）
 * h1 dryNote 退役；h2 DISC_BUDGET_MS=45000；h3 报错拒绝文本自带 tips（教育=违规事件）；
 * h4 RANK_CAL 滞回带性质（降<升，带宽正）；h5 配额常量；h6 轮转槽≥2 且 hash 16 位；h7 人判挂账可见性
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tools = readFileSync(new URL('../src/tools.js', import.meta.url), 'utf8')
const rank = await import('../src/rank-organ.js')
const quota = await import('../src/quota-organ.js')
const rot = await import('../src/audit-rotation.js')

test('h1 dryNote 冗余文本已退役（纪律住进闸与拒绝文本，不复读）', () => {
  assert.doesNotMatch(tools, /dry-run 纪律（挂合同前/)
})

test('h2 判别力闸总预算存在且=45s（宿主事件循环保护）', async () => {
  const T = await import('../src/tools.js')
  assert.equal(T.DISC_BUDGET_MS, 45000)
  assert.match(tools, /DISC_BUDGET_MS - \(Date\.now\(\) - t0\)/, '预算须在循环内真实扣减')
})

test('h3 报错拒绝文本自带定位 tips（教育=违规事件）', () => {
  assert.match(tools, /tips：①路径实测勿猜仓根/)
  assert.match(tools, /跑不了≠跑了红/)
})

test('h4 RANK_CAL 滞回带性质：降点<升点（带宽为正，防抖）且样本门>0', () => {
  const C = rank.RANK_CAL
  assert.ok(C.down1 < C.up1 && C.down2 < C.up2, `滞回带反了 ${JSON.stringify(C)}`)
  assert.ok(C.up1 < C.up2 && C.minSamples >= 1)
})

test('h5 配额常量与诚实标注在位', () => {
  assert.equal(quota.STALE_MS, 600000)
  assert.ok(quota.QUOTA_BUDGET >= 2048)
})

test('h6 审计轮转：槽位≥2、模板 hash 16 位定长', () => {
  assert.ok(rot.AUDITOR_SLOTS.length >= 2)
  assert.equal(rot.templateHash('anything').length, 16)
})

test('h7 人判欠据落账/终检可见（信任声明不冒充已验证）', () => {
  // v0.8.31 口径换血（池核案底）：人判项从「挂账可审计」改成「欠据必须真人签收」——旧字样不得复活
  assert.match(tools, /人判欠据/)
  assert.match(tools, /待开发者签收/)
  assert.match(tools, /未归零：/)
  assert.ok(!/人判挂账/.test(tools), '「挂账」=可放行口径，已废（池核案：7 条人判挂账后照样交付完成）')
})

test('h8 PERSONA 启动人格单源(persona.js 薄面合同不破)+接线绝对入口（v0.6.31：环开首注，不再随 cost_set 回执）', async () => {
  const it = await import('../src/inject-text.js')
  assert.ok(!('PERSONA' in it), 'inject-text 薄面：PERSONA 不得入（讲课件零复活闸）')
  const pe = await import('../src/persona.js')
  assert.match(pe.PERSONA, /GROWTH_LOAD/)
  const L = pe.PERSONA.split('\n').length
  assert.ok(L >= 6 && L <= 9, '标题+自然语句数行（r68 用户定向：英文自然语句，6-9 行）')
  assert.ok(!/MODE=INCREMENTAL|PREPARE_FIRST（|MEASURE_NOT_VIBE（/.test(pe.PERSONA), 'KEY=VALUE 戏服不得复活（用户判决：那是角色扮演）')
  assert.match(tools, /超级任务完成模式已启动/, '启动模式回执任务语')
  assert.ok(!/PERSONA \+/.test(tools), 'persona 不再随 cost_set 回执（绝对入口迁移）')
  const ix = await import('../src/index.js')
  assert.ok(String(ix.apply).includes("persona-entry"), '绝对入口幂等键在环开注入位')
})
