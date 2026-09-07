/**
 * v0.4.2 来源纪律测试（判据：read 锚点核验 / probe 台账值核验 / prior 计数 / 自由文本直拒+教语法 / probe_record e2e）。
 * 探针台账与临时文件全在临时 DSH_HOME——真盘零接触。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-src-'))
process.env.DSH_HOME = TMP

const { declareStep, loadProbes, saveProbes } = await import('../src/optimal-engine.js')
const T = await import('../src/tools.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })
const baseArgs = (source, value = '1') => ({
  title: 'T1',
  predictions: [{ key: 'k', value, source }],
  law: [{ signal: 's', action: 'a' }],
  measure: { channels: ['fs: a', 'rt: b'] },
})

test('s1 read 锚点合法：文件在位+行存在非空 → 通过且计数', () => {
  const f = path.join(TMP, 'anchor.txt')
  fs.writeFileSync(f, 'line1\nline2\nline3\nline4\nline5\n', 'utf8')
  const r = declareStep('src-t1', baseArgs(`read:${f}#L3`))
  assert.equal(r.ok, true, r.error)
  assert.equal(r.sourceStats.read, 1)
  const r2 = declareStep('src-t1b', { ...baseArgs(`read:${f}`), title: 'T2' })
  assert.equal(r2.ok, true, '裸路径（整文件锚）合法')
})

test('s2 read 锚点缺文件 / 行越界 / 空行 → 直拒+教语法', () => {
  const f = path.join(TMP, 'missing.txt')
  assert.match(declareStep('src-t2', baseArgs(`read:${f}#L1`)).error, /读锚点缺/)
  const g = path.join(TMP, 'anchor.txt')
  assert.match(declareStep('src-t3', baseArgs(`read:${g}#L99`)).error, /越界.*共 \d+ 行/)
  const h = path.join(TMP, 'sparse.txt')
  fs.writeFileSync(h, 'line1\n\nline3\n', 'utf8')
  assert.match(declareStep('src-t4', baseArgs(`read:${h}#L2`)).error, /空行/)
})

test('s3 probe 台账：缺 key 直拒 / 值不在 output 直拒 / 值在 output 通过', () => {
  assert.match(declareStep('src-t5', baseArgs('probe:ghost', '7')).error, /探针台账缺/)
  const book7 = { k7: { cmd: 'node -e "console.log(7)"', at: 1, exit: 0, output: '7\n' } }
  saveProbes('src-t6', book7)
  assert.match(declareStep('src-t6', baseArgs('probe:k7', '99')).error, /值不在 output/)
  saveProbes('src-t7', book7) // 探针台账按会话隔离——每个被测 sid 各落各的
  const ok = declareStep('src-t7', baseArgs('probe:k7', '7'))
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.sourceStats.probe, 1)
  assert.equal(loadProbes('src-t6').k7.exit, 0, '台账只读面完整')
})

test('s4 prior 显式先验：通过且计数展示（不静默当标准）', () => {
  const r = declareStep('src-t8', baseArgs('prior:模板估算 40~90KB（惯例区间，未实测）'))
  assert.equal(r.ok, true, r.error)
  assert.equal(r.sourceStats.prior, 1)
})

test('s5 自由文本 source=隐式先验 → 直拒+教四形式（72% 预言失效案底直修；v0.4.6 engram: 入列）', () => {
  const r = declareStep('src-t9', baseArgs('手写内联样式的体量估算（惯例）'))
  assert.equal(r.ok, false)
  assert.match(r.error, /来源纪律.*四形式/)
  assert.match(r.error, /read:<path>#L<n>.*probe:<key>.*prior:/)
})

test('s6 probe_record e2e：实跑落台账 → declare 引用通过（先实测后预测全链）', async () => {
  const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
  const sid = 'src-t10'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  // 探针命令=独立脚本文件（-e 内嵌引号在 cmd.exe 下是引号地狱——脚本文件面干净）
  const probeFile = path.join(TMP, 'probe-count.mjs')
  fs.writeFileSync(probeFile, `import { readFileSync } from 'node:fs'\nprocess.stdout.write(String(readFileSync(${JSON.stringify(path.join(TMP, 'anchor.txt'))}, 'utf8').split(String.fromCharCode(10)).filter(Boolean).length))\n`, 'utf8')
  const pr = T.probeRecordDefinition()
  const r = await pr.execute({ key: 'linecount', cmd: `node "${probeFile}"` }, exec(sid))
  assert.match(r.text, /实跑 exit=0/)
  const book = loadProbes(sid)
  assert.ok(book.linecount && book.linecount.output.includes('5'), '实跑 output 落台账')
  const d = T.optimalDeclareDefinition()
  const ok = await d.execute({ title: 'T10', predict: [{ key: 'n', value: '5', source: 'probe:linecount' }], channels: ['fs: a', 'rt: b'] }, exec(sid))
  assert.match(ok.text, /来源：read×0 probe×1 engram×0 prior×0/, '回执携来源分布') // v0.4.6：分布行加 engram 列
})

test('s7 probe_record key 形状闸：非法 key 直拒（台账引用键纪律）', async () => {
  const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
  const sid = 'src-t11'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  const pr = T.probeRecordDefinition()
  await assert.rejects(() => pr.execute({ key: 'bad key!', cmd: 'node -e "console.log(1)"' }, exec(sid)), /1-40 字/)
  await assert.rejects(() => pr.execute({ key: '', cmd: 'x' }, exec(sid)), /1-40 字/)
})

test('s8 v0.4.3 辅助①：probe_record 回执列可解析 key=value（防抄错键——R3 布尔 vs 计数案底直修）', async () => {
  const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
  const sid = 'src-t12'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  const p2 = path.join(TMP, 'probe-counts.mjs')
  fs.writeFileSync(p2, 'process.stdout.write("总非空行数=144 0.4.2出现次数=3 存在性=1")\n', 'utf8')
  const r = await T.probeRecordDefinition().execute({ key: 'cnt', cmd: `node "${p2}"` }, exec(sid))
  assert.match(r.text, /可解析值.*0\.4\.2出现次数=3.*存在性=1/, '回执列全部可解析 key=value')
  assert.match(r.text, /裸数字易抄错键/, '防抄错键提示在位')
})

test('s9 v0.4.3 辅助②：declare 引 probe: 时回执现场出示台账证据（引用时刻即核对时刻）', async () => {
  const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
  const sid = 'src-t13'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  const p3 = path.join(TMP, 'probe-evi.mjs')
  fs.writeFileSync(p3, 'process.stdout.write("总非空行数=144 0.4.2出现次数=3 存在性=1")\n', 'utf8')
  await T.probeRecordDefinition().execute({ key: 'evi', cmd: `node "${p3}"` }, exec(sid))
  const d = T.optimalDeclareDefinition()
  const ok = await d.execute({ title: 'T13', predict: [{ key: 'n', value: '3', source: 'probe:evi' }], channels: ['fs: a', 'rt: b'] }, exec(sid))
  assert.match(ok.text, /探针 evi ✓（引用值「3」在案）/, 'hit=✓ 行在位且携引用值（0.4.9 证据折叠：吻合不展开尾）')
})

test('s9b v0.4.9 证据折叠：mismatch→✗ 行+台账尾+口径核对提示（证据只在错配时展开）', async () => {
  const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
  const sid = 'src-t13b'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  const p4 = path.join(TMP, 'probe-evi2.mjs')
  fs.writeFileSync(p4, 'process.stdout.write("总非空行数=144 0.4.2出现次数=3 存在性=1")\n', 'utf8')
  await T.probeRecordDefinition().execute({ key: 'evi2', cmd: `node "${p4}"` }, exec(sid))
  const d = T.optimalDeclareDefinition()
  const ok = await d.execute({ title: 'T14', predict: [{ key: 'n', value: 'clean', source: 'probe:evi2' }], channels: ['fs: a', 'rt: b'] }, exec(sid))
  assert.match(ok.text, /探针 evi2 ✗（引用值「clean」未在 output/, 'mismatch=✗ 行（无数字值过闸→防御展示位）')
  assert.match(ok.text, /0\.4\.2出现次数=3/, '✗ 行携台账尾（模型可当场核对口径）')
  assert.match(ok.text, /引用值没有出现在探针实跑输出里/, '口径核对提示在位')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
