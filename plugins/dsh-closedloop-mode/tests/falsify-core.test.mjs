/**
 * falsify-core.test — v0.8.30 判据可证伪门 · 纯函数层（负对照生成 + 判定）
 * f1 字面量抽取：三种引号 / 去重 / 长度闸 / 转义保留 / 单引号不跨行
 * f2 抽取器在真实判据上复现读数（池核 check.mjs → 117 条；fixture 缺失则 skip）
 * f3 literalStub 同字节尺寸且含全部字面量
 * f4 inertStub 同字节尺寸且不含原文任何字面量
 * f5 emptyStub 零字节
 * f6 selectArtifacts：写入面减去判据脚本，剔二进制/不存在/超限
 * f7 判定：字面壳绿 ⇒ vacuous；空转壳绿 ⇒ vacuous
 * f8 判定：两者皆红 ⇒ sensitive；全 broken ⇒ unproven；无产物 ⇒ no-artifact
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const {
  extractLiterals, fitBytes, emptyStub, literalStub, inertStub,
  selectArtifacts, falsifyVerdict, judgePath, MAX_ARTIFACT_BYTES, reachableFiles,
} = await import('../src/falsify.js')

const POOLCORE_JUDGE = 'D:/dsh/_inspect/poolcore/check.mjs'

test('f1 字面量抽取：三种引号/去重/长度闸/转义保留', () => {
  const src = [
    `const a = 'alpha'`,
    `const b = "beta"`,
    'const c = `gamma`',
    `const d = 'alpha'`, // 重复
    `const e = 'x'`, // 长度 1 → 被 min=2 剔除
    `const f = "esc\\"aped"`, // 转义引号不截断
    `const g = 'no-close`, // 未闭合 → 丢弃
  ].join('\n')
  const lits = extractLiterals(src)
  assert.deepEqual(lits, ['alpha', 'beta', 'gamma', 'esc\\"aped'], '去重+长度闸+转义保留')
  assert.equal(extractLiterals(src, { min: 1 }).includes('x'), true, 'min=1 时单字符也进池')
  assert.equal(extractLiterals(src, { cap: 2 }).length, 2, 'cap 生效')
})

test('f2 抽取器在真实判据上复现读数（池核 check.mjs）', { skip: !existsSync(POOLCORE_JUDGE) }, () => {
  const src = readFileSync(POOLCORE_JUDGE, 'utf8')
  const lits = extractLiterals(src)
  assert.equal(lits.length, 117, '池核判据源码去重后长度≥2 的字面量 = 117（侦察实测口径）')
  assert.equal(lits.includes('__SINGLE_HTML__'), true, '判据赖以通过的自我声明标记也在池里')
  assert.equal(lits.includes('InstancedMesh'), true, 'grep 目标在池里')
})

test('f3 literalStub 同字节尺寸且含全部字面量', () => {
  const lits = ['alpha', 'beta']
  const buf = literalStub(lits, 4096)
  assert.equal(buf.length, 4096, '同尺寸（防体积门假敏感）')
  const s = buf.toString('utf8')
  assert.equal(s.includes('alpha') && s.includes('beta'), true, '全部字面量都在壳里')
  const tiny = literalStub(lits, 3)
  assert.equal(tiny.length >= Buffer.byteLength('alpha\nbeta'), true, '字面量总量超尺寸时不截断')
})

test('f4 inertStub 同字节尺寸且不含原文任何字面量', () => {
  const lits = ['alpha', 'beta', 'gamma']
  const buf = inertStub(2048, '.mjs')
  assert.equal(buf.length, 2048, '同尺寸')
  const s = buf.toString('utf8')
  for (const l of lits) assert.equal(s.includes(l), false, `空转壳不该含 ${l}`)
  assert.equal(s.startsWith('export {}'), true, '按扩展名给结构合法骨架')
  assert.equal(inertStub(16, '.html').toString('utf8').startsWith('<!DOCTYPE html>'), true)
})

test('f5 emptyStub 零字节', () => {
  assert.equal(emptyStub().length, 0)
  assert.equal(fitBytes('abc', 0).length, 0)
  assert.equal(fitBytes('abc', 5).length, 5)
  assert.equal(fitBytes('abcdef', 3).toString('utf8'), 'abc')
})

test('f6 selectArtifacts：写入面减去判据脚本，剔二进制/不存在/超限', () => {
  const cwd = 'D:/proj'
  const probe = (p) => {
    const key = p.replace(/\\/g, '/').toLowerCase()
    if (key.endsWith('/judge.mjs')) return { exists: true, isFile: true, size: 100 }
    if (key.endsWith('/out.html')) return { exists: true, isFile: true, size: 500 }
    if (key.endsWith('/art.png')) return { exists: true, isFile: true, size: 500 }
    if (key.endsWith('/huge.mjs')) return { exists: true, isFile: true, size: 9e9 }
    if (key.endsWith('/missing.js')) return { exists: false, isFile: false, size: 0 }
    return { exists: false, isFile: false, size: 0 }
  }
  const got = selectArtifacts({
    cmd: 'node D:/proj/judge.mjs --all D:/proj/out.html',
    writeSet: ['judge.mjs', 'out.html', 'art.png', 'huge.mjs', 'missing.js', 'out.html'],
    cwd,
    probe,
  })
  const norm = (arr) => arr.map((p) => p.replace(/\\/g, '/'))
  assert.deepEqual(norm(got), ['D:/proj/out.html'], '判据脚本/二进制/不存在/超限全剔，重复去重')
  assert.equal(judgePath('node D:/proj/judge.mjs --all D:/proj/out.html', cwd, probe).replace(/\\/g, '/'),
    'D:/proj/judge.mjs', '判据脚本=命令行里第一个存在的脚本文件（参数里的产物不算）')
  assert.equal(judgePath('execFile:node|D:/proj/judge.mjs|--all', cwd, probe).replace(/\\/g, '/'),
    'D:/proj/judge.mjs', '零转义形态')
  assert.deepEqual(selectArtifacts({ cmd: 'node judge.mjs', writeSet: ['judge.mjs'], cwd, probe }), [],
    '写入面只剩判据脚本 ⇒ 无可变异产物（no-artifact 路径）')
  // 体积上限：超过 MAX_ARTIFACT_BYTES 的产物不参与变异（否则会写出 GB 级假货）
  // 断言用**字面字节数**（不用常量）——用常量会让"改常量"的变异体自我一致地活下来（实测案底）
  const sized = (size) => () => ({ exists: true, isFile: true, size })
  assert.deepEqual(selectArtifacts({ cmd: 'node D:/proj/judge.mjs', writeSet: ['big.html'], cwd, probe: sized(2 * 1024 * 1024 + 1) }), [],
    '超限剔除')
  assert.equal(selectArtifacts({ cmd: 'node D:/proj/judge.mjs', writeSet: ['ok.html'], cwd, probe: sized(2 * 1024 * 1024) }).length, 1,
    '恰好等于上限仍参与')
  assert.equal(MAX_ARTIFACT_BYTES, 2 * 1024 * 1024, '上限口径=2MiB')
})

test('f7 判定：字面壳绿 ⇒ vacuous；空转壳绿 ⇒ vacuous', () => {
  const arts = ['D:/proj/out.html']
  const lit = falsifyVerdict([{ kind: 'literal', state: 'green' }, { kind: 'inert', state: 'red' }], arts)
  assert.equal(lit.verdict, 'vacuous', '字面壳通过=判据被字符串满足')
  const inert = falsifyVerdict([{ kind: 'literal', state: 'red' }, { kind: 'inert', state: 'green' }], arts)
  assert.equal(inert.verdict, 'vacuous', '空转壳通过=判据不依赖行为')
})

test('f8 判定：两者皆红 ⇒ sensitive；全 broken ⇒ unproven；无产物 ⇒ no-artifact', () => {
  const arts = ['D:/proj/out.html']
  assert.equal(falsifyVerdict([{ kind: 'literal', state: 'red' }, { kind: 'inert', state: 'red' }], arts).verdict, 'sensitive')
  assert.equal(falsifyVerdict([{ kind: 'literal', state: 'broken' }, { kind: 'inert', state: 'broken' }], arts).verdict, 'unproven',
    'broken ≠ red：跑不了不能算敏感（也不能算通过）')
  assert.equal(falsifyVerdict([], []).verdict, 'no-artifact')
  assert.equal(falsifyVerdict([{ kind: 'literal', state: 'red' }], arts).verdict, 'sensitive', '至少一条红即可判敏感')
})

test('f9 可达集：判据的本地 import 闭包（自包含判据也能被伪造）', () => {
  const cwd = 'D:/proj'
  const files = {
    'd:/proj/judge.mjs': "import { helper } from './lib/helper.mjs'\nimport { other } from './lib/other.mjs'\nhelper(other)",
    'd:/proj/lib/helper.mjs': "import { deep } from './deep.mjs'\ndeep()",
    'd:/proj/lib/deep.mjs': 'export const deep = () => 1',
    'd:/proj/lib/other.mjs': 'export const other = () => 2',
    'd:/proj/out.txt': 'NEEDLE',
  }
  const probe = (p) => { const v = files[String(p).replace(/\\/g, '/').toLowerCase()]; return v === undefined ? { exists: false, isFile: false, size: 0 } : { exists: true, isFile: true, size: v.length } }
  const readFile = (p) => { const v = files[String(p).replace(/\\/g, '/').toLowerCase()]; if (v === undefined) throw new Error('ENOENT'); return v }
  const got = reachableFiles('D:/proj/judge.mjs', { cwd, probe, readFile }).map((p) => p.replace(/\\/g, '/').toLowerCase()).sort()
  assert.deepEqual(got, ['d:/proj/lib/deep.mjs', 'd:/proj/lib/helper.mjs', 'd:/proj/lib/other.mjs'],
    '递归拿 import 闭包（判据自己不算）')
  const arts = selectArtifacts({ cmd: 'node D:/proj/judge.mjs', writeSet: [], cwd, probe, extra: reachableFiles('D:/proj/judge.mjs', { cwd, probe, readFile }) })
  assert.equal(arts.length, 3, '可达集进产物集 ⇒ 伪造它判据才会红')
})

test('f10 可达集：路径字面量限工作区内（不碰工作区外的用户文件）', () => {
  const cwd = 'D:/proj'
  const files = {
    'd:/proj/judge.mjs': 'const A = "D:/proj/out.txt"\nconst B = "D:/outside/user-data.txt"\nconsole.log(A, B)',
    'd:/proj/out.txt': 'x',
    'd:/outside/user-data.txt': 'y',
  }
  const probe = (p) => { const v = files[String(p).replace(/\\/g, '/').toLowerCase()]; return v === undefined ? { exists: false, isFile: false, size: 0 } : { exists: true, isFile: true, size: v.length } }
  const readFile = (p) => { const v = files[String(p).replace(/\\/g, '/').toLowerCase()]; if (v === undefined) throw new Error('ENOENT'); return v }
  const got = reachableFiles('D:/proj/judge.mjs', { cwd, probe, readFile }).map((p) => p.replace(/\\/g, '/').toLowerCase())
  assert.deepEqual(got, ['d:/proj/out.txt'], '工作区外的路径字面量不进变异集（安全边界）')
})
