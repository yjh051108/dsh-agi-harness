#!/usr/bin/env node
/**
 * check-iou — 人判欠据阻塞 · 真实案卷重放（判据用，<1s）
 *
 * 重放池核案（session-1f8c4faa）：那场 11 条断言里 7 条是**人判**（机器没有通道：
 * 无视觉输入、无 GPU、无耳朵），terminal_check 却把它们记成「未机械验证（挂账可审计）」，
 * 交付口径仍是「11 条断言全绿·交付完成」。
 *
 * 断言（任一不符 → exit 1）：
 *   ① 7 条人判项 ⇒ terminalCheck.zero === false（未付欠据不得归零）
 *   ② openIOU === 7，且逐条文本与账本一致
 *   ③ 真人「签收全部」后 ⇒ zero === true（支付通道有效，不是死锁）
 */
import { initMode, onGroupsEdit, recordIOU, payIOU, openIOU, terminalCheck } from '../src/mode-state.js'

/** 池核账本 session-1f8c4faa 的 7 条人判项（逐字） */
export const POOLCORE_HUMAN = [
  '尺度符合人体真实（门高≈2.1m、层高 3.3~7m、池深 1.2~2.2m），无微缩感',
  '浏览器截图可见灯管倒映水面、池底瓷砖网格与焦散光斑',
  '截图画面无塑料感、墙角有 AO 阴影且高光泛光正常不过曝',
  '出生点位于入口长廊且朝向泳池大厅，WASD 行走碰撞无穿墙',
  '进入场景可闻低频嗡鸣与随机水滴，灯管有可见闪烁',
  '开发者在本机浏览器双击运行验收：画面符合池核+后室美学、60FPS 目标达成或差距已报告',
  'check.mjs 命令可独立运行并输出 OK/MISS 清单（人工抽查）',
]

const g = onGroupsEdit(initMode(), [{ title: '终验交付', spec: '池核案', accept: ['cmd: node --version', ...POOLCORE_HUMAN.map((t) => '人判: ' + t)], verify: 'self' }])
if (!g.ok) { console.error('⛔ 重放构造失败：' + g.error); process.exit(1) }
let s = { ...g.state, stage: 'final', weightsLocked: true, groups: g.state.groups.map((x) => ({ ...x, settled: { at: Date.now(), verdict: 'mechanical-settle' } })) }
s = recordIOU(s, '终验交付', POOLCORE_HUMAN)

const rep = terminalCheck({ purpose: '池核案重放' }, { steps: [{ title: 'A', status: 'closed' }] }, s, 'final')
const r1 = rep.zero === false
const r2 = rep.openIOU.length === 7 && POOLCORE_HUMAN.every((t, i) => rep.openIOU[i].text === t)
const paid = payIOU(s, new Set(['全部']))
const r3 = terminalCheck({ purpose: '池核案重放' }, { steps: [{ title: 'A', status: 'closed' }] }, paid, 'final').zero === true

console.log(`[iou] ${r1 ? 'PASS' : 'FAIL'} poolcore-not-zero — zero=${rep.zero}（必须 false：7 条人判未签收）`)
console.log(`[iou] ${r2 ? 'PASS' : 'FAIL'} poolcore-open-7 — openIOU=${rep.openIOU.length}（必须 7，逐条文本一致=${r2}）`)
console.log(`[iou] ${r3 ? 'PASS' : 'FAIL'} sign-off-pays — 签收全部后 zero=${terminalCheck({}, { steps: [{ title: 'A', status: 'closed' }] }, paid, 'final').zero}（必须 true）`)
const bad = [r1, r2, r3].filter((x) => !x).length
console.log(`[iou] ${bad ? 'FAIL' : 'PASS'} — 断言 3 · 未过 ${bad}`)
process.exit(bad ? 1 : 0)
