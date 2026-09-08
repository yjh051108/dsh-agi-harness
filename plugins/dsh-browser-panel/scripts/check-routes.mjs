// check-routes.mjs — 强制登记守卫（构建期）：
// 禁止在 src 中直接裸调 ctx.httpServer.register（必须经 registerRoute / ctx.effect 登记，
// 否则热重载 dispose 无法自动注销路由 → duplicate route 残留）。
// 退出码 1 = 发现裸注册，构建中止。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(root, 'src')
const files = []
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full)
    else if (e.name.endsWith('.ts')) files.push(full)
  }
}
walk(srcDir)

let bad = 0
for (const f of files) {
  const lines = readFileLines(f)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // 裸调用：ctx.httpServer / ctx.webServer 的 register(...) 且不是 registerRoute helper 内部那行
    // （2026-09 适配：DSH host 服务更名 httpServer → webServer，守卫双认）
    if ((line.includes('ctx.httpServer.register(') || line.includes('ctx.webServer.register(')) && !line.trim().startsWith('//')) {
      // 排除 helper 定义行（ctx.effect(() => ctx.webServer.register(route)）
      if (line.includes('ctx.effect')) continue
      console.error(`[check:routes] 裸注册违规 ${relative(root, f)}:${i + 1}: ${line.trim()}`)
      console.error(`              路由注册必须经 registerRoute（ctx.effect 登记），否则热重载残留 duplicate route`)
      bad++
    }
  }
}
if (bad) {
  console.error(`[check:routes] 发现 ${bad} 处未登记路由注册，构建中止`)
  process.exit(1)
}
console.log('[check:routes] OK：全部路由注册均已登记（ctx.effect）')

function readFileLines(p) {
  return statSync(p).isFile() ? String(readFileSync(p)).split('\n') : []
}
