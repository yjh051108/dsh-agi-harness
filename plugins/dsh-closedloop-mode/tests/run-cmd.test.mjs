/**
 * run-cmd.test — v0.6.29 刀一回归锁：execFile 零 shell 直跑 + 结构化三态分类（零文案依赖）。
 * 治的病的活证：r2 用不存在的可执行——不靠任何本地化文案即判 broken（d3 GBK 案底类）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execCmdSync, classifyFailure } from '../src/run-cmd.js'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-rc-'))
process.env.DSH_HOME = TMP

test('r1 node 形态零 shell 直跑（execFile）——输出真实', () => {
  const p = path.join(TMP, 'echo.mjs')
  fs.writeFileSync(p, 'console.log("ok=42")')
  const out = execCmdSync(`node "${p}"`, { timeout: 8000 })
  assert.match(out, /ok=42/)
})

test('r2 不存在的可执行 → ENOENT 结构分类 broken（零文案依赖——GBK/locale 免疫）', () => {
  assert.throws(() => execCmdSync('no-such-exe-xyz-abc --version', { timeout: 5000 }))
  try { execCmdSync('no-such-exe-xyz-abc --version', { timeout: 5000 }) } catch (e) {
    const c = classifyFailure(e)
    assert.equal(c.state, 'broken')
    assert.match(c.err, /ENOENT/)
  }
})

test('r3 缺的是路径形脚本 → pending（v0.8.2 案底修正：命令形态过·物料未就位，dry-run 挂账不拒）', () => {
  try { execCmdSync('node "' + path.join(TMP, 'no-such.mjs') + '"', { timeout: 8000 }) } catch (e) {
    const c = classifyFailure(e)
    assert.equal(c.state, 'pending', '路径形模块缺失=物料未就位（不再是 broken 死锁）')
    assert.match(c.err, /物料未就位/)
  }
})

test('r5 裸包名缺失 → 仍 broken（真依赖缺=形态不可用）', () => {
  try { execCmdSync('node -e "import(\'nope-pkg-xyz-abc\')"', { timeout: 8000 }) } catch (e) {
    assert.equal(classifyFailure(e).state, 'broken')
  }
})

test('r6 引号内含比较/逻辑运算符的 node -e：走 execFile（裸 node→宿主二进制，零壳）', () => {
  const out = execCmdSync('node -e "const a=3;process.stdout.write(String(a>=3&&a<=5))"', { timeout: 8000 })
  assert.equal(out.trim(), 'true')
})

test('r7 683a3cae 原判据形态：node -e import 缺失模块 → pending（物料未就位，不再逼出人判）', () => {
  try { execCmdSync('node -e "import(\'./no-such-dir/mod.mjs\').then(()=>{})"', { timeout: 8000 }) } catch (e) {
    const c = classifyFailure(e)
    assert.equal(c.state, 'pending', '引号内 import 路径形缺失=物料未就位')
  }
})

test('r9 引号外壳运算符一票拒（零壳协议，带指路不猜进壳）', () => {
  try { execCmdSync('node D:/x.mjs | findstr ok', { timeout: 8000 }); assert.fail('应拒') } catch (e) {
    const c = classifyFailure(e)
    assert.equal(c.state, 'broken')
    assert.match(String(e.message), /协议禁壳/)
  }
})

test('r4 真红（脚本 exit≠0）→ red（能跑=条件未满足，非跑不了）', () => {
  const p = path.join(TMP, 'fail.mjs')
  fs.writeFileSync(p, 'console.error("boom"); process.exit(3)')
  try { execCmdSync(`node "${p}"`, { timeout: 8000 }); assert.fail('应抛') } catch (e) {
    assert.equal(classifyFailure(e).state, 'red')
  }
})

test('r5 shell 语法命令回落 execSync（兼容位）', () => {
  // 纯 echo 管道：平台差异大，这里只验证回落路径不抛 clazz 之外的错且能分类
  try { execCmdSync('echo a && echo b', { timeout: 5000 }) } catch (e) {
    assert.ok(['red', 'broken'].includes(classifyFailure(e).state), '回落路径仍三态可分类')
  }
})

test('r10 命令 cwd 生效：opts.cwd 传入后进程在指定目录执行（v0.8.6 会话工作区基准）', () => {
  const out = execCmdSync('node -e "console.log(process.cwd())"', { timeout: 8000, cwd: TMP })
  assert.equal(path.resolve(out.trim()), path.resolve(TMP))
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
