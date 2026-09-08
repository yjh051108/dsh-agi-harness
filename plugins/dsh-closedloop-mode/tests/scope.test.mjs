/**
 * scope.test — v0.8.9 逐预设开关语义：默认全开；disabled 名单关闭；拨即生效（文件/覆盖两级活值）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-scope-')) // 活值文件与预设发现全程临时（真盘零接触）
import { presetAllowed, effectiveScopeConfig, setLiveScope, validateScopeValue, writeScopeFile, liveScopeFromFile, listPresets, NO_PRESET } from '../src/scope.js'

test('s1 默认全开：空/缺字段/无配置一律放行（现有用户零变化）', () => {
  assert.equal(presetAllowed({ agentPreset: 'router-standard' }, undefined), true, '无配置=全开')
  assert.equal(presetAllowed({ agentPreset: 'router-standard' }, {}), true, '缺 disabled 字段=全开')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, { disabled: [] }), true, '空名单=全开')
})

test('s2 disabled 名单：名单内关闭、名单外照常，无预设会话用 (无预设) 键', () => {
  const cfg = { disabled: ['router-spec', NO_PRESET] }
  assert.equal(presetAllowed({ agentPreset: 'router-spec' }, cfg), false, '名单内=静默')
  assert.equal(presetAllowed({ agentPreset: 'closedloop-full' }, cfg), true, '名单外=启用')
  assert.equal(presetAllowed({}, cfg), false, '无 preset 字段归 (无预设) 且被关')
  assert.equal(presetAllowed({}, { disabled: ['router-spec'] }), true, '未关 (无预设) 则放行')
  assert.equal(listPresets()[0], NO_PRESET, '预设发现：(无预设) 恒列首位，目录缺失不抛')
})

test('s3 活值优先于挂载 config（覆盖与函数两形状，清空回退）', () => {
  setLiveScope({ disabled: ['router-react'] })
  assert.equal(presetAllowed({ agentPreset: 'router-react' }, effectiveScopeConfig({ disabled: [] })), false, '活值收紧压过挂载全开')
  setLiveScope(() => ({ disabled: [] }))
  assert.equal(presetAllowed({ agentPreset: 'router-react' }, effectiveScopeConfig({ disabled: ['x'] })), true, '函数形状（setSource）同样生效')
  setLiveScope(null)
  assert.deepEqual(effectiveScopeConfig({ disabled: ['keep'] }).disabled, ['keep'], '清覆盖回退挂载 config')
})

test('s4 validateScopeValue：只认 disabled 数组，非法拒写且去重', () => {
  assert.deepEqual(validateScopeValue({ disabled: [] }), { disabled: [] })
  assert.deepEqual(validateScopeValue({ disabled: ['a', 'a', ' b '] }), { disabled: ['a', 'b'] }, '去重+trim')
  assert.throws(() => validateScopeValue({ disabled: 'x' }), /字符串数组/)
  assert.throws(() => validateScopeValue({ disabled: [''] }), /字符串数组/)
  assert.throws(() => validateScopeValue(null), /对象/)
})

test('s5 文件活值读写：保存即生效免重启，非法写失败不污染已存值', () => {
  const saved = writeScopeFile({ disabled: ['router-3'] })
  assert.deepEqual(saved, { disabled: ['router-3'] })
  assert.equal(presetAllowed({ agentPreset: 'router-3' }, effectiveScopeConfig({ disabled: [] })), false, '文件活值压过挂载')
  assert.throws(() => writeScopeFile({ disabled: 42 }), /字符串数组/)
  assert.deepEqual(liveScopeFromFile().disabled, ['router-3'], '非法写失败不污染已存值')
  writeScopeFile({ disabled: [] })
  assert.equal(presetAllowed({ agentPreset: 'router-3' }, effectiveScopeConfig({ disabled: ['z'] })), true, '清空=回到全开')
})

test('s6 预设发现：目录内子目录必须被列出（withFileTypes 真断言——变异审计案底）', () => {
  fs.mkdirSync(path.join(process.env.DSH_HOME, '.agent-presets', 'zz-probe'), { recursive: true })
  const ps = listPresets()
  assert.ok(ps.includes('zz-probe'), `listPresets 必须含临时预设目录，实际=${JSON.stringify(ps)}`)
  assert.equal(ps[0], NO_PRESET, '无预设项仍恒在首位')
})
