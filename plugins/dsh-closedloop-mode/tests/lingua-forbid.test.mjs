/**
 * lingua-forbid — 禁词表结构位把关（SPEC-replace §3：语系=结构，不是文档约定）。
 * FORBIDDEN 表唯一来源；扫描面=src/**.js；任何实现文件命中即红。
 * 裁判自测：同函数喂含禁词的合成 map 必须报命中（防"永远绿的假闸"）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

export const FORBIDDEN = ['测试通过', '验收', '打卡', '收官', '组级核对', '终验六项', '[模式:']

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 扫描 {文件名: 内容} → 命中清单（词, 文件, 样例行）。 */
export function scanLingua(map) {
  const hits = []
  for (const [name, text] of Object.entries(map)) {
    for (const word of FORBIDDEN) {
      const re = new RegExp(esc(word))
      text.split(/\r?\n/).forEach((line, i) => {
        if (re.test(line)) hits.push({ word, name, line: i + 1, sample: line.trim().slice(0, 60) })
      })
    }
  }
  return hits
}

function readSrc() {
  const m = {}
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    if (f.endsWith('.js')) m['src/' + f] = readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')
  }
  return m
}

test('FORBIDDEN 表=7 条（唯一来源，实现侧不得另立表）', () => {
  assert.equal(FORBIDDEN.length, 7)
  assert.equal(new Set(FORBIDDEN).size, 7)
})

test('裁判自测：含禁词的合成输入必报命中（防永远绿的假闸）', () => {
  const hits = scanLingua({ 'fake.js': 'const a = 1\n// 这里写了验收四个字' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].word, '验收')
  assert.equal(hits[0].name, 'fake.js')
  assert.ok(scanLingua({ 'a.js': 'x [模式:correct] y 打卡' }).length >= 2)
})

test('src/**.js 全目录禁词零命中（拦截即暴露残留，销词不销表）', () => {
  const hits = scanLingua(readSrc())
  assert.equal(hits.length, 0, '禁词残留：' + hits.map((h) => `${h.name}:${h.line}「${h.word}」${h.sample}`).join(' | '))
})
