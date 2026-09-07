/**
 * 类脑激活缓存（ACT-R 风格）：基础激活 B = ln(Σ t_k^(-d))。
 *
 * - t_k：距第 k 次强化事件（写入/命中/展开/链接）的经过时间（分钟）；
 * - d：衰减系数（ACT-R 典型 0.5——幂律遗忘曲线）；
 * - 刚强化（t 小）贡献大，久未强化（t 大）衰减——使用即巩固、闲置即遗忘；
 * - 全量重建在启动时一次；增量更新在每次强化后（O(强化数)）。
 */

import type { EngramNode } from './store.js'

const DEFAULT_DECAY = 0.5

export class ActivationCache {
  private base = new Map<string, number>()
  private decay: number

  constructor(decay: number = DEFAULT_DECAY) {
    this.decay = decay
  }

  /** 单节点基础激活：B = ln(Σ t^(-d))，t 取分钟粒度（避免 0/负）。 */
  static baseActivation(reinforces: number[] | undefined, now: number = Date.now(), d: number = DEFAULT_DECAY): number {
    if (!reinforces || reinforces.length === 0) return 0
    let sum = 0
    for (const ts of reinforces) {
      const t = Math.max(1, (now - ts) / 60000)
      sum += Math.pow(t, -d)
    }
    return Math.log(sum)
  }

  /** 全量重建（启动/规模变更时）。 */
  rebuild(nodes: EngramNode[]): void {
    const now = Date.now()
    this.base.clear()
    for (const e of nodes) {
      if (e.status === 'pending') continue
      this.base.set(e.id, ActivationCache.baseActivation(e.reinforces, now, this.decay))
    }
  }

  /** 增量更新（单节点强化后）。 */
  update(id: string, reinforces: number[] | undefined): void {
    this.base.set(id, ActivationCache.baseActivation(reinforces, Date.now(), this.decay))
  }

  /** 移除（删除节点时）。 */
  remove(id: string): void {
    this.base.delete(id)
  }

  /** 查询基础激活；未知节点返回 0。 */
  get(id: string): number {
    return this.base.get(id) ?? 0
  }

  /** 缓存条目数。 */
  get size(): number {
    return this.base.size
  }
}
