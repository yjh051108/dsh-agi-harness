/**
 * ability-organ — v0.6.0 能力印记（人格养成正面侧：做好也被看到——阿德勒鼓励机制化）。
 * 归零特征（本单 closed/组数/证据权重）→ 主体档案 ability.jsonl（追加不可篡改）；
 * 摘要=正向引导面（『你已完成 N 单归零…』——有档案才有，无=零税）。
 * 数据：graded-state/ability.jsonl（主体级跨会话）；纯函数+磁盘，可单测。
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';

const gradedStateDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'graded-state');
const fileFor = (dir) => join(dir || gradedStateDir(), 'ability.jsonl');

/** 追加一条能力印记（features={closed,groups,weight}） */
export function recordAbility(features, dir) {
  const d = dir || gradedStateDir();
  try { mkdirSync(d, { recursive: true }); } catch { }
  const rec = { at: new Date().toISOString(), closed: Number(features?.closed) || 0, groups: Number(features?.groups) || 0, weight: Number(features?.weight) || 0 };
  try { appendFileSync(fileFor(d), JSON.stringify(rec) + '\n', 'utf8'); } catch { }
  return rec;
}

/** 读全部印记（无=[]） */
export function readAbilities(dir) {
  const d = dir || gradedStateDir();
  try {
    return readFileSync(fileFor(d), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** 摘要（正向引导面；无档案=空串零税） */
export function abilitySummary(dir) {
  const ls = readAbilities(dir);
  if (!ls.length) return '';
  const totalClosed = ls.reduce((s, r) => s + (r.closed || 0), 0);
  const maxGroups = Math.max(...ls.map((r) => r.groups || 0));
  return '💪 你已完成 ' + ls.length + ' 单归零（累计动作 ' + totalClosed + '+、单最大 ' + maxGroups + ' 组）——能力档案在存。';
}
