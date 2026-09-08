/**
 * scope-card.test — v0.8.28 作用域卡片落盘（案底：onChange 空函数 → 拨完又变全选）
 * sc1 旧 bug 复现：宿主活值被旧活值文件盖住（文件优先口径）
 * sc2 镜像后一致 + 非法活值不污染已存文件
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'scope-card-'))
const { writeScopeFile, setLiveScope, effectiveScopeConfig, mirrorScopeToFile, liveScopeFromFile } = await import('../src/scope.js')

test('sc1 旧 bug 复现：宿主活值被旧文件盖住', () => {
  writeScopeFile({ disabled: [] })                              // 文件里躺着旧值（全开）
  setLiveScope(() => ({ disabled: ['closedloop-full'] }))       // 卡片刚拨的宿主活值
  assert.deepEqual(
    effectiveScopeConfig({ disabled: [] }),
    { disabled: [] },
    '文件优先 → 读回旧值：这就是「关掉之后又变成全选」的机制',
  )
})

test('sc2 镜像后一致；非法活值不污染已存文件', () => {
  const mirrored = mirrorScopeToFile()
  assert.deepEqual(mirrored, { disabled: ['closedloop-full'] }, '镜像返回新值')
  assert.deepEqual(effectiveScopeConfig({ disabled: [] }), { disabled: ['closedloop-full'] }, '读数与拨动一致')
  assert.deepEqual(liveScopeFromFile(), { disabled: ['closedloop-full'] }, '文件已落盘')
  // 非法活值：抛错，且不污染已存值
  setLiveScope(() => ({ disabled: 123 }))
  assert.throws(() => mirrorScopeToFile(), /disabled 须为字符串数组/)
  assert.deepEqual(liveScopeFromFile(), { disabled: ['closedloop-full'] }, '非法值不落盘')
})
