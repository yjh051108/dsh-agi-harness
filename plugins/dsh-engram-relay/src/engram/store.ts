/**
 * EngramStore — 大一统记忆图谱（JSONL 持久化）。
 *
 * 模型（参考 Obsidian 双向链接 + skill 渐进式披露）：
 *  - **节点**：统一记忆（不预分轨/不硬编码分层）。每条记忆 =
 *      title（入口锚点）+ summary（一句话摘要，渐进披露第一层）
 *      + content（完整正文，按需展开）+ links（双向链接 [[title]]）
 *      + causes/effects（因果边，双向可追溯）
 *  - **索引**：N-gram 哈希寻址（NgramHashAddressing）→ 槽位 → 节点，
 *    确定性 O(1) 匹配当前上下文；
 *  - **自组织**：不手动分层——链接密度/主题关联自然形成结构，
 *    唤醒按关联度排序（类 Obsidian 图谱的局部密度）。
 *
 * 定位：**单次会话上下文增强**——本会话记忆写入、入口唤醒、渐进展开、
 * 因果双向追溯；会话结束即弃（clearSession），不做跨会话沉淀。
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync, copyFileSync, readdirSync } from 'node:fs'
import { basename } from 'node:path'
/** 进程内写锁（同步标志位）：persist 是同步函数，JS 单线程下同步代码天然不交错；tmp 每实例唯一已防跨实例冲突。 */
let fileLockHeld = false
function runWithFileLock(_file: string, critical: () => void): void {
  if (fileLockHeld) {
    // 重入（不可能发生于同步 persist 链），保守直接执行
    critical()
    return
  }
  fileLockHeld = true
  try {
    critical()
  } finally {
    fileLockHeld = false
  }
}

/** 判断载荷是否完好：无 NUL 主导 + 首行可解析（空文件视为完好）。 */
function isHealthyPayload(raw: string): boolean {
  if (raw.length === 0) return true
  const nulCount = (raw.match(/\0/g) ?? []).length
  if (nulCount / raw.length > 0.1) return false
  const first = raw.split('\n').find((l) => l.trim() !== '')
  if (first === undefined) return true
  try {
    JSON.parse(first)
    return true
  } catch {
    return false
  }
}

/** 备份文件列表（新 → 旧）。 */
function listBackups(file: string): string[] {
  try {
    return readdirSync(dirname(file))
      .filter((n) => n.startsWith(basename(file) + '.bak-'))
      .sort()
      .reverse()
      .map((n) => join(dirname(file), n))
  } catch {
    return []
  }
}

/** 备份剪枝（保留最近 keep 代）。 */
function pruneBackups(file: string, keep: number): void {
  for (const b of listBackups(file).slice(keep)) {
    try { unlinkSync(b) } catch { /* 忽略 */ }
  }
}
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { NgramHashAddressing, type HashResult } from './hash.js'

/** 记忆节点类型（统一，不预分轨；kind 仅作展示标签，非分层）。 */
export type EngramKind = 'fact' | 'decision' | 'event' | 'note'

/**
 * 记忆分层（预设骨架，归属由 AI 自主决策）——分层的本质 = 生命周期 × 可见范围：
 *  - global：全局持久，所有会话可见（长期事实/用户偏好）
 *  - project：项目持久，仅同工作目录（cwd）会话可见（项目约定/决策）
 *  - session：会话临时，仅本会话（会话结束清理）
 * 层是**节点属性**（大一统图谱，不分家），不是物理分库。
 */
export type EngramLayer = 'global' | 'project' | 'session'

/** 分层常量（工具 description 引用）。 */
export const ENGRAM_LAYERS: EngramLayer[] = ['global', 'project', 'session']

/**
 * 分层可见性判定（跨会话准入的单源逻辑，wake/tools/图谱 API 共用）。
 *  - global：所有会话可见；
 *  - project：仅 node.projectId === viewer.cwd 的会话；
 *  - session：仅 node.sessionId === viewer.sessionId 的本会话。
 * 空 viewer（无 sessionId 且无 cwd）向后兼容全可见（生产路径总传 viewer，
 * 缺省仅测试/直接调用）。
 */
