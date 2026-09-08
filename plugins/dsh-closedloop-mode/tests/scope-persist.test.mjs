/**
 * scope-persist.test — v0.8.29 预设作用域持久化（案底 2026-09-08：用户「选完退出又全选」）
 *
 * 两条根因各配一组断言：
 *  A. 写入不落盘 —— 卡片调用形态 set({disabled:[…]}) 不匹配宿主契约 set(field, value)，
 *     宿主静默回滚（dsh-client-ui-settings/lib/client.js:1015 + mutate 的 !ok 分支）。
 *  B. 装载镜像覆盖 —— installSection 装载时同步调 onChange（dsh-settings/lib/index.js:338），
 *     把宿主基值镜像进活值文件；文件优先口径下 = 每次重启回到全选。
 *
 * sp1/sp2/sp3/sp4 = 护栏行为（B）；sp5 = 客户端调用形态（A）；sp6 = 宿主接线（A+B 收口）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'scope-persist-'))
const { writeScopeFile, setLiveScope, effectiveScopeConfig, createScopeMirror } = await import('../src/scope.js')

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const scopeFile = join(process.env.DSH_HOME, 'closedloop-scope.json')
const onDisk = () => JSON.parse(readFileSync(scopeFile, 'utf8'))
/** 断言看**代码**不看注释：注释里提到旧写法不应触发误报。 */
const codeOf = (p) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

test('sp1 装载时刻不镜像：宿主基值不得覆盖用户已选值', () => {
  writeScopeFile({ disabled: ['router-3'] })          // 用户上次的选择躺在活值文件里
  const mirror = createScopeMirror()
  setLiveScope(() => ({ disabled: [] }))              // 宿主无存储节 → 解析出基值（全开）
  assert.equal(mirror.onHostChange(), null, '装载期 onChange 必须被护栏挡下')
  assert.deepEqual(onDisk(), { disabled: ['router-3'] }, '文件仍是用户的选择——这就是「退出又全选」的病根')
})

test('sp2 装载后真实变更才镜像', () => {
  const mirror = createScopeMirror()
  setLiveScope(() => ({ disabled: ['router-3'] }))
  mirror.arm()
  setLiveScope(() => ({ disabled: ['router-3', 'closedloop-full'] }))  // 卡片拨动后的宿主活值
  assert.deepEqual(mirror.onHostChange(), { disabled: ['router-3', 'closedloop-full'] }, '装载后变更必须镜像')
  assert.deepEqual(onDisk(), { disabled: ['router-3', 'closedloop-full'] }, '文件已跟上')
})

test('sp3 模拟重启：文件优先读回仍是用户选择，不被装载基值刷掉', () => {
  const reloaded = createScopeMirror()                // 重启 = 新护栏（尚未 arm）
  setLiveScope(() => ({ disabled: [] }))              // 宿主仍无存储节（基值全开）
  reloaded.onHostChange()                             // 装载期同步回调
  assert.deepEqual(
    effectiveScopeConfig({ disabled: [] }),
    { disabled: ['router-3', 'closedloop-full'] },
    '重启后读数不得回到全选',
  )
})

test('sp4 非法活值不污染已存文件', () => {
  const mirror = createScopeMirror()
  mirror.arm()
  setLiveScope(() => ({ disabled: 123 }))
  assert.equal(mirror.onHostChange(), null, '护栏吞错，不向宿主抛异常')
  assert.deepEqual(onDisk(), { disabled: ['router-3', 'closedloop-full'] }, '非法值不落盘')
})

test('sp5 卡片写入形态匹配宿主契约 set(field, value)', () => {
  const src = codeOf(join(ROOT, 'client', 'client.js'))
  assert.equal(
    /set\(\s*\{\s*disabled/.test(src), false,
    '不得再传单对象：宿主 set(field, value) 会把 path 变成 [{disabled:[…]}] 并被静默回滚',
  )
  assert.match(src, /set\(\s*["']disabled["']\s*,/, '必须 set("disabled", 值) 双参形态')
  assert.match(src, /method:\s*["']POST["']/, '卡片须写插件自带文件 API（宿主 settings 不可用时仍能落盘）')
})

test('sp6 宿主接线：onChange 走护栏 + scope API 双写', () => {
  const src = codeOf(join(ROOT, 'src', 'index.js'))
  assert.match(src, /createScopeMirror\(\)/, 'index.js 必须用装载护栏')
  assert.equal(
    /onChange:\s*\(\)\s*=>\s*\{\s*try\s*\{\s*mirrorScopeToFile\(\)/.test(src), false,
    'onChange 不得直连 mirrorScopeToFile（装载即镜像 = 重启全选）',
  )
  assert.match(src, /settings\.update\(/, 'scope API POST 必须同时写宿主节，避免两源分叉')
})
