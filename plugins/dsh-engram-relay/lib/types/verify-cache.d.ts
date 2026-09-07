/**
 * VerifyCache — 灵枢验证结果 LRU 缓存（v0.4.0 性能优化）。
 *
 * 背景：每轮唤醒会对「查询文本 + 命中的 engram（最多 3 条）」各发一次
 * auto_verify HTTP；同一主题的连续轮次会重复相同调用（实测重复主题
 * 高发）。缓存按文本哈希去重：TTL 10min、容量 128、LRU 淘汰。
 *
 * 关键取舍：**error 结果不缓存**——服务恢复后立即重试，不被错误结果
 * 掩盖（自愈闭环的前提）。anchored/unverified/partial 缓存期内直接
 * 命中，同主题重复轮次零 HTTP。
 *
 * 可测性：now 注入（假时钟，TTL 测试确定性）。
 */
import type { VerifyMark } from './types.js';
export interface VerifyCacheOptions {
    /** 缓存有效期（ms）。 */
    ttlMs?: number;
    /** 最大条目数（超出按 LRU 淘汰最旧）。 */
    capacity?: number;
    /** 时钟注入（测试用）。 */
    now?: () => number;
}
export declare class VerifyCache {
    private map;
    private readonly ttlMs;
    private readonly capacity;
    private readonly now;
    constructor(opts?: VerifyCacheOptions);
    /** djb2 文本哈希（确定性；仅作缓存键，碰撞无副作用——最多少命中一次）。 */
    static hashText(text: string): string;
    /** 命中且未过期 → 返回标注并刷新 LRU 位置；否则 null。 */
    get(text: string): VerifyMark | null;
    /** 写入缓存。error 不缓存（服务恢复后立即重试）。 */
    set(text: string, mark: VerifyMark): void;
    clear(): void;
    get size(): number;
}