export function isVisible(e: EngramNode, viewer: { sessionId?: string; cwd?: string }): boolean {
  if (viewer.sessionId === undefined && viewer.cwd === undefined) return true
  switch (e.layer) {
    case 'global':
      return true
    case 'project':
      return e.projectId !== null && e.projectId === viewer.cwd
    case 'session':
      return e.sessionId !== null && e.sessionId === viewer.sessionId
    default:
      return false
  }
}

/** 渐进披露层级。 */
export interface EngramNode {
  id: string
  kind: EngramKind
  /** 分层归属（AI 自主决策）：global=全局持久 / project=项目持久 / session=会话临时。 */
  layer: EngramLayer
  /** project 层标识（会话工作目录；global/session 层为 null）。 */
  projectId: string | null
  /** 入口锚点（唤醒列表展示；如 Obsidian 的页面标题）。 */
  title: string
  /** 一句话摘要（渐进披露第一层——入口列表只给这个）。 */
  summary: string
  /** 完整正文（渐进披露第二层——展开时给）。 */
  content: string
  /** 双向链接：关联节点的 title 集（Obsidian 风格 [[title]]）。 */
  links: string[]
  /** 因果边（前因）：导致本节点的节点 id 集。 */
  causes: string[]
  /** 因果边（后果）：本节点导致的节点 id 集。 */
  effects: string[]
  /** 来源会话 id（本会话内）。 */
  sessionId: string | null
  /** 来源回合序号。 */
  turn: number
  /** 创建时间（epoch ms）。 */
  createdAt: number
  /** 关联度 0-1（唤醒排序用；自组织：链接越多/被引用越多越高）。 */
  importance: number
  /** 被唤醒次数（LRU 衰减）。 */
  hits: number
  /** 最后唤醒时间。 */
  lastHitAt: number | null
  /** 该节点对应的哈希槽位（写入时固化，重哈希可重建）。 */
  slots: string[]
  /** 确认状态：pending=待确认（不参与检索/唤醒命中），confirmed=已确认（缺省；旧数据视为 confirmed），
   *  retired=已退役（v0.4.0 过时记忆治理：退出检索/唤醒，search 可见 🗄，open/confirm/update 复活，不删数据）。 */
  status?: 'pending' | 'confirmed' | 'retired'
  /** 退役时间（epoch ms；仅 status=retired 时有值）。 */
  retiredAt?: number
  /** 强化事件时间戳（写入/命中/展开/链接；类脑激活模型 B=ln(Σt^(-d)) 的输入）。旧数据缺省 [createdAt]。 */
  reinforces?: number[]
}

/** 渐进披露视图。 */
export interface EngramEntry {
  id: string
  title: string
  summary: string
  kind: EngramKind
  /** 因果邻接摘要（入口层展示：前因/后果标题）。 */
  causeTitles: string[]
  effectTitles: string[]
  /** 双向链接标题。 */
  linkTitles: string[]
}

let seq = 0

export function createEngramId(): string {
  seq += 1
  return `e${Date.now().toString(36)}-${seq.toString(36)}`
}

export class EngramStore {
  readonly dir: string
  private file: string
  private byId = new Map<string, EngramNode>()
  /** 槽位索引：slotKey -> Set<nodeId>（派生索引，写入/加载时构建）。 */
  private slotIndex = new Map<string, Set<string>>()
  /** 标题索引：title -> nodeId（双向链接解析用）。 */
  private titleIndex = new Map<string, string>()

  constructor(storeDir: string, private hasher: NgramHashAddressing = new NgramHashAddressing()) {
    this.dir = storeDir === '' ? join(homedir(), '.dsh', 'engram-relay') : resolve(storeDir)
    this.file = join(this.dir, 'engrams.jsonl')
    if (existsSync(this.file)) {
      this.load()
    } else {
      mkdirSync(this.dir, { recursive: true })
    }
  }

