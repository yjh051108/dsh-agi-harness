/**
 * scope.test — v0.8.7 预设作用域：默认 all 恒真（零变化）；presets 模式按 agentPreset 过滤（fail-closed）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetAllowed } from '../src/scope.js'

test('s1 默认 all（含未配置/空配置）恒真——现有用户零变化', () => {
  const s = { agentPreset: 'router-standard' }
  assert.equal(presetAllowed(s, undefined), true, '无配置=全局')
  assert.equal(presetAllowed(s, {}), true, '空配置=全局')
  assert.equal(presetAllowed(s, { presetScope: 'all' }), true, '显式 all=全局')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, { presetScope: 'all' }), true)
})

test('s2 presets 模式：按 agentPreset 过滤，缺字段 fail-closed，大小写敏感直等', () => {
  const cfg = { presetScope: 'presets', presets: ['closedloop-full'] }
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, cfg), true, '名单内=启用')
  assert.equal(presetAllowed({ agentPreset: 'router-standard' }, cfg), false, '名单外=静默')
  assert.equal(presetAllowed({}, cfg), false, '无 preset 字段=fail-closed')
  assert.equal(presetAllowed(undefined, cfg), false, '无会话=静默')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, { presetScope: 'presets', presets: [] }), false, '空名单=全静默')
})
