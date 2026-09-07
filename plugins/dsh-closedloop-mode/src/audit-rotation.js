/**
 * audit-rotation — v0.5.4 R17 审计锚外生（纯函数+磁盘种子，可单测）。
 * 两刀：①auditor 槽位=轮转计数器（被审者不可选）；②派发 prompt=宿主固定模板（带 sha256，
 * 被审者改一字哈希即变，audit_record 回执可对验）。收集结果仍走 audit_record 硬验（引文逐字）——
 * 本模块消"选择偏差+框架偏差"，不替代证据闸。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** auditor 槽位注册表（v1 两槽轮转；接真多模型/多预设时扩表——表本身在盘可审）。 */
export const AUDITOR_SLOTS = ['fresh-subagent-default', 'fresh-subagent-alt']

export const AUDIT_PROMPT_TEMPLATE = (targetSid, targetTitle, briefText) => {
  const stackPath = join(process.env.DSH_HOME || '', 'graded-state', targetSid + '.optimal.json')
  // v0.6.32 重写（导演定向「工单说人话」）：一套输出契约、规则按逻辑排（不按版本考古）、零协议代号。
  const brief = briefText ? `\n【审材·机械切片（栈文件读不到时凭此工作）】\n${briefText}\n` : '\n【审材】未生成（按栈文件路径直读；文件不可读=在 issues 如实标注未能独立复验项）\n'
  return [
    '你是独立审计员（系统派发，不由被审者选择）。审这 1 个动作的推导链，不审产物好坏：',
    '「' + targetTitle + '」',
    '材料（只读；禁止写操作、禁止执行会改变系统状态的命令）：',
    '1. 栈文件：' + stackPath + '（以此为准）',
    '2. 该动作的盘档产物（若栈内 evidence 字段指向路径）。' + brief,
    '审三问：',
    '1 预测的依据是真实读数/实跑（read/probe/engram），不是自造标准？',
    '2 实测与预测的吻合可以独立复算（不是嘴上说一致）？',
    '3 失败归因诚实（没把预言失效说成外部变更）？',
    '回执：最终消息只输出一个 JSON（≤1KB）：',
    '{"verdict":"pass 或 reject","issues":["reject 时必填：问题定位"],"quotes":[{"path":"<栈文件路径>","quote":"<栈文件原文逐字子串>"}]}',
    '引文规则：quotes 必须是栈文件原文的逐字子串（系统会机械比对，伪造即拒）；审材里以「…」截断行不可引；栈文件读不到=凭内置审材继续审（有材必审，不许拒审）；无法独立复验的点写进 issues 如实说明，不编造证据。',
  ].join('\n')
}

export function templateHash(promptText) {
  return createHash('sha256').update(promptText).digest('hex').slice(0, 16)
}

export function rotationPath(dir) {
  return join(dir, 'audit-rotation.json')
}

/** 取下一槽：原子读增计数器。返回 {slot, index, counter}——同 counter 可复算（确定性）。 */
export function nextAuditorSlot(dir) {
  let counter = 0
  try { if (existsSync(rotationPath(dir))) counter = JSON.parse(readFileSync(rotationPath(dir), 'utf8')).counter || 0 } catch { /* 坏文件=从 0 重计，留痕在回执 */ }
  counter += 1
  try { mkdirSync(dir, { recursive: true }); writeFileSync(rotationPath(dir), JSON.stringify({ counter, at: Date.now() }), 'utf8') } catch { /* 盘不可写：仍返回确定性槽位（内存序） */ }
  const index = counter % AUDITOR_SLOTS.length
  return { slot: AUDITOR_SLOTS[index], index, counter }
}

/** 派发卡（v0.6.24 单卡执行：程序化拉起废除——回执=子代理最终消息回流，无需镜像文件）。
 *  briefText 可选：盘档机械审材注入（读不到盘档时凭此工作）；审计不缺席。 */
export function dispatchCard(targetSid, targetTitle, dir, briefText) {
  const prompt = AUDIT_PROMPT_TEMPLATE(targetSid, targetTitle, briefText)
  const rot = nextAuditorSlot(dir)
  return { ...rot, promptHash: templateHash(prompt), prompt, auditSid: 'audit-' + String(targetSid).slice(-8) + '-' + rot.counter }
}
