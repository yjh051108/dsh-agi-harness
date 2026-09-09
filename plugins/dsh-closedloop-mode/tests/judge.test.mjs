/**
 * judge.test — v0.6.32 刀二回归锁：语义裁判三路（正则快路/裁判接管/无裁判保底）。
 * 假裁判经 setJudge 注入（不碰网络）；env 门控与解析纯函数直测。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-judge-'))
process.env.DSH_HOME = TMP

const { judgePrompt, parseJudgeResponse, setJudge, getJudge } = await import('../src/judge.js')
const { agreedMatch } = await import('../src/optimal-engine.js')
const { initMode, onWeightsFreeze, onWeightsConfirmed, saveState } = await import('../src/mode-state.js')
const T = await import('../src/tools.js')
const { declareStep } = await import('../src/optimal-engine.js')

const exec = (sid) => ({ agent: { session: { id: sid } } })

test('j1 裁判提示词：含 key/值/原句/判定标准/JSON 契约（固定形防注入）', () => {
  const p = judgePrompt({ key: '行数', value: '30', line: '行数实测约三十行与预期相符' })
  assert.match(p, /预测 key：行数/)
  assert.match(p, /预测值：30/)
  assert.match(p, /对账陈述：行数实测约三十行与预期相符/)
  assert.match(p, /占位词/)
  assert.match(p, /只输出一个 JSON/)
})

test('j2 解析三态：合法过 / 非 JSON null / match 非布尔 null', () => {
  assert.deepEqual(parseJudgeResponse('{"match":true,"reason":"一致"}'), { match: true, reason: '一致' })
  assert.equal(parseJudgeResponse('不是 JSON'), null)
  assert.equal(parseJudgeResponse('{"match":"yes"}'), null)
})

test('j3 凭证源：会话同源（.credentials.yaml DEEPSEEK_API_KEY ref）+env 覆盖链；无凭证=无裁判（正则保底）', () => {
  delete process.env.DSH_JUDGE_KEY
  delete process.env.DEEPSEEK_API_KEY
  fs.writeFileSync(path.join(TMP, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-test-123456\nrecords: {}\n')
  assert.ok(getJudge(), '会话同源凭证在库→裁判在场')
  const fake = async () => ({ match: true, reason: 'fake' })
  setJudge(fake)
  assert.equal(getJudge(), fake)
  setJudge(null)
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-judge2-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmp2 // 无凭证库
  assert.equal(getJudge(), null, '无凭证=零行为变化（正则保底）')
  if (oldHome !== undefined) process.env.DSH_HOME = oldHome
  fs.rmSync(tmp2, { recursive: true, force: true })
})

test('j4 裁判接管：正则失败行（中文数字句）经假裁判 match → 闭步', async () => {
  const sid = 'judge-live'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  declareStep(sid, { title: 'J1', predictions: [{ key: '行数', value: '30', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  setJudge(async () => ({ match: true, reason: '三十=30，数值一致' }))
  try {
    const r = await T.optimalConvergeDefinition().execute({
      agreed: ['行数实测约三十行，与预期相符'],
      dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] },
    }, exec(sid))
    assert.ok(r.text.includes('closed'), '裁判接管后闭步（无格式战）')
    const st = (await import('../src/optimal-engine.js')).loadStack(sid)
    const closed = st.steps.find((x) => x.title === 'J1')
    assert.ok(closed.agreed.some((a) => a.includes('语义裁判') && a.includes('实测 30 ≠ 预测 30')), '补渲染行落栈且标注裁判通道')
  } finally { setJudge(null) }
})

test('j5 裁判缺席保底：无数字实证仍判不吻合（不放水，v0.8 起为 invalidated 非整块拒）', async () => {
  const sid = 'judge-fallback'
  let s = { ...initMode(), stage: 'brainstorm', task: 't', cost: { purpose: 'p', assertions: [{ text: 'a', severity: 'major', source: 'x' }], nonGoals: [], assumptions: [], nonGoalsConfirmed: false, aligned: true } }
  s = { ...s, groups: [{ title: 'G', spec: 's', accept: ['a'], verify: 'self', settled: null }] }
  saveState(sid, onWeightsConfirmed(onWeightsFreeze(s).state))
  declareStep(sid, { title: 'J2', predictions: [{ key: '行数', value: '30', source: 'prior:fs' }], law: [{ signal: 's', action: 'a' }], measure: { channels: ['fs: a', 'rt: b'] } })
  await assert.rejects(() => T.optimalConvergeDefinition().execute({
    agreed: ['行数实测约三十行，与预期相符'],
    dv: { beforeBand: 'far', measuredBand: 'near', channels: ['fs: a', 'rt: b'] },
  }, exec(sid)), /处置权在你[\s\S]*无数值实证/, 'v0.8.37：偏差先要模型自评处置，但偏差本身仍如实报出（保底不是放水）')
})

test('j6 agreedMatch 单一真相：match/no-number/unequal/declared-mismatch/no-key 五态', () => {
  assert.equal(agreedMatch('k: 实测 30 ≠ 预测 30（fs）', 'k', '30').reason, 'match')
  assert.equal(agreedMatch('k: 实测 完成 ≠ 预测 完成（fs）', 'k', '完成').reason, 'no-number')
  assert.equal(agreedMatch('k: 实测 31 ≠ 预测 30（fs）', 'k', '30').reason, 'unequal')
  assert.equal(agreedMatch('k: 实测 30 预测 29', 'k', '30').reason, 'declared-mismatch')
  assert.equal(agreedMatch('已测', 'k', '1').reason, 'no-key')
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
