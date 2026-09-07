#!/usr/bin/env node
/**
 * verify-handoff-sync — 公开仓同步的**独立验收器**（v0.4 姿势首跑：断言带测量，判分器在树外）。
 * 六项本地判据 + --remote 追加两网络判据。exit 0=全绿；任何一项红=exit 1 并指名。
 * 本脚本住本地开发仓（不进公开树——判分器与被测物物理分离的最小实现）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SRC = 'D:/dsh/dsh-closedloop-mode'
const PUB = 'D:/dsh/rs-handoff/optimal'
const GIT_CANDIDATES = ['git', 'C:\\Program Files\\Git\\cmd\\git.exe']
const REMOTE = 'https://github.com/yjh051108/dsh-routing-suite.git'
const WANT_VER = '0.3.3'

const fails = []
const ok = (cond, name, detail) => { console.log((cond ? '✓ ' : '✗ ') + name + (detail ? '：' + detail : '')); if (!cond) fails.push(name) }

// ① src 枚举+字节等值
const srcFiles = fs.readdirSync(path.join(SRC, 'src')).filter((f) => /\.js$/.test(f)).sort()
const pubSrc = fs.existsSync(path.join(PUB, 'src')) ? fs.readdirSync(path.join(PUB, 'src')).filter((f) => /\.js$/.test(f)).sort() : []
ok(srcFiles.length === pubSrc.length && srcFiles.every((f) => f === pubSrc[pubSrc.indexOf(f)]), 'src 枚举等值', `${srcFiles.length} vs ${pubSrc.length}`)
let diffFiles = 0
for (const f of srcFiles) {
  const a = fs.readFileSync(path.join(SRC, 'src', f), 'utf8')
  let b = ''
  try { b = fs.readFileSync(path.join(PUB, 'src', f), 'utf8') } catch { diffFiles++; continue }
  // 消毒替换后的公开件允许路径掩码差异：剥掉 <...> 占位再比结构
  const norm = (t) => t.replace(/<[^<>]{1,24}>/g, '§')
  if (norm(a) !== norm(b)) diffFiles++
}
ok(diffFiles === 0, 'src 内容等值（剥掩码后）', `${diffFiles} 处差异`)

// ② 版本三处
const pkg = JSON.parse(fs.readFileSync(path.join(PUB, 'package.json'), 'utf8'))
const inj = fs.readFileSync(path.join(PUB, 'src', 'inject-text.js'), 'utf8')
const chg = fs.readFileSync(path.join(PUB, 'CHANGELOG.md'), 'utf8')
ok(pkg.version === WANT_VER, 'package.json version', pkg.version)
ok(inj.includes(`'${WANT_VER}'`), 'inject-text VERSION', '')
ok(chg.includes(`## ${WANT_VER}`), 'CHANGELOG 段', '')

// ③ lib 构建产物在位
ok(fs.existsSync(path.join(PUB, 'lib', 'index.js')) && fs.existsSync(path.join(PUB, 'lib', 'v04-grader.js')), 'lib 产物', '')

// ④ docs 新增件
ok(fs.existsSync(path.join(PUB, 'docs', 'THEORY-v0.4-feedback-control.md')) && fs.existsSync(path.join(PUB, 'docs', 'RESEARCH-v0.4-llm-properties.md')), 'v0.4 docs', '')

// ⑤ SANE 扫描（本机路径/用户名/真盘档残留）
const probes = [/Eldwen/, /[CD]:[\\/]{1,2}dsh/i, /C:[\\/]{1,2}Users/i, /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/]
let hits = 0
const walk = (dir) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name)
    if (f.isDirectory()) { walk(p); continue }
    if (!/\.(md|js|mjs|json|yml|css|html)$/i.test(f.name)) continue
    const t = fs.readFileSync(p, 'utf8')
    for (const re of probes) if (re.test(t)) { hits++; console.log('  泄露:', p, re.source); break }
  }
}
walk(PUB)
ok(hits === 0, 'SANE 零泄露', `${hits} 命中`)

// ⑥ 网络面（--remote）
if (process.argv.includes('--remote')) {
  const git = GIT_CANDIDATES.find((g) => spawnSync(g, ['--version'], { encoding: 'utf8' }).status === 0)
  if (!git) { ok(false, 'git 可执行', '未找到') }
  else {
    const head = spawnSync(git, ['-C', 'D:/dsh/rs-handoff', 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
    const ls = spawnSync(git, ['ls-remote', REMOTE, 'refs/heads/closedloop-handoff', 'refs/heads/main'], { encoding: 'utf8', timeout: 30000 }).stdout
    const rows = Object.fromEntries(ls.split('\n').filter(Boolean).map((l) => { const [sha, ref] = l.split('\t'); return [ref.trim().split('/').pop(), sha] }))
    ok(rows['closedloop-handoff'] === head, '远端分支 sha==本地 HEAD', `${rows['closedloop-handoff'] || '∅'} vs ${head}`)
    ok(rows['main'] === 'e3f00b2'.slice(0, 7) ? true : /^[0-9a-f]{40}$/.test(rows['main'] || '') && rows['main'] !== rows['closedloop-handoff'], 'main 未被本分支移动', rows['main'])
  }
}

console.log(fails.length ? `RED(${fails.length}): ${fails.join(' | ')}` : 'GREEN 6+' + (process.argv.includes('--remote') ? '+2' : '') + ' 判据全绿')
process.exit(fails.length ? 1 : 0)
