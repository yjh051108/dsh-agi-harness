/**
 * scope.test — v0.8.7 预设作用域：默认 all 恒真（零变化）；presets 模式按 agentPreset 过滤（fail-closed）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-scope-')) // 活值文件全程临时（真盘零接触）
import { presetAllowed, effectiveScopeConfig, setLiveScope, validateScopeValue, writeScopeFile, liveScopeFromFile } from '../src/scope.js'

test('s1 默认 all（含未配置/空配置）恒真——现有用户零变化', () => {
  const s = { agentPreset: 'router-standard' }
  assert.equal(presetAllowed(s, undefined), true, '无配置=全局')
  assert.equal(presetAllowed(s, {}), true, '空配置=全局')
  assert.equal(presetAllowed(s, { presetScope: 'all' }), true, '显式 all=全局')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, { presetScope: 'all' }), true)
})

test('s3 设置页活值优先于挂载 config（进程覆盖，清空回退）', () => {
  setLiveScope({ presetScope: 'presets', presets: ['closedloop-full'] })
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, effectiveScopeConfig({ presetScope: 'all' })), true, '活值收紧生效（挂载 all 被覆盖）')
  assert.equal(presetAllowed({ agentPreset: 'other' }, effectiveScopeConfig({ presetScope: 'all' })), false)
  setLiveScope(null)
  assert.equal(effectiveScopeConfig({ presetScope: 'presets', presets: ['x'] }).presetScope, 'presets', '清活值回退挂载 config')
  setLiveScope(() => ({ presetScope: 'presets', presets: ['closedloop-full'] }))
  assert.equal(presetAllowed({ agentPreset: 'other' }, effectiveScopeConfig({ presetScope: 'all' })), false, '函数形状（installSection setSource）同样生效')
  setLiveScope(null)
})

test('s4 validateScopeValue：非法值拒写（不污染活值）', () => {
  assert.doesNotThrow(() => validateScopeValue({ presetScope: 'all', presets: [] }))
  assert.throws(() => validateScopeValue({ presetScope: 'weird', presets: [] }), /all\|presets/)
  assert.throws(() => validateScopeValue({ presetScope: 'presets', presets: ['  '] }), /非空字符串/)
  assert.throws(() => validateScopeValue(null), /对象/)
})

test('s2 presets 模式：按 agentPreset 过滤，缺字段 fail-closed，大小写敏感直等', () => {
  const cfg = { presetScope: 'presets', presets: ['closedloop-full'] }
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, cfg), true, '名单内=启用')
  assert.equal(presetAllowed({ agentPreset: 'router-standard' }, cfg), false, '名单外=静默')
  assert.equal(presetAllowed({}, cfg), false, '无 preset 字段=fail-closed')
  assert.equal(presetAllowed(undefined, cfg), false, '无会话=静默')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, { presetScope: 'presets', presets: [] }), false, '空名单=全静默')
})

test('s5 活值文件读写：保存即生效免重启，非法值拒写不污染已存值', () => {
  const saved = writeScopeFile({ presetScope: 'presets', presets: ['closedloop-full'] })
  assert.deepEqual(saved, { presetScope: 'presets', presets: ['closedloop-full'] })
  assert.equal(presetAllowed({ agentPreset: 'other' }, effectiveScopeConfig({ presetScope: 'all' })), false, '文件活值压过挂载 all')
  assert.throws(() => writeScopeFile({ presetScope: 'bad', presets: [] }), /all\|presets/)
  assert.equal(liveScopeFromFile().presetScope, 'presets', '非法写失败不污染已存值')
  writeScopeFile({ presetScope: 'all', presets: [] })
  assert.equal(presetAllowed({ agentPreset: 'anything' }, effectiveScopeConfig({ presetScope: 'presets' })), true, '改回 all 即全局')
})
