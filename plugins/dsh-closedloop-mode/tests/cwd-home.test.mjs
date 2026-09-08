/**
 * cwd-home.test — v0.8.33 issue #15 修复回归
 *
 * 案底：宿主进程里没有 DSH_HOME（DSH_SESSION_* 只注入命令子进程）→ workspaceFromSessionId
 * 直接返回空串 → sessionCwd 一路退化到宿主 cwd → 工作区根≠工程根时相对路径判据全红。
 *
 * c1 dshHome：env.DSH_HOME 优先
 * c2 dshHome：缺 DSH_HOME 时从 DSH_SESSION_JSONL 的 …/sessions/<seg>/ 反推父目录
 * c3 dshHome：两者都缺 → ~/.dsh 兜底（非空）
 * c4 workspaceFromSessionId：只有 DSH_SESSION_JSONL（无 DSH_HOME）也能定位会话工作区
 * c5 sessionCwd：DSH_CLOSEDLOOP_CWD 显式覆盖优先于一切回退
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { dshHome, workspaceFromSessionId, sessionCwd, decodeWorkspaceSegment } = await import('../src/tools.js')

test('c1 dshHome：env.DSH_HOME 优先', () => {
  assert.equal(dshHome({ DSH_HOME: 'D:/h', DSH_SESSION_JSONL: 'X:/y/sessions/a/b/session.jsonl' }), 'D:/h')
})

test('c2 dshHome：从 DSH_SESSION_JSONL 反推父目录', () => {
  const j = 'C:/Users/u/.dsh/sessions/--D-dsh--/sid/session.jsonl'
  assert.equal(dshHome({ DSH_SESSION_JSONL: j }), 'C:/Users/u/.dsh')
})

test('c3 dshHome：都缺时回退 ~/.dsh（非空）', () => {
  const h = dshHome({})
  assert.equal(typeof h, 'string')
  assert.ok(h.length > 0 && h.endsWith('.dsh'), `应回退到 ~/.dsh（实测 ${h}）`)
})

test('c4 workspaceFromSessionId：只有 DSH_SESSION_JSONL 也能定位', () => {
  const home = mkdtempSync(join(tmpdir(), 'cl-home-'))
  const seg = '--D-dsh--'
  const sid = 'session-cwd-test'
  mkdirSync(join(home, 'sessions', seg, sid), { recursive: true })
  // 无 DSH_HOME，只给 jsonl 路径 —— 修复前这里返回空串
  const env = { DSH_SESSION_JSONL: join(home, 'sessions', seg, sid, 'session.jsonl') }
  assert.equal(workspaceFromSessionId(sid, env), decodeWorkspaceSegment(seg))
  assert.equal(workspaceFromSessionId(sid, env), 'D:/dsh')
})

test('c5 sessionCwd：DSH_CLOSEDLOOP_CWD 显式覆盖优先', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cl-ovr-'))
  assert.equal(sessionCwd(null, { DSH_CLOSEDLOOP_CWD: dir, DSH_SESSION_CWD: 'D:/别的' }), dir)
  // 覆盖路径不存在=忽略，继续走回退链
  assert.notEqual(sessionCwd(null, { DSH_CLOSEDLOOP_CWD: 'D:/definitely/not/here' }), 'D:/definitely/not/here')
})
