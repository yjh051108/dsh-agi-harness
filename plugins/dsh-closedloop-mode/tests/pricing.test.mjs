/**
 * pricing.test — v0.6.0 影子定价账本回归（仿真的工程镜像）
 * z1 观测纯函数：dV/时距/回炉过滤（外部归因不进）；z2 dV≤0 拒收（测量内核说了算）；
 * z3 成本分解记忆：巨灾不被淡忘（Laplace 长记忆——round7 案底的正例锁）；z4 回退链冷启动；
 * z5 shadowC 口径；z6 切换判据三段（records/覆盖/双窗）+ 棘轮单向
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

const P = await import('../src/pricing-organ.js')

const stack = (steps, rb) => ({ steps: steps.map((x) => (typeof x === 'number' ? { at: x } : x)), rolledBack: rb || [] })

test('z1 observeSession：dV=Σ正降幅+V₀ 相对；外部回炉不进 rework', () => {
  const s = { closed: [{ title: '甲', v: 0.5, J: { dtMin: 10 } }, { title: '乙', v: 0.2, J: { dtMin: 6 } }] }
  const st = stack([{ at: 1e12, title: '甲' }, { at: 1e12 + 60000 * 20, title: '乙' }], [{ at: 1e12 + 600000, reason: 'process-death auto-settle' }, { at: 1e12 + 600000, reason: '预测模型错' }])
  const o = P.observeSession(s, st, 1e12 + 60000 * 60)
  assert.ok(Math.abs(o.dV - (0.5 + 0.3)) < 1e-9, `dV=${o.dV} 应=0.5(首降自V0=1→0.5)+0.3`)
  assert.equal(o.rbCount, 1, '外部归因被剔')
  assert.equal(o.g, 2)
  assert.equal(o.fragRed, false)
  assert.ok(Math.abs(o.dtMin - 16) < 0.1, `dtMin=${o.dtMin} 应=ΣJ步窗和 10+6=16（校准1a：busy 口径优先，非墙钟 60）`)
})

test('z8 校准1b：故意验闸回炉（虚报/复测字样）不喂定价账，案底留卷', () => {
  const s = { closed: [{ title: '甲', v: 0.4, J: { dtMin: 5 } }] }
  const st = stack([{ at: 1e12, title: '甲' }], [
    { at: 1e12 + 60000, title: '甲', reason: 're-linearize：E2E 验证完成撤虚报步' },
    { at: 1e12 + 120000, title: '甲', reason: 're-linearize：预测模型错' },
  ])
  const o = P.observeSession(s, st, 1e12 + 60000 * 30)
  assert.equal(o.rbCount, 1, '验闸回炉被剔，真回炉保留')
})

test('z7 跨单隔离+回退口径：无 J 老单走墙钟窗（只看本票命中步），有 J 走步窗和', () => {
  const sNoJ = { closed: [{ title: '新甲', v: 0.4 }] }
  const st = stack([{ at: 1e12, title: '历史单步' }, { at: 1e12 + 60000 * 500, title: '新甲' }], [])
  const o = P.observeSession(sNoJ, st, 1e12 + 60000 * 510)
  assert.ok(o.dtMin < 11 && o.dtMin > 9, `dtMin=${o.dtMin} 应≈10min（本票墙钟窗，历史不拉窗）`)
  const sJ = { closed: [{ title: '新甲', v: 0.4, J: { dtMin: 2.5 } }] }
  const o2 = P.observeSession(sJ, st, 1e12 + 60000 * 510)
  assert.equal(o2.dtMin, 2.5, 'J 在位走步窗和（busy 口径优先）')
})

test('z2 dV≤0 拒进账（残差会话不配成本记账——构造分离）', () => {
  const p = P.initPricing()
  const r = P.recordSession(p, { g: 2, dtMin: 10, dV: 0, reworkMin: 0, fragRed: false })
  assert.match(r.rejected, /测量内核/)
  assert.equal(p.gates.records, 0)
})

test('z3 灾难不被淡忘：30 个清洁样本后失败率仍拉得动期望（Laplace 长记忆 vs 纯 EMA 案底正例）', () => {
  const p = P.initPricing()
  for (let i = 0; i < 30; i++) P.recordSession(p, { g: 3, dtMin: 20, dV: 1, reworkMin: 0, fragRed: false })
  P.recordSession(p, { g: 3, dtMin: 20, dV: 1, reworkMin: 200, fragRed: false }) // 一记巨灾
  for (let i = 0; i < 30; i++) P.recordSession(p, { g: 3, dtMin: 20, dV: 1, reworkMin: 0, fragRed: false })
  const est = P.estimate(p, 3)
  // 判别线：纯 EMA 世界此处≈21.3（巨灾半衰后残留）；分解记忆=clean≈20 + Laplace(2/63)·200≈26.3——
  // 断言 est≥24 才算"灾难残影活着"（阈值取两模型判别的中间偏保守位，非拟合到刚好过）
  assert.ok(est >= 24, `期望成本 ${est} 未含灾难残影（纯 EMA 会压回 ~21）`)
})

test('z4 回退链：冷启动桶<8 用全局粗估，双桶未熟返回 null', () => {
  const p = P.initPricing()
  assert.equal(P.estimate(p, 3), null, '无账=null（不装知道）')
  for (let i = 0; i < 4; i++) P.recordSession(p, { g: 3, dtMin: 10, dV: 1, reworkMin: 0, fragRed: false })
  assert.equal(P.estimate(p, 3), null, '样本门 8 未过且无他桶=null')
  for (let i = 0; i < 10; i++) P.recordSession(p, { g: 8, dtMin: 30, dV: 1, reworkMin: 0, fragRed: false })
  const e = P.estimate(p, 3)
  assert.ok(e != null && e > 0, '他桶≥2 给全局粗估（标注级）')
})

test('z5 shadowC：按最优预期=2.0 满分口径，劣于期望递减', () => {
  const p = P.initPricing()
  for (let i = 0; i < 10; i++) P.recordSession(p, { g: 4, dtMin: 20, dV: 1, reworkMin: 0, fragRed: false })
  const good = P.shadowC(p, 4, 20, 1)
  const bad = P.shadowC(p, 4, 80, 1)
  assert.ok(good > bad && good <= 2 && bad >= 0, `good=${good} bad=${bad}`)
})

test('z9 健康判据（④活体半区）：强相关不误判、乱相关报警、样本不足不瞎判', () => {
  const p = P.initPricing()
  assert.equal(P.evaluateHealth(p).ok, true, '空账=不瞎判')
  const good = Array.from({ length: 40 }, (_, i) => ({ shadowC: i, trueQ: i + (i % 3), band: '3-5' })) // r33 样本门后合成票需带多步 band 戳（生产语义：玩具单不配证）
  p.pairs = good
  assert.equal(P.evaluateHealth(p).ok, true, '影子-真值同向=健康')
  p.pairs = Array.from({ length: 40 }, (_, i) => ({ shadowC: i, trueQ: (i * 7919) % 40 }))
  const bad = P.evaluateHealth(p)
  assert.equal(bad.ok, false, '乱序必须报警（回影子的扳机）')
  assert.match(bad.note, /秩相关=/)
})

test('z10 simSick 双通道 AND 门（r23 机制 r26 补锁）：仿真报病时全绿也不切', () => {
  const p = P.initPricing()
  p.gates.records = 300; p.gates.coverage = 0.95
  p.simSick = 1234567890
  const pairs = Array.from({ length: 40 }, (_, i) => ({ shadowC: i, trueQ: i + (i % 3), band: '3-5' }))
  const sw = P.evaluateSwitch(p, pairs)
  assert.equal(sw.real, false, 'sim 病时不得切实价')
  assert.match(sw.note, /simSick/)
  delete p.simSick
  const sw2 = P.evaluateSwitch(p, pairs)
  assert.equal(sw2.real, true, '病愈且实数据达标=可切（AND 门两项齐才开）')
})

test('z11 learningContent 单语义（r30 口径歧义收口）：本店历史回炉不算，本单回炉才算', () => {
  const t0 = 1e12
  const s = { closed: [{ title: '唯一一步', at: t0 + 60000, J: { dtMin: 1 } }] } // 单步短票
  const legacyRb = { steps: [], rolledBack: [{ at: t0 - 99 * 864e5, reason: 're-linearize：旧单某回炉' }] } // 本店陈账
  const ownRb = { steps: [], rolledBack: [{ at: t0 + 120000, reason: 're-linearize：本单预言失效' }] } // 本单新案
  assert.equal(P.learningContent(s, legacyRb), false, '陈年回炉不该点亮草稿（r30 歧义正解）')
  assert.equal(P.learningContent(s, ownRb), true, '本单回炉=有学习含量')
})

test('z12 仪式带样本锁（r33）：单步票灌满 300 也不切——多步带 <30 判据无据', () => {
  const p = P.initPricing()
  p.gates.records = 300; p.gates.coverage = 0.95
  p.pairs = Array.from({ length: 300 }, (_, i) => ({ shadowC: i, trueQ: i + (i % 3), band: '1-2' }))
  let sw = P.evaluateSwitch(p, p.pairs)
  assert.equal(sw.real, false, '纯仪式带不得切实价')
  assert.match(sw.note, /多步样本不足/)
  p.pairs.push(...Array.from({ length: 30 }, (_, i) => ({ shadowC: i, trueQ: i + (i % 2), band: '3-5' })))
  sw = P.evaluateSwitch(p, p.pairs)
  assert.equal(sw.real, true, '多步带满 30 后阀门开（其余门仍要全绿）')
})

test('z6 切换判据三段门+达标切实+棘轮不回退', () => {
  const p = P.initPricing()
  const pairs = (n, rho) => Array.from({ length: n }, (_, i) => ({ shadowC: i, trueQ: rho * i + (i % 2 ? 0.4 : -0.4), band: '3-5' }))
  let sw = P.evaluateSwitch(p, [])
  assert.equal(sw.real, false); assert.match(sw.note, /records=/)
  p.gates.records = 300; p.gates.coverage = 0.95
  sw = P.evaluateSwitch(p, pairs(40, 0)) // 乱序双窗 → 不放行
  assert.equal(sw.real, false); assert.match(sw.note, /双窗=/)
  sw = P.evaluateSwitch(p, pairs(40, 10)) // 强相关双窗 → 自动切（无人闸）
  assert.equal(sw.real, true)
  assert.ok(typeof p.cutoverAt === 'number' && p.cutoverAt > 0, '切点已打表（体检窗起点）')
  const s2 = P.evaluateSwitch(p, pairs(40, 0))
  assert.equal(s2.real, true, '棘轮：切实后不因单轮回溯翻烧（回退需盘上反向判据，v1 不设）')
})
