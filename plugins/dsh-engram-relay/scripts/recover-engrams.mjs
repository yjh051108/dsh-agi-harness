// 一次性恢复脚本：清理 engrams.jsonl 的 NUL 字节与损坏行，重写为每行一个节点的干净 JSONL。
// 用法: node scripts/recover-engrams.mjs [--dry-run]
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const file = process.argv[2] ?? join(homedir(), '.dsh', 'engram-relay', 'engrams.jsonl')
const dry = process.argv.includes('--dry-run')

const raw = readFileSync(file, 'utf8')
// 1) 去 NUL 与其它控制字节（\x00 是主要损坏源；\r 保留给行尾清理）
const cleaned = raw.replace(/\x00+/g, '')
// 2) 按行拆，逐行解析，跳过坏行
const nodes = []
let bad = 0
for (const line of cleaned.split('\n')) {
  const t = line.trim()
  if (!t) continue
  try {
    const e = JSON.parse(t)
    if (e && typeof e === 'object' && typeof e.id === 'string' && typeof e.title === 'string') {
      nodes.push(e)
    } else bad++
  } catch { bad++ }
}
console.log(`raw bytes=${raw.length} cleaned=${cleaned.length} recovered=${nodes.length} badLines=${bad}`)

// 3) 若整文件是单个 JSON 数组（另一种损坏形态），展开
if (nodes.length === 0 && cleaned.trimStart().startsWith('[')) {
  try {
    const arr = JSON.parse(cleaned)
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (e && typeof e === 'object' && typeof e.id === 'string') nodes.push(e)
      }
      console.log(`array-form recovered=${nodes.length}`)
    }
  } catch { /* ignore */ }
}

// 去重（同 id）
const seen = new Set()
const uniq = nodes.filter((n) => {
  if (seen.has(n.id)) return false
  seen.add(n.id)
  return true
})
console.log(`unique=${uniq.length}`)

if (dry) {
  console.log('DRY-RUN: not writing')
} else {
  const backup = file + '.corrupt-' + Date.now()
  renameSync(file, backup)
  console.log(`backup -> ${backup}`)
  const out = uniq.map((n) => JSON.stringify(n)).join('\n') + '\n'
  writeFileSync(file, out, 'utf8')
  console.log(`wrote ${file} (${out.length} bytes)`)
}
