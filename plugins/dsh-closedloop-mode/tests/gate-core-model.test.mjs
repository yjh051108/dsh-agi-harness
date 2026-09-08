/**
 * gate-core-model.test — v0.8.20 模型指纹 YAML 标量协议化
 * gm1 缩进块 + 带引号值（旧实现把引号带进指纹）
 * gm2 行尾注释（引号外的 # 才切）
 * gm3 内联流映射（旧实现读不到）
 * gm4 无文件 → env 兜底 → unbound
 * gm5 yamlScalar 单引号与转义
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { getModelFingerprint, yamlScalar, inlineFlowMap } = await import('../src/gate-core.js')

const withHome = (yaml) => {
  const home = mkdtempSync(join(tmpdir(), 'fp-'))
  if (yaml !== null) writeFileSync(join(home, 'settings.yaml'), yaml)
  const prev = { home: process.env.DSH_HOME, judge: process.env.DSH_JUDGE_MODEL }
  process.env.DSH_HOME = home
  delete process.env.DSH_JUDGE_MODEL
  return () => { if (prev.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev.home; if (prev.judge !== undefined) process.env.DSH_JUDGE_MODEL = prev.judge }
}

test('gm1 缩进块 + 带引号值', () => {
  const done = withHome('agent-default-model:\n  provider: "deepseek"\n  model: "deepseek-chat"\n')
  try { assert.equal(getModelFingerprint(), 'deepseek:deepseek-chat', '引号不得进指纹') } finally { done() }
})

test('gm2 行尾注释与无引号', () => {
  const done = withHome('agent-default-model:\n  provider: deepseek # 主供应商\n  model: deepseek-chat  # 备注\n')
  try { assert.equal(getModelFingerprint(), 'deepseek:deepseek-chat') } finally { done() }
})

test('gm3 内联流映射', () => {
  const done = withHome('agent-default-model: {provider: deepseek, model: deepseek-chat}\n')
  try { assert.equal(getModelFingerprint(), 'deepseek:deepseek-chat', '旧实现读不到内联写法') } finally { done() }
})

test('gm4 回退链（无文件 / env / unbound）', () => {
  const d1 = withHome(null)
  try {
    assert.equal(getModelFingerprint(), 'unbound')
    process.env.DSH_JUDGE_MODEL = 'env:model'
    assert.equal(getModelFingerprint(), 'env:model', '无 settings 时走显式环境指纹')
  } finally { d1() }
})

test('gm5 yamlScalar 与 inlineFlowMap', () => {
  assert.equal(yamlScalar('"a#b" # 注释'), 'a#b', '引号内 # 不切注释')
  assert.equal(yamlScalar("'it''s'"), "it's", '单引号转义')
  assert.equal(yamlScalar('"a\\"b"'), 'a"b', '双引号转义')
  assert.deepEqual(inlineFlowMap('{provider: x, model: y}'), { provider: 'x', model: 'y' })
  assert.equal(inlineFlowMap('not a map'), null)
})
