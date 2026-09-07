/**
 * scripts/rebuild-junctions.mjs — 重建 node_modules junctions（本地修复工具，v0.4.0）。
 *
 * 背景：插件 node_modules 是 pnpm 虚拟 store 复制品，但 .pnpm/node_modules 的
 * junction 全部丢失（空壳目录）→ TS/运行时都无法解析传递依赖。
 *
 * 做法（只动 node_modules，gitignore 内，可重复运行）：
 *  1. 枚举 .pnpm/<name>@<ver>/node_modules/<name> 全部包 → 重建虚拟根
 *     .pnpm/node_modules/<name> junction（运行时 + TS 传递解析枢纽）；
 *  2. 插件 package.json 的 deps/peerDeps/devDeps（除构建工具）→ 顶层
 *     node_modules/<name> junction（src 直接 import 解析）；
 *  3. 特殊映射：cordis → DSH fork @deepseek-ai/cordis（与 checkout vendor 一致）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname ?? dirname(new URL(import.meta.url).pathname), '..')
const store = join(root, 'node_modules', '.pnpm')
const virtual = join(store, 'node_modules')

/** 解析 store 目录名 → [name, version]（支持 @scope+name@ver 与 name@ver）。
 *  注意：peer 依赖版本含多个 @（如 tsdown@0.22.14_typescript@5.9.3），
 *  必须按**首个** @ 切分（unscoped 包名不含 @）。 */
function parseStoreDir(dir) {
  if (dir.startsWith('@')) {
    const m = dir.match(/^(@[^+@]+)\+([^@]+)@(.+)$/)
    if (!m) return null
    return [`${m[1]}/${m[2]}`, m[3]]
  }
  const i = dir.indexOf('@')
  if (i <= 0) return null
  return [dir.slice(0, i), dir.slice(i + 1)]
}

function junction(link, target) {
  if (existsSync(link)) return false
  mkdirSync(dirname(link), { recursive: true })
  try {
    symlinkSync(target, link, 'junction')
    return true
  } catch {
    return false
  }
}

let linked = 0
const all = readdirSync(store)
for (const dir of all) {
  if (dir === 'node_modules' || dir.startsWith('.')) continue
  const parsed = parseStoreDir(dir)
  if (!parsed) continue
  const [name] = parsed
  const pkgDir = join(store, dir, 'node_modules', ...name.split('/'))
  if (!existsSync(join(pkgDir, 'package.json'))) continue
  const target = join(virtual, ...name.split('/'))
  if (junction(target, pkgDir)) linked++
}

// 顶层直接依赖（deps + peerDeps + devDeps——client 的 react 类型链也需要）
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const direct = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])
for (const name of direct) {
  const src = join(virtual, ...name.split('/'))
  const link = join(root, 'node_modules', ...name.split('/'))
  if (existsSync(src) && junction(link, src)) linked++
}

// 特殊映射：cordis → DSH fork（@deepseek-ai/cordis），与官方 checkout vendor 一致
const fork = join(virtual, '@deepseek-ai', 'cordis')
if (existsSync(fork)) {
  const link = join(root, 'node_modules', 'cordis')
  if (existsSync(link) && !existsSync(join(link, 'package.json'))) {
    rmSync(link, { recursive: true, force: true })
  }
  if (junction(link, fork)) linked++
}

console.log(`rebuild-junctions: linked ${linked} junctions`)
