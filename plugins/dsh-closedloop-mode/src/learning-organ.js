/**
 * learning-organ — v0.5.11 学习器官（AGI 理想：经验沉淀与唤醒——闭环内部的固化）。
 * 教训即沉淀：错误事件（跨平台预检拒/判据干跑拒/预言失效）→ 追加教训日志（类别+详情+时间）。
 * 唤醒即引导：新单回执尾部附教训摘要（每单一次，克制 3 条——税有界；无教训=零税）。
 * 再犯即信号：同类计数（学习率的可观测面——未来引导体系的宏观指标）。
 * 数据：graded-state/learning.jsonl（主体级跨会话，不按会话分档）。
 * 纪律：只追加不修改（教训不可篡改）；纯函数+磁盘，可单测（dir 可注入）。
 * 依赖纪律：不 import optimal-engine（避免循环）；gradedStateDir 与其 optimalDir 同源（改需两处同步）。
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';

/** 与 optimal-engine.optimalDir 同源：join(DSH_HOME||~/.dsh, 'graded-state') */
const gradedStateDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state');
const fileFor = (dir) => join(dir, 'learning.jsonl');

/** 追加一条教训（category=类别键；detail=发生了什么；source=发生位置；sid=案发会话——跨会话不串原文） */
export function recordLesson(category, detail, source = '', dir, sid = '') {
  const d = dir || gradedStateDir();
  try { mkdirSync(d, { recursive: true }); } catch { }
  const rec = { at: new Date().toISOString(), category: String(category || 'misc'), detail: String(detail || '').slice(0, 200), source: String(source || ''), sid: String(sid || '') };
  try { appendFileSync(fileFor(d), JSON.stringify(rec) + '\n', 'utf8'); } catch { /* 教训写失败不阻断主流程 */ }
  return rec;
}

/** 读全部教训（无文件=[]） */
export function readLessons(dir) {
  const d = dir || gradedStateDir();
  try {
    const raw = readFileSync(fileFor(d), 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** 同类次数（再犯检测） */
export function sameCategoryCount(category, dir) {
  return readLessons(dir).filter((r) => r.category === category).length;
}

/** 类别 → 通用提醒（任务语，教怎么提分，不复述案例）。 */
const GENERIC = {
  'cmd-crossplatform': '探针命令要用 Windows 可执行形态（node 绝对路径或 execFile: 零转义）',
  'reconcile-mismatch': '交实测前先真跑一遍，别信记忆里的数',
  'judge-dryrun': '判据命令先 dry-run 跑通再挂（跑不了≠判据红）',
  'probe-e-inline': '探针别用 -e 内联，落 .mjs 再 node 跑它',
}

/** 摘要文本（限 N 条，按时间取最近；格式=一行一条：类别 × 次数 + 提醒）。
 *  v0.8.1 串味修复（对照案底：跨会话串味——回执出现他会话具体数字）：
 *  具体案例原文只对**同会话**开放，跨会话只给类别级通用提醒——防照抄别人的数。 */
export function lessonSummary(limit = 3, dir, sid = '') {
  const ls = readLessons(dir);
  if (ls.length === 0) return '';
  const counts = {};
  const last = {};
  for (const r of ls) {
    counts[r.category] = (counts[r.category] || 0) + 1;
    last[r.category] = r;
  }
  const cats = Object.keys(counts);
  const lines = cats.map((cat) => {
    const n = counts[cat];
    const mine = sid && last[cat].sid === sid
    const tail = mine ? String(last[cat].detail).slice(0, 60) : (GENERIC[cat] || '同类错误再犯会计入信誉')
    return '  · ' + cat + '×' + n + (n > 1 ? '（再犯提醒）' : '') + '——' + tail;
  });
  return '\n📚 你的教训（同类再犯会被点名）：\n' + lines.slice(-limit).join('\n');
}
