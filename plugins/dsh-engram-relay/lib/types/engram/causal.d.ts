/**
 * CausalGraph — engram 因果图。
 *
 * 节点 = engram，边 = 因果关系（causes / effects 双向往返）。
 * 这是「比普通向量索引更强」的核心：唤醒不只按语义相似度取 top-k，
 * 而是从种子节点出发沿因果边传播激活分数——
 * 能召回「导致当前问题的前因」与「依赖当前结论的后果」。
 */
import { EngramStore, type EngramNode } from './store.js';
/** 因果边类型。 */
export type CausalEdgeKind = 'causes' | 'depends-on' | 'references';
export interface CausalEdge {
    from: string;
    to: string;
    kind: CausalEdgeKind;
    /** 因果强度 0-1（蒸馏时小模型打分）。 */
    weight: number;
}
/** 激活传播配置。 */
export interface PropagationConfig {
    /** 传播衰减因子：每跳衰减多少。 */
    decay: number;
    /** 最大传播跳数。 */
    maxHops: number;
    /** 激活阈值：低于此值的节点不入结果。 */
    threshold: number;
}
export declare class CausalGraph {
    private store;
    /** adjacency: node -> edges out */
    private out;
    private inEdges;
    constructor(store: EngramStore, options?: {
        rebuild?: boolean;
    });
    /** 从 store 全量重建（启动时 / 蒸馏后调用）。 */
    rebuild(): void;
    addEdge(from: string, to: string, kind?: CausalEdgeKind, weight?: number): void;
    private addEdgeInternal;
    /** 沿因果图传播激活：从种子分数出发，向 causes（前因）与 effects（后果）双向扩散。 */
    propagate(seedScores: Map<string, number>, config?: Partial<PropagationConfig>): Map<string, number>;
    /** 取某节点的直接前因（供召回结果展示因果链）。 */
    causesOf(id: string): EngramNode[];
    /** 取某节点的直接后果（供召回结果展示因果链）。 */
    effectsOf(id: string): EngramNode[];
    edgeCount(): number;
}
