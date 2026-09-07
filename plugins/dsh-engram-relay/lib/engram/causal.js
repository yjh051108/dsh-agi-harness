/**
 * CausalGraph — engram 因果图。
 *
 * 节点 = engram，边 = 因果关系（causes / effects 双向往返）。
 * 这是「比普通向量索引更强」的核心：唤醒不只按语义相似度取 top-k，
 * 而是从种子节点出发沿因果边传播激活分数——
 * 能召回「导致当前问题的前因」与「依赖当前结论的后果」。
 */
const DEFAULT_PROPAGATION = { decay: 0.5, maxHops: 3, threshold: 0.1 };
export class CausalGraph {
    store;
    /** adjacency: node -> edges out */
    out = new Map();
    inEdges = new Map();
    constructor(store, options = {}) {
        this.store = store;
        if (options.rebuild !== false)
            this.rebuild();
    }
    /** 从 store 全量重建（启动时 / 蒸馏后调用）。 */
    rebuild() {
        this.out.clear();
        this.inEdges.clear();
        for (const e of this.store.all()) {
            for (const causeId of e.causes) {
                this.addEdgeInternal(causeId, e.id, 'causes', 1);
            }
            for (const effectId of e.effects) {
                this.addEdgeInternal(e.id, effectId, 'causes', 1);
            }
        }
    }
    addEdge(from, to, kind = 'causes', weight = 1) {
        this.addEdgeInternal(from, to, kind, weight);
    }
    addEdgeInternal(from, to, kind, weight) {
        if (from === to)
            return;
        const edge = { from, to, kind, weight };
        const list = this.out.get(from) ?? [];
        // 去重：同 from/to/kind 只保留一条
        if (!list.some((e) => e.to === to && e.kind === kind)) {
            list.push(edge);
            this.out.set(from, list);
            const inList = this.inEdges.get(to) ?? [];
            inList.push(edge);
            this.inEdges.set(to, inList);
        }
    }
    /** 沿因果图传播激活：从种子分数出发，向 causes（前因）与 effects（后果）双向扩散。 */
    propagate(seedScores, config = {}) {
        const { decay, maxHops, threshold } = { ...DEFAULT_PROPAGATION, ...config };
        const active = new Map();
        const queue = [];
        for (const [id, score] of seedScores) {
            active.set(id, score);
            queue.push({ id, score, hops: 0 });
        }
        while (queue.length > 0) {
            const { id, score, hops } = queue.shift();
            if (hops >= maxHops)
                continue;
            const edges = [...(this.out.get(id) ?? []), ...(this.inEdges.get(id) ?? [])];
            for (const edge of edges) {
                const neighbor = edge.to === id ? edge.from : edge.to;
                const contribution = score * decay * edge.weight;
                if (contribution < threshold)
                    continue;
                const current = active.get(neighbor) ?? 0;
                if (contribution > current) {
                    active.set(neighbor, contribution);
                    queue.push({ id: neighbor, score: contribution, hops: hops + 1 });
                }
            }
        }
        return active;
    }
    /** 取某节点的直接前因（供召回结果展示因果链）。 */
    causesOf(id) {
        const ids = (this.inEdges.get(id) ?? [])
            .filter((e) => e.kind === 'causes')
            .map((e) => e.from);
        return this.store.getMany(ids);
    }
    /** 取某节点的直接后果（供召回结果展示因果链）。 */
    effectsOf(id) {
        const ids = (this.out.get(id) ?? [])
            .filter((e) => e.kind === 'causes')
            .map((e) => e.to);
        return this.store.getMany(ids);
    }
    edgeCount() {
        let n = 0;
        for (const list of this.out.values())
            n += list.length;
        return n;
    }
}
