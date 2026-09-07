import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-fingerprint-'))
process.env.DSH_HOME = TMP
fs.writeFileSync(path.join(TMP, 'settings.yaml'), 'agent-default-model:\n  provider: astra\n  model: gpt-6-astra\nllm-pi-ai:\n  providers: {}\n', 'utf8')
const G = await import('../src/gate-core.js')

test('mfp1 settings.yaml 正确解析 provider:model，不回退 default', () => {
  assert.equal(G.getModelFingerprint(), 'astra:gpt-6-astra')
})

test('mfp2 缺模型配置时明确 unbound，不伪装 default', () => {
  fs.writeFileSync(path.join(TMP, 'settings.yaml'), 'other: true\n', 'utf8')
  assert.equal(G.getModelFingerprint(), 'unbound')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
