/**
 * SemanticScorer — 纯算法语义打分器（v0.5：不用 embedding 模型）。
 *
 * 用户方向：embedding 是"借来的语义"（预训练先验），记忆系统的语义应
 * 来自图谱自身结构与库内统计——自举、确定性、可解释。
 *
 * 语义通道（分数 ∈ [0,1]，语义对齐原 cos 标定，0.6 阈值沿用）：
 *  ① 词汇通道（lexical）：字符 n-gram Jaccard × 词频覆盖——"因为字词
 *     重叠度高"（保底精确，可解释）；
 *  ② 图语义通道（graph）：候选的因果/链接邻居是否命中查询哈希节点——
 *     "因为沿着边相连"（可解释，怎么索引就怎么推荐）；
 *  ③ 统计语义通道（cooc，核心收敛通道）：**词-词共现相似**（PMI 风格，
 *     零矩阵分解）——查询词与记忆词的共现强度。能学语义桥（「缓存」
 *     与「cache」在同一记忆共现 → 共现计数建桥 → 查询命中），随记忆
 *     增多收敛（共现计数依概率收敛）。
 *     诚实声明：学的是"用户的语义空间"（库内统计），通用性上限低于
 *     预训练模型，但在单用户记忆库场景自举、可解释、无外部依赖。
 *     （v0.5 迭代：曾用谱分解（幂迭代 PCA），实测词向量坍缩——无关词
 *     余弦 0.8+，deflate 残留致全词同向；改为直接共现相似，零分解
 *     零坍缩风险，且更可解释。）
 *
 * 纯 CPU：比 ONNX 快几个数量级，永不失败（无模型依赖）。
 */
import type { EngramStore, EngramNode } from './store.js';
export interface SemanticScore {
    /** 融合分数 [0,1]（语义对齐原 cos，0.6 阈值沿用）。 */
    score: number;
    /** 通道分解（可解释：为什么是这个分）。 */
    lexical: number;
    graph: number;
    cooc: number;
}
export declare class SemanticScorer {
    private store;
    /** 查询哈希命中的节点 id 集（图语义通道的种子）。 */
    private queryHits;
    private cooc;
    constructor(store: EngramStore);
    /**
     * 对候选打分（同步纯算法）：score = α·lexical + β·graph + γ·cooc。
     * α/β/γ 初始标定（0.5/0.25/0.25）；后续可经 fit-tau 数据驱动调整。
     */
    /** 查询级结果缓存（LRU 16——重复查询免重算；压力阀场景同主题多轮查询收益大） */
    private scoreCache;
    score(query: string, candidates: EngramNode[]): Map<string, SemanticScore>;
    /** store 变化后调用（共现表懒重建——写入/蒸馏后）。 */
    markDirty(): void;
    /** 图语义种子暴露（调试/测试）。 */
    hits(): Set<string>;
    /** 查询扩展词（粗筛用——共现邻居进 token 倒排，语义对齐）。 */
    expandQuery(query: string, topK?: number): string[];
}
