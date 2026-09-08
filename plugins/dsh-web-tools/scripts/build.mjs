/**
 * build — 纯 JS 插件零编译：src/ → lib/（保持字节一致，附指纹便于确认同步）。
 * 用法：node scripts/build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LIB = join(ROOT, 'lib')

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f)
  return statSync(p).isDirectory() ? walk(p) : [p]
})

let n = 0
for (const p of walk(SRC)) {
  const rel = relative(SRC, p)
  const out = join(LIB, rel)
  mkdirSync(dirname(out), { recursive: true })
  const buf = readFileSync(p)
  writeFileSync(out, buf)
  n++
}
const idx = readFileSync(join(LIB, 'index.js'))
console.log(`BUILD OK: ${n} files → lib/  sha256=${createHash('sha256').update(idx).digest('hex').slice(0, 12)}`)
