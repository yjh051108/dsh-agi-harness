/**
 * infra-cwd.test — v0.8.14 判据运行时根因修复
 * cw1 显式 session.cwd 最高优先（不夺权）
 * cw2 会话工作区解码：env 显式值 > DSH_SESSION_JSONL 目录名（--D-dsh-- → D:/dsh）> 空串
 * cw3 判据超时可配：默认 120000 / env 覆盖 / 过小回默认 / 上限 900000
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { sessionCwd, decodeSessionCwd, decodeWorkspaceSegment, workspaceFromSessionId, judgeTimeoutMs } = await import('../src/tools.js')

test('cw1 显式 session.cwd 最高优先', () => {
  assert.equal(sessionCwd({ agent: { session: { cwd: 'D:/x' } } }), 'D:/x')
  assert.equal(sessionCwd(null).includes('dsh') || sessionCwd(null).length > 2, true, '无 exec 时走回退链（不返回空）')
})

test('cw2 会话工作区解码', () => {
  const env = { DSH_SESSION_JSONL: 'C:\\Users\\Eldwen\\.dsh\\sessions\\--D-dsh--\\session-x\\session.jsonl.zstd' }
  assert.equal(decodeSessionCwd(env), 'D:/dsh', '--D-dsh-- → D:/dsh')
  assert.equal(decodeSessionCwd({ ...env, DSH_SESSION_CWD: 'E:/work' }), 'E:/work', 'env 显式值优先')
  assert.equal(decodeSessionCwd({ DSH_SESSION_JSONL: '/home/u/.dsh/sessions/plain/session.jsonl' }), '', '非编码段=解不出')
  assert.equal(decodeSessionCwd({}), '')
  // 宿主侧兜底：宿主 env 无 DSH_SESSION_* → 按会话 id 在 DSH_HOME/sessions/*/<sid>/ 里找
  const tmp = mkdtempSync(join(tmpdir(), 'ws-'))
  mkdirSync(join(tmp, 'sessions', '--D-dsh--', 'session-abc'), { recursive: true })
  assert.equal(workspaceFromSessionId('session-abc', { DSH_HOME: tmp }), 'D:/dsh')
  assert.equal(workspaceFromSessionId('session-missing', { DSH_HOME: tmp }), '')
  assert.equal(decodeWorkspaceSegment('--E-work-proj--'), 'E:/work/proj')
})

test('cw3 判据超时可配（只放宽不收紧）', () => {
  assert.equal(judgeTimeoutMs({}), 120000, '默认 120s（旧硬编码 20s 会把 ~90s 审计判红）')
  assert.equal(judgeTimeoutMs({ DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS: '300000' }), 300000)
  assert.equal(judgeTimeoutMs({ DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS: '5' }), 120000, '过小回默认')
  assert.equal(judgeTimeoutMs({ DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS: '99999999' }), 900000, '上限 15min')
})
