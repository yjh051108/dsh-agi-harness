/**
 * 类脑激活缓存（ACT-R 风格）：基础激活 B = ln(Σ t_k^(-d))。
 *
 * - t_k：距第 k 次强化事件（写入/命中/展开/链接）的经过时间（分钟）；
 * - d：衰减系数（ACT-R 典型 0.5——幂律遗忘曲线）；
 * - 刚强化（t 小）贡献大，久未强化（t 大）衰减——使用即巩固、闲置即遗忘；
 * - 全量重建在启动时一次；增量更新在每次强化后（O(强化数)）。
 */
import type { EngramNode } from './store.js';
export declare class ActivationCache {
    private base;
    private decay;
    constructor(decay?: number);
    /** 单节点基础激活：B = ln(Σ t^(-d))，t 取分钟粒度（避免 0/负）。 */
    static baseActivation(reinforces: number[] | undefined, now?: number, d?: number): number;
    /** 全量重建（启动/规模变更时）。 */
    rebuild(nodes: EngramNode[]): void;
    /** 增量更新（单节点强化后）。 */
    update(id: string, reinforces: number[] | undefined): void;
    /** 移除（删除节点时）。 */
    remove(id: string): void;
    /** 查询基础激活；未知节点返回 0。 */
    get(id: string): number;
    /** 缓存条目数。 */
    get size(): number;
}
