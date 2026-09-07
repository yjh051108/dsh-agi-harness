/**
 * EngramWakeEngine — 超稀疏精准主动唤醒。
 *
 * 唤醒管线（每回合自动执行，无需模型调用工具）：
 *  1. 哈希粗筛：对当前请求文本做 N-gram 哈希（确定性，O(1)），
 *     命中外置 engram 表的槽位 → 候选记忆（精确寻址，不含近似性）；
 *  2. 语义精排：bge 嵌入模型对候选做余弦重排（修掉哈希的
 *     mode-level 跨主题误命中——实测 80 查询精确率 85% → 95%），
 *     嵌入不可用时降级为重要度/遗留门控打分；
 *  3. 因果传播：从命中种子沿因果图双向扩散（前因/后果）——
 *     「什么导致了它 / 它导致了什么」，这是向量索引做不到的；
 *  4. 超稀疏截断：激活分数排序取 top-N（maxWakePerTurn），且总注入
 *     token 受预算约束（默认 600 token ≈ 100k 上下文的 <1%）。
 *
 * 相比普通向量索引：向量索引回答「语义上像什么」（近似），本引擎
 * 回答「确定命中了什么 + 语义上相关什么 + 因果上牵连什么」（精确 +
 * 语义 + 因果）。
 */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { NgramHashAddressing } from './hash.js';
import { CausalGraph } from './causal.js';
import { EngramStore, type EngramNode } from './store.js';
import type { EngramRelayConfig, VerifyMark } from '../types.js';
export interface WakeHit {
    engrams: EngramNode[];
    reason: string;
    injectedTokens: number;
    /** 融合：选中条目的灵枢白箱验证标注（id → 结果）；未启用验证时缺省。 */
    verify?: Record<string, VerifyMark>;
}
/**
 * 查看者视角（分层准入依据）：
 *  - global：所有会话可唤醒；
 *  - project：仅 node.projectId === viewer.cwd 的会话；
 *  - session：仅 node.sessionId === viewer.sessionId 的本会话。
 * 无 cwd/sessionId 的视角（subagent 等）只看 global 层。
 */
export interface WakeViewer {
    sessionId?: string;
    cwd?: string;
    /** 当前回合号（时序衰减用：近期记忆加权） */
    turn?: number;
}
/** 打分回调：embedder（语义精排）优先，scorer（遗留门控）兜底。 */
export interface WakeScorers {
    embedder?: (query: string, candidates: EngramNode[]) => Promise<Map<string, number> | null>;
    scorer?: (query: string, candidates: EngramNode[]) => Promise<Map<string, number>>;
}
export declare class EngramWakeEngine {
    private store;
    private graph;
    private hasher;
    private config;
    /** 打分器（bge 语义精排 + 遗留门控）；缺省 = 纯哈希 + 重要度。 */
    private scorers;
    /** 候选预筛钩子（向量索引粗筛用）：返回候选 id 列表；null = 回退哈希 lookup。 */
    private prefilter;
    /** 类脑激活缓存（B=ln(Σt^-d)）：排序融合（阶段 3）；缺省 = 无激活加权。 */
    private activation;
    /** 融合：灵枢白箱验证钩子（对选中的 engram 返回标注）；null = 关闭。 */
    private verifier;
    /** 融合：浅思维钩子（对查询+唤醒结果返回浅思维文本段）；null = 关闭。 */
    private knowledgeSource;
    /** 最近一次唤醒结果（供 systemPrompt 渲染器读取）。 */
    private lastInjection;
    /** v2.2 压力阀：会话内查询历史（环形 8）——重复主题 = 深推压力信号 */
    private queryHistory;
    /** 融合：最近一次查询的知识之书段（renderInjection 合并注入）。 */
    private lastKnowledge;
    constructor(store: EngramStore, graph: CausalGraph, hasher: NgramHashAddressing, config: EngramRelayConfig, 
    /** 打分器（bge 语义精排 + 遗留门控）；缺省 = 纯哈希 + 重要度。 */
    scorers?: WakeScorers | null, 
    /** 候选预筛钩子（向量索引粗筛用）：返回候选 id 列表；null = 回退哈希 lookup。 */
    prefilter?: ((query: string) => Promise<string[] | null>) | null, 
    /** 类脑激活缓存（B=ln(Σt^-d)）：排序融合（阶段 3）；缺省 = 无激活加权。 */
    activation?: import('./activation.js').ActivationCache | null, 
    /** 融合：灵枢白箱验证钩子（对选中的 engram 返回标注）；null = 关闭。 */
    verifier?: ((node: EngramNode) => Promise<VerifyMark | null>) | null, 
    /** 融合：浅思维钩子（对查询+唤醒结果返回浅思维文本段）；null = 关闭。 */
    knowledgeSource?: ((query: string, hit: {
        engrams: EngramNode[];
    }) => Promise<string | null>) | null);
    /** 每回合入口（自动唤醒，极克制）：哈希预筛 → 查询质量门 → 自动阈值 0.5 → top-1。 */
    maybeWake(sessionId: string, _options: GenerateOptions, viewer?: WakeViewer): Promise<WakeHit>;
    /** 融合：拉取浅思维段（独立于记忆命中；失败降级为空）。 */
    private pullKnowledge;
    /** 核心查询：向量/哈希粗筛 → 分层准入 → 语义精排（bge）→ 因果传播 → 分层稀疏选择。 */
    query(query: string, limit: number, viewer?: WakeViewer, opts?: {
        auto?: boolean;
        skipVerify?: boolean;
    }): Promise<WakeHit>;
    /** 渲染记忆注入段（动态预算：按相关度分级——高分完整入口、中分标题+摘要、低分仅标题）。 */
    renderInjection(budgetTokens: number): string;
    /** 供 status 工具读取。 */
    lastWake(): WakeHit;
}
/** 粗略 token 估算：CJK 约 1 字 ≈ 0.7 token（DeepSeek 中文实测 ~1.4 字/token），ASCII ≈ 0.25 token/字符。 */
export declare function estimateTokens(text: string): number;
