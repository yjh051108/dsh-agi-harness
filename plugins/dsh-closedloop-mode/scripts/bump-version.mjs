// bump-version.mjs — 版本原子同步器（r28 根治件：升版本从此一处命令、多处齐改）
// 用法：node scripts/bump-version.mjs 0.6.23
// 覆盖：src/inject-text VERSION + README 头条 + HANDOFF §0.x.y + package.json version（v0.6.23 纳入——
//       历史漂移案：pkg 停在 0.3.3 而链上已 v0.6.22；lib 由随后 build 同步）；写前全量预检，任一失败不落地（原子性=要么全改要么不改）
import { readFileSync, writeFileSync } from 'node:fs'
const to = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(to || '')) { console.log('用法: node bump-version.mjs <x.y.z>'); process.exit(2) }
const F = {
  src: 'src/inject-text.js',
  readme: 'README.md',
  ho: 'HANDOFF.md',
  pkg: 'package.json',
}
const MINOR = to.split('.').slice(1).join('.')
const orig = {}
for (const k of Object.keys(F)) orig[k] = readFileSync(F[k], 'utf8')
// 预检：四处都能定位到各自的版本锚点，定位不到=拒改（防静默漏改=原子性核心）
const fails = []
if (!/VERSION = '[\d.]+/.test(orig.src)) fails.push('src 无 VERSION 锚')
if (!/全落地（v[\d.]+，/.test(orig.readme)) fails.push('README 无头条版本锚')
if (!/§0\.\d+\.\d+ 现状/.test(orig.ho)) fails.push('HANDOFF 无 §0.x.y 现状锚')
if (!/"version": "[\d.]+"/.test(orig.pkg)) fails.push('package.json 无 version 锚')
if (fails.length) { console.log('BUMP 拒绝（锚点缺失）: ' + fails.join(' | ')); process.exit(2) }
try {
  writeFileSync(F.src, orig.src.replace(/VERSION = '[\d.]+.'/, `VERSION = '${to}'`))
  writeFileSync(F.readme, orig.readme.replace(/全落地（v[\d.]+，/, `全落地（v${to}，`))
  writeFileSync(F.pkg, orig.pkg.replace(/"version": "[\d.]+"/, `"version": "${to}"`))
  // 只动两处现行锚：头部指针行 + 最新现状节标题；历史节（§0.5.9 等）绝不改——案底不可改写
  let h = orig.ho.replace(/现状以 §0\.\d+\.\d+ 为准/, `现状以 §0.${MINOR} 为准`)
  h = h.replace(/## §0\.\d+\.\d+ 现状（最新/, `## §0.${MINOR} 现状（最新`)
  writeFileSync(F.ho, h)
} catch (e) {
  for (const k of Object.keys(F)) writeFileSync(F[k], orig[k]) // 任一写失败=全部回滚
  console.log('BUMP 失败已回滚: ' + e.message); process.exit(1)
}
console.log(`BUMP OK → v${to}（src/README/HANDOFF/package.json 四处已原子同步；lib 请跑 build.mjs；commit 标题请用 v${to} 开头）`)
