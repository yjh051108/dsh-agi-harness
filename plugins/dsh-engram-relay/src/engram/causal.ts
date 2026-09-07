/**
 * CausalGraph — engram 因果图。
 *
 * 节点 = engram，边 = 因果关系（causes / effects 双向往返）。
 * 这是「比普通向量索引更强」的核心：唤醒不只按语义相似度取 top-k，
 * 而是从种子节点出发沿因果边传播激活分数——
 * 能召回「导致当前问题的前因」与「依赖当前结论的后果」。
 */

import { EngramStore, type EngramNode } from './store.js'

/** 因果边类型。 */
export type CausalEdgeKind = 'causes' | 'depends-on' | 'references'

export interface CausalEdge {
  from: string
  to: string
  kind: CausalEdgeKind
  /** 因果强度 0-1（蒸馏时小模型打分）。 */
  weight: number
}

/** 激活传播配置。 */
export interface PropagationConfig {
  /** 传播衰减因子：每跳衰减多少。 */
  decay: number
  /** 最大传播跳数。 */
  maxHops: number
  /** 激活阈值：低于此值的节点不入结果。 */
  threshold: number
}

const DEFAULT_PROPAGATION: PropagationConfig = { decay: 0.5, maxHops: 3, threshold: 0.1 }

export class CausalGraph {
  /** adjacency: node -> edges out */
  private out = new Map<string, CausalEdge[]>()
  private inEdges = new Map<string, CausalEdge[]>()

  constructor(private store: EngramStore, options: { rebuild?: boolean } = {}) {
    if (options.rebuild !== false) this.rebuild()
  }

  /** 从 store 全量重建（启动时 / 蒸馏后调用）。 */
  rebuild(): void {
    this.out.clear()
    this.inEdges.clear()
    for (const e of this.store.all()) {
      for (const causeId of e.causes) {
        this.addEdgeInternal(causeId, e.id, 'causes', 1)
      }
      for (const effectId of e.effects) {
        this.addEdgeInternal(e.id, effectId, 'causes', 1)
      }
    }
  }

  addEdge(from: string, to: string, kind: CausalEdgeKind = 'causes', weight = 1): void {
    this.addEdgeInternal(from, to, kind, weight)
  }

  private addEdgeInternal(from: string, to: string, kind: CausalEdgeKind, weight: number): void {
    if (from === to) return
    const edge: CausalEdge = { from, to, kind, weight }
    const list = this.out.get(from) ?? []
    // 去重：同 from/to/kind 只保留一条
    if (!list.some((e) => e.to === to && e.kind === kind)) {
      list.push(edge)
      this.out.set(from, list)
      const inList = this.inEdges.get(to) ?? []
      inList.push(edge)
      this.inEdges.set(to, inList)
    }
  }

  /** 沿因果图传播激活：从种子分数出发，向 causes（前因）与 effects（后果）双向扩散。 */
  propagate(seedScores: Map<string, number>, config: Partial<PropagationConfig> = {}): Map<string, number> {
    const { decay, maxHops, threshold } = { ...DEFAULT_PROPAGATION, ...config }
    const active = new Map<string, number>()
    const queue: Array<{ id: string; score: number; hops: number }> = []

    for (const [id, score] of seedScores) {
      active.set(id, score)
      queue.push({ id, score, hops: 0 })
    }

    while (queue.length > 0) {
      const { id, score, hops } = queue.shift()!
      if (hops >= maxHops) continue

      const edges = [...(this.out.get(id) ?? []), ...(this.inEdges.get(id) ?? [])]
      for (const edge of edges) {
        const neighbor = edge.to === id ? edge.from : edge.to
        const contribution = score * decay * edge.weight
        if (contribution < threshold) continue
        const current = active.get(neighbor) ?? 0
        if (contribution > current) {
          active.set(neighbor, contribution)
          queue.push({ id: neighbor, score: contribution, hops: hops + 1 })
        }
      }
    }
    return active
  }

  /** 取某节点的直接前因（供召回结果展示因果链）。 */
  causesOf(id: string): EngramNode[] {
    const ids = (this.inEdges.get(id) ?? [])
      .filter((e) => e.kind === 'causes')
      .map((e) => e.from)
    return this.store.getMany(ids)
  }

  /** 取某节点的直接后果（供召回结果展示因果链）。 */
  effectsOf(id: string): EngramNode[] {
    const ids = (this.out.get(id) ?? [])
      .filter((e) => e.kind === 'causes')
      .map((e) => e.to)
    return this.store.getMany(ids)
  }

  edgeCount(): number {
    let n = 0
    for (const list of this.out.values()) n += list.length
    return n
  }
}