  private load(): void {
    // 恢复链（绝不丢记忆防线 2）：主文件 → 各代备份（新→旧），
    // 取第一个能解析出节点的来源；主文件损坏时从最近完好备份自动恢复。
    const sources = [this.file, ...listBackups(this.file)]
    let recoveredFrom: string | null = null
    for (const src of sources) {
      if (!existsSync(src)) continue
      let raw: string
      try {
        raw = readFileSync(src, 'utf8')
      } catch {
        continue
      }
      const hadNul = raw.includes('\0')
      const cleaned = hadNul ? raw.replace(/\0+/g, '') : raw
      let loaded = 0
      let parseErrors = 0
      for (const line of cleaned.split('\n')) {
        if (line.trim() === '') continue
        try {
          const e = JSON.parse(line) as EngramNode
          // —— 旧数据迁移兜底（v0.2.0 跨会话分层前持久化的节点缺字段）——
          e.layer = e.layer ?? 'session'
          e.projectId = e.projectId ?? null
          e.slots = Array.isArray(e.slots) ? e.slots : []
          e.links = Array.isArray(e.links) ? e.links : []
          e.causes = Array.isArray(e.causes) ? e.causes : []
          e.effects = Array.isArray(e.effects) ? e.effects : []
          e.importance = typeof e.importance === 'number' ? e.importance : 0
          e.hits = typeof e.hits === 'number' ? e.hits : 0
          e.createdAt = typeof e.createdAt === 'number' ? e.createdAt : 0
          e.reinforces = Array.isArray(e.reinforces) ? e.reinforces : [e.createdAt || Date.now()]
          // v0.6.33 导演定向「engram 不该有人确认环节」：存量 ⏳pending 加载即转 confirmed
          // （确认制废除——模型自主写图直接生效；本行一次性迁移，retired 语义不动）
          if (e.status === 'pending') e.status = 'confirmed'
          // v0.3.123：标题行首 markdown/emoji/代码围栏残留清洗（加载即净——内存级）
          // ⚠️ 修复（v0.4.0）：`*-` 在字符类里是区间（0x2A-0x60，含 A-Z/a-z/0-9）——
          // 'A临时' 加载后变 '临时'（标题损坏）。**必须转义连字符**（`\-`），
          // 星号转义不改变区间语义。
          if (e.title) {
            const _t = e.title
              .replace(/^[\s#>*\-`]+/, '')
              .replace(/^[🗑️✅❌🔧📌✨⚡🏷️]+/, '')
              .trim()
            // 纯残留（如 ```）清洗后为空 → 占位标题（不保留脏标题）
            e.title = _t ? _t.slice(0, 12) : '对话片段'
          }
          this.byId.set(e.id, e)
          for (const s of e.slots) this.indexSlot(s, e.id)
          if (e.title) this.titleIndex.set(e.title, e.id)
          loaded++
        } catch {
          // 单条损坏跳过，不拖垮整个存储
          parseErrors++
        }
      }
      // 悬空链接根治（v0.3.108）：目标标题已不存在/自指 → 加载即滤（内存级，persist 写回干净）
      if (loaded > 0) {
        for (const e of this.byId.values()) {
          if (Array.isArray(e.links) && e.links.length > 0) {
            e.links = e.links.filter((t) => {
              const target = this.titleIndex.get(t)
              return target !== undefined && target !== e.id
            })
          }
        }
      }
      if (loaded > 0) {
        if (src !== this.file) {
          recoveredFrom = src
          try {
            writeFileSync(this.file, cleaned, 'utf8')
          } catch { /* 写回失败不阻塞 */ }
        }
        return
      }
      // 主文件存在、无 NUL 且完全可解析（含合法空库）→ 权威来源，不查
      // 备份——否则 clearSession/remove 清空后重载会从旧备份"复活"已删
      // 记忆。NUL 损坏（曾真实发生）不在此列：继续走备份恢复链。
      if (src === this.file && parseErrors === 0 && !hadNul) return
      // 该来源全坏 → 下一个（更旧的备份）
    }
    if (recoveredFrom) {
      console.warn(`[engram-store] recovered ${this.byId.size} nodes from backup ${recoveredFrom}`)
    }
    // 全部来源都坏：留证（主文件损坏时）后以空库继续——绝不静默清空主文件
    if (existsSync(this.file)) {
      const raw = (() => { try { return readFileSync(this.file, 'utf8') } catch { return '' } })()
      if (raw.replace(/\s/g, '').length > 64) {
        try {
          renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
          console.warn(`[engram-store] all sources corrupt; main file preserved at corrupt backup`)
        } catch { /* 备份失败不阻塞 */ }
      }
    }
  }

  private indexSlot(slot: string, id: string): void {
    let set = this.slotIndex.get(slot)
    if (!set) {
      set = new Set()
      this.slotIndex.set(slot, set)
    }
    set.add(id)
  }

  /**
   * 原子持久化：写临时文件 + rename 替换。
   *
   * 背景：web 与 headless 两个 profile 可能同时装配本插件并写同一个
   * engrams.jsonl；热重载时同一进程内也会短暂存在两个 store 实例（旧
   * fiber dispose 前的最后一次 persist 与新实例并发）。tmp 必须**每实例
   * 唯一**（曾用 `${pid}` 导致同进程两实例共用同名 tmp → writeFileSync
   * 交错 → 整文件 NUL、记忆全丢），并加进程内写锁串行化 rename 竞态。
   * Windows 上 rename 覆盖已存在文件会失败，先 unlink 目标再 rename。
   */
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const lines: string[] = []
    for (const e of this.byId.values()) lines.push(JSON.stringify(e))
    const payload = lines.join('\n') + '\n'
    // 写前快照（绝不丢记忆防线 1）：当前完好文件 → .bak-<ts>，保留 3 代。
    if (existsSync(this.file)) {
      try {
        const cur = readFileSync(this.file, 'utf8')
        if (isHealthyPayload(cur)) {
          copyFileSync(this.file, `${this.file}.bak-${Date.now()}`)
          pruneBackups(this.file, 3)
        }
      } catch { /* 快照失败不阻塞写入 */ }
    }
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    writeFileSync(tmp, payload, 'utf8')
    // 进程内写锁：热重载窗口内两实例的 rename 串行（最后写入者胜，不交错）
    runWithFileLock(this.file, () => {
      try {
        renameSync(tmp, this.file)
      } catch {
        try {
          unlinkSync(this.file)
        } catch { /* 目标不存在等，忽略 */ }
        renameSync(tmp, this.file)
      }
    })
    // 写后校验（防线 3）：读回行数一致才算成功；不一致时上一代备份仍在。
    try {
      const back = readFileSync(this.file, 'utf8')
      const backLines = back.split('\n').filter((l) => l.trim() !== '').length
      if (backLines !== lines.length) {
        console.warn(`[engram-store] persist readback mismatch: wrote ${lines.length}, read ${backLines}`)
      }
    } catch { /* 校验失败不阻塞 */ }
  }

  /**
   * 写入/更新一个记忆节点：按 title+summary 哈希寻址，挂到命中槽位。
   * 渐进披露：title/summary 是入口层，content 是展开层。
   * layer 缺省 'session'（向后兼容：旧调用语义 = 会话级即弃）。
   */
  add(input: Omit<EngramNode, 'id' | 'createdAt' | 'hits' | 'lastHitAt' | 'slots' | 'layer' | 'projectId' | 'status'>
    & { layer?: EngramLayer; projectId?: string | null; createdAt?: number; lastHitAt?: number | null; status?: 'pending' | 'confirmed' | 'retired' }): EngramNode {
    const keyText = `${input.title} ${input.summary}`
    const result = this.hasher.hash(keyText)
    const slots = this.hasher.slotKeys(result)
    const node: EngramNode = {
      ...input,
      layer: input.layer ?? 'session',
      projectId: input.projectId ?? null,
      id: createEngramId(),
      // createdAt/lastHitAt 可注入（v0.4.0：退役测试/数据迁移用；生产缺省=现在）
      createdAt: input.createdAt ?? Date.now(),
      hits: 0,
      lastHitAt: input.lastHitAt ?? null,
      slots,
      status: input.status ?? 'confirmed',
      // 写入即第一次强化（类脑：刚记住时最容易被想起）
      reinforces: input.reinforces ?? [input.createdAt ?? Date.now()],
    }
    this.byId.set(node.id, node)
    for (const s of slots) this.indexSlot(s, node.id)
    if (node.title) this.titleIndex.set(node.title, node.id)
    this.persist()
    return node
  }

  /** 按标题取节点（双向链接 [[title]] 解析）。 */
  byTitle(title: string): EngramNode | undefined {
    const id = this.titleIndex.get(title)
    return id ? this.byId.get(id) : undefined
  }

  /** 按文本哈希寻址，返回命中槽位的候选节点（去重，按关联度降序）。 */
  lookup(text: string, limit = 8): EngramNode[] {
    const result = this.hasher.hash(text)
    return this.lookupHash(result, limit)
  }

  /** 按已计算的哈希结果寻址（避免重复哈希）。 */
  lookupHash(result: HashResult, limit = 8): EngramNode[] {
    const keys = this.hasher.slotKeys(result)
    const seen = new Set<string>()
    const hits: EngramNode[] = []
    for (const k of keys) {
      const ids = this.slotIndex.get(k)
      if (!ids) continue
      for (const id of ids) {
        if (seen.has(id)) continue
        seen.add(id)
        const e = this.byId.get(id)
        // pending（待确认）/ retired（已退役）不参与哈希召回
        if (e && e.status !== 'pending' && e.status !== 'retired') hits.push(e)
      }
    }
    hits.sort((a, b) => b.importance - a.importance)
    return hits.slice(0, limit)
  }

  /** 渐进披露入口视图：摘要级 + 因果/链接邻接摘要。 */
  entry(node: EngramNode): EngramEntry {
    return {
      id: node.id,
      title: node.title,
      summary: node.summary,
      kind: node.kind,
      causeTitles: this.getMany(node.causes).map((n) => n.title),
      effectTitles: this.getMany(node.effects).map((n) => n.title),
      linkTitles: node.links.map((t) => this.byTitle(t)?.title ?? t),
    }
  }

  /** 批量入口视图。 */
  entries(nodes: EngramNode[]): EngramEntry[] {
    return nodes.map((n) => this.entry(n))
  }

  /**
   * 自组织聚类：按连接密度（links + causes/effects）自然成簇——不预定义
   * 主题、不硬编码分层。连通分量即簇；每簇选「代表节点」（连接度最高者）
   * 作为唤醒入口。类似 Obsidian 图谱的视觉密度：密集连接处自然成团。
   */
  clusters(): Array<{ label: string; members: string[]; representative: string }> {
    const all = this.all().filter((e) => e.status !== 'pending' && e.status !== 'retired')
    if (all.length === 0) return []
    // 邻接：节点间有 links 或因果边即相连
    const adj = new Map<string, Set<string>>()
    for (const n of all) adj.set(n.id, new Set())
    for (const n of all) {
      // links（双向）
      for (const t of n.links) {
        const target = this.byTitle(t)
        if (target && target.id !== n.id) {
          adj.get(n.id)!.add(target.id)
          adj.get(target.id)!.add(n.id)
        }
      }
      // 因果边
      for (const c of n.causes) {
        if (this.byId.has(c)) {
          adj.get(n.id)!.add(c)
          adj.get(c)!.add(n.id)
        }
      }
      for (const e of n.effects) {
        if (this.byId.has(e)) {
          adj.get(n.id)!.add(e)
          adj.get(e)!.add(n.id)
        }
      }
    }
    // BFS 连通分量
    const visited = new Set<string>()
    const clusters: Array<{ label: string; members: string[]; representative: string }> = []
    for (const n of all) {
      if (visited.has(n.id)) continue
      const members: string[] = []
      const queue = [n.id]
      visited.add(n.id)
      while (queue.length > 0) {
        const id = queue.shift()!
        members.push(id)
        for (const nb of adj.get(id) ?? []) {
          if (!visited.has(nb)) {
            visited.add(nb)
            queue.push(nb)
          }
        }
      }
      // 代表节点：连接度最高（邻接数最多）；并列取 importance 高者
      const representative = members.reduce((best, id) => {
        const deg = adj.get(id)?.size ?? 0
        const bestDeg = adj.get(best)?.size ?? 0
        const node = this.byId.get(id)!
        const bestNode = this.byId.get(best)!
        return deg > bestDeg || (deg === bestDeg && node.importance > bestNode.importance) ? id : best
      })
      const repNode = this.byId.get(representative)!
      clusters.push({
        label: repNode.title,
        members,
        representative,
      })
    }
    // 簇按大小降序（大的主题簇在前）
    clusters.sort((a, b) => b.members.length - a.members.length)
    return clusters
  }

  get(id: string): EngramNode | undefined {
    return this.byId.get(id)
  }

  getMany(ids: string[]): EngramNode[] {
    const out: EngramNode[] = []
    for (const id of ids) {
      const e = this.byId.get(id)
      if (e) out.push(e)
    }
    return out
  }

  all(): EngramNode[] {
    return [...this.byId.values()]
  }

  count(): number {
    return this.byId.size
  }

  slotCount(): number {
    return this.slotIndex.size
  }

  /**
   * 分层统一查询（维护/检索入口）：按层/项目/会话/类型/时间过滤。
   * 缺省按 importance 降序；recent=true 按创建时间倒序。
   */
  query(filter: {
    layer?: EngramLayer
    projectId?: string | null
    sessionId?: string
    kind?: EngramKind
    since?: number
    until?: number
    limit?: number
    recent?: boolean
  } = {}): EngramNode[] {
    let list = this.all()
    if (filter.layer !== undefined) list = list.filter((e) => e.layer === filter.layer)
    // projectId 只过滤 project 层——global/session 节点（projectId=null）不受影响
    if (filter.projectId !== undefined) list = list.filter((e) => e.layer !== 'project' || e.projectId === filter.projectId)
    if (filter.sessionId !== undefined) list = list.filter((e) => e.sessionId === filter.sessionId)
    if (filter.kind !== undefined) list = list.filter((e) => e.kind === filter.kind)
    if (filter.since !== undefined) list = list.filter((e) => e.createdAt >= filter.since!)
    if (filter.until !== undefined) list = list.filter((e) => e.createdAt <= filter.until!)
    list = [...list]
    if (filter.recent) list.sort((a, b) => b.createdAt - a.createdAt)
    else list.sort((a, b) => b.importance - a.importance)
    if (filter.limit !== undefined && filter.limit > 0) list = list.slice(0, filter.limit)
    return list
  }

  /** 分层统计（status 工具用）。 */
  layerCounts(): Record<EngramLayer, number> {
    const counts: Record<EngramLayer, number> = { global: 0, project: 0, session: 0 }
    for (const e of this.byId.values()) counts[e.layer] += 1
    return counts
  }

  /**
   * 提升/转层：改 layer 与 projectId（保留 id/因果/链接——引用不失效）。
   * 会话结束前把 session 临时记忆提升为 project/global 跨会话持久。
   */
  promote(id: string, layer: EngramLayer, projectId: string | null = null): EngramNode | undefined {
    const e = this.byId.get(id)
    if (!e) return undefined
    e.layer = layer
    e.projectId = layer === 'project' ? projectId : null
    this.persist()
    return e
  }

  /** 修正节点字段（title 变更会同步标题索引；层变更用 promote）。 */
  update(id: string, patch: Partial<Pick<EngramNode, 'title' | 'summary' | 'content' | 'links' | 'causes' | 'effects' | 'importance'>>): EngramNode | undefined {
    const e = this.byId.get(id)
    if (!e) return undefined
    if (patch.title !== undefined && patch.title !== e.title) {
      this.titleIndex.delete(e.title)
      e.title = patch.title
      if (e.title) this.titleIndex.set(e.title, e.id)
    }
    if (patch.summary !== undefined) e.summary = patch.summary
    if (patch.content !== undefined) e.content = patch.content
    if (patch.links !== undefined) e.links = patch.links
    if (patch.causes !== undefined) e.causes = patch.causes
    if (patch.effects !== undefined) e.effects = patch.effects
    if (patch.importance !== undefined) e.importance = patch.importance
    this.persist()
    return e
  }

  /** 清空一个项目（project 层全部节点；项目移除/归档时）。 */
  clearProject(projectId: string): number {
    const doomed = this.all().filter((e) => e.layer === 'project' && e.projectId === projectId)
    for (const e of doomed) this.remove(e.id)
    return doomed.length
  }

  /** 登记一次唤醒（LRU 衰减 + 激活强化：命中即复习，类脑巩固）。 */
  touch(id: string): void {
    const e = this.byId.get(id)
    if (!e) return
    e.hits += 1
    e.lastHitAt = Date.now()
    if (e.reinforces) e.reinforces.push(Date.now())
    this.persist()
  }

  /** 登记一次强化（展开/链接等深度使用——权重高于命中）。 */
  reinforce(id: string): void {
    const e = this.byId.get(id)
    if (!e) return
    e.reinforces = e.reinforces ?? [e.createdAt || Date.now()]
    e.reinforces.push(Date.now())
    this.persist()
  }

  /** 全部待确认节点（用户确认制管理面）。 */
  pending(): EngramNode[] {
    return this.all().filter((e) => e.status === 'pending')
  }

  /** 确认一个待确认节点（确认后才参与检索/唤醒命中）。幂等：已确认返回原节点。 */
  confirmNode(id: string): EngramNode | undefined {
    const e = this.byId.get(id)
    if (!e) return undefined
    if (e.status === 'pending') {
      e.status = 'confirmed'
      this.persist()
    }
    return e
  }

  /** 拒绝（删除）一个待确认节点。非 pending 节点不可拒绝（防误删已生效记忆）。 */
  rejectNode(id: string): boolean {
    const e = this.byId.get(id)
    if (!e || e.status !== 'pending') return false
    return this.remove(id)
  }

  // ---- 过时记忆治理（v0.4.0）：退役 / 复活 / 候选 ----

  /**
   * 退役候选：confirmed 且闲置超过 idleDays 且重要度 ≤ maxImportance。
   * 闲置 = now - lastHitAt（旧数据无 lastHitAt 时按 createdAt 兜底——绝不
   * 因字段缺失而误判为"新鲜"）。pending/retired 不参与。
   * 算法是参谋：只标候选不删数据——退役可复活（unretire）。
   */
  retirementCandidates(opts: { idleDays: number; maxImportance: number; now?: number }): EngramNode[] {
    const now = opts.now ?? Date.now()
    const idleMs = Math.max(1, opts.idleDays) * 86_400_000
    return this.all().filter((e) => {
      if (e.status === 'pending' || e.status === 'retired') return false
      if (e.importance > opts.maxImportance) return false
      const last = e.lastHitAt ?? e.createdAt
      return now - last >= idleMs
    })
  }

  /** 退役一个节点：退出召回/唤醒（lookup 已过滤），数据保留（search/open 可见）。 */
  retire(id: string): EngramNode | undefined {
    const e = this.byId.get(id)
    if (!e || e.status === 'pending') return undefined
    if (e.status !== 'retired') {
      e.status = 'retired'
      e.retiredAt = Date.now()
      this.persist()
    }
    return e
  }

  /** 复活一个退役节点（open/confirm/update 时自动调用）：重新参与检索/唤醒。 */
  unretire(id: string): EngramNode | undefined {
    const e = this.byId.get(id)
    if (!e) return undefined
    if (e.status === 'retired') {
      e.status = 'confirmed'
      e.retiredAt = undefined
      this.persist()
    }
    return e
  }

  /** 全部退役节点（治理盘点；search/status 用）。 */
  retiredNodes(): EngramNode[] {
    return this.all().filter((e) => e.status === 'retired')
  }

  /**
   * 同标题去重治理（v0.4.0）：同 title 的节点只保留最新（按 createdAt），
   * 旧者退役（数据保留可复活）。titleIndex 指向保留者——否则 byTitle 会
   * 命中已退役节点（open 会误复活）。
   * @returns 保留节点（无重复返回 null）。
   */
  dedupTitle(title: string): EngramNode | null {
    // 只统计 confirmed：retired 已退出治理，pending 不参与（防止重复处理/误退役）
    const nodes = this.all()
      .filter((e) => e.status === 'confirmed' && e.title === title)
      .sort((a, b) => b.createdAt - a.createdAt)
    if (nodes.length <= 1) return null
    const keeper = nodes[0]
    for (const e of nodes.slice(1)) {
      this.retire(e.id)
    }
    if (this.titleIndex.get(title) !== keeper.id) {
      this.titleIndex.set(title, keeper.id)
      this.persist()
    }
    return keeper
  }

  remove(id: string): boolean {
    const e = this.byId.get(id)
    if (!e) return false
    this.byId.delete(id)
    if (e.title) this.titleIndex.delete(e.title)
    for (const s of e.slots) {
      const set = this.slotIndex.get(s)
      if (set) {
        set.delete(id)
        if (set.size === 0) this.slotIndex.delete(s)
      }
    }
    this.persist()
    return true
  }

  /**
   * 会话隔离（分层生命周期）：只清该会话的 **session 层** 临时记忆；
   * global/project 跨会话层保留——跨会话沉淀的核心转变。
   * 复用 remove() 统一清理索引（byId/titleIndex/slotIndex）。
   */
  clearSession(sessionId: string): number {
    const doomed = this.all().filter((e) => e.sessionId === sessionId && e.layer === 'session')
    for (const e of doomed) this.remove(e.id)
    return doomed.length
  }
}
