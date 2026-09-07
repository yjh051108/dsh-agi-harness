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
import { NgramHashAddressing, type HashResult } from './hash.js';
/** 记忆节点类型（统一，不预分轨；kind 仅作展示标签，非分层）。 */
export type EngramKind = 'fact' | 'decision' | 'event' | 'note';
/**
 * 记忆分层（预设骨架，归属由 AI 自主决策）——分层的本质 = 生命周期 × 可见范围：
 *  - global：全局持久，所有会话可见（长期事实/用户偏好）
 *  - project：项目持久，仅同工作目录（cwd）会话可见（项目约定/决策）
 *  - session：会话临时，仅本会话（会话结束清理）
 * 层是**节点属性**（大一统图谱，不分家），不是物理分库。
 */
export type EngramLayer = 'global' | 'project' | 'session';
/** 分层常量（工具 description 引用）。 */
export declare const ENGRAM_LAYERS: EngramLayer[];
/**
 * 分层可见性判定（跨会话准入的单源逻辑，wake/tools/图谱 API 共用）。
 *  - global：所有会话可见；
 *  - project：仅 node.projectId === viewer.cwd 的会话；
 *  - session：仅 node.sessionId === viewer.sessionId 的本会话。
 * 空 viewer（无 sessionId 且无 cwd）向后兼容全可见（生产路径总传 viewer，
 * 缺省仅测试/直接调用）。
 */
export declare function isVisible(e: EngramNode, viewer: {
    sessionId?: string;
    cwd?: string;
}): boolean;
/** 渐进披露层级。 */
export interface EngramNode {
    id: string;
    kind: EngramKind;
    /** 分层归属（AI 自主决策）：global=全局持久 / project=项目持久 / session=会话临时。 */
    layer: EngramLayer;
    /** project 层标识（会话工作目录；global/session 层为 null）。 */
    projectId: string | null;
    /** 入口锚点（唤醒列表展示；如 Obsidian 的页面标题）。 */
    title: string;
    /** 一句话摘要（渐进披露第一层——入口列表只给这个）。 */
    summary: string;
    /** 完整正文（渐进披露第二层——展开时给）。 */
    content: string;
    /** 双向链接：关联节点的 title 集（Obsidian 风格 [[title]]）。 */
    links: string[];
    /** 因果边（前因）：导致本节点的节点 id 集。 */
    causes: string[];
    /** 因果边（后果）：本节点导致的节点 id 集。 */
    effects: string[];
    /** 来源会话 id（本会话内）。 */
    sessionId: string | null;
    /** 来源回合序号。 */
    turn: number;
    /** 创建时间（epoch ms）。 */
    createdAt: number;
    /** 关联度 0-1（唤醒排序用；自组织：链接越多/被引用越多越高）。 */
    importance: number;
    /** 被唤醒次数（LRU 衰减）。 */
    hits: number;
    /** 最后唤醒时间。 */
    lastHitAt: number | null;
    /** 该节点对应的哈希槽位（写入时固化，重哈希可重建）。 */
    slots: string[];
    /** 确认状态：pending=待确认（不参与检索/唤醒命中），confirmed=已确认（缺省；旧数据视为 confirmed），
     *  retired=已退役（v0.4.0 过时记忆治理：退出检索/唤醒，search 可见 🗄，open/confirm/update 复活，不删数据）。 */
    status?: 'pending' | 'confirmed' | 'retired';
    /** 退役时间（epoch ms；仅 status=retired 时有值）。 */
    retiredAt?: number;
    /** 强化事件时间戳（写入/命中/展开/链接；类脑激活模型 B=ln(Σt^(-d)) 的输入）。旧数据缺省 [createdAt]。 */
    reinforces?: number[];
}
/** 渐进披露视图。 */
export interface EngramEntry {
    id: string;
    title: string;
    summary: string;
    kind: EngramKind;
    /** 因果邻接摘要（入口层展示：前因/后果标题）。 */
    causeTitles: string[];
    effectTitles: string[];
    /** 双向链接标题。 */
    linkTitles: string[];
}
export declare function createEngramId(): string;
export declare class EngramStore {
    private hasher;
    readonly dir: string;
    private file;
    private byId;
    /** 槽位索引：slotKey -> Set<nodeId>（派生索引，写入/加载时构建）。 */
    private slotIndex;
    /** 标题索引：title -> nodeId（双向链接解析用）。 */
    private titleIndex;
    constructor(storeDir: string, hasher?: NgramHashAddressing);
    private load;
    private indexSlot;
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
    private persist;
    /**
     * 写入/更新一个记忆节点：按 title+summary 哈希寻址，挂到命中槽位。
     * 渐进披露：title/summary 是入口层，content 是展开层。
     * layer 缺省 'session'（向后兼容：旧调用语义 = 会话级即弃）。
     */
    add(input: Omit<EngramNode, 'id' | 'createdAt' | 'hits' | 'lastHitAt' | 'slots' | 'layer' | 'projectId' | 'status'> & {
        layer?: EngramLayer;
        projectId?: string | null;
        createdAt?: number;
        lastHitAt?: number | null;
        status?: 'pending' | 'confirmed' | 'retired';
    }): EngramNode;
    /** 按标题取节点（双向链接 [[title]] 解析）。 */
    byTitle(title: string): EngramNode | undefined;
    /** 按文本哈希寻址，返回命中槽位的候选节点（去重，按关联度降序）。 */
    lookup(text: string, limit?: number): EngramNode[];
    /** 按已计算的哈希结果寻址（避免重复哈希）。 */
    lookupHash(result: HashResult, limit?: number): EngramNode[];
    /** 渐进披露入口视图：摘要级 + 因果/链接邻接摘要。 */
    entry(node: EngramNode): EngramEntry;
    /** 批量入口视图。 */
    entries(nodes: EngramNode[]): EngramEntry[];
    /**
     * 自组织聚类：按连接密度（links + causes/effects）自然成簇——不预定义
     * 主题、不硬编码分层。连通分量即簇；每簇选「代表节点」（连接度最高者）
     * 作为唤醒入口。类似 Obsidian 图谱的视觉密度：密集连接处自然成团。
     */
    clusters(): Array<{
        label: string;
        members: string[];
        representative: string;
    }>;
    get(id: string): EngramNode | undefined;
    getMany(ids: string[]): EngramNode[];
    all(): EngramNode[];
    count(): number;
    slotCount(): number;
    /**
     * 分层统一查询（维护/检索入口）：按层/项目/会话/类型/时间过滤。
     * 缺省按 importance 降序；recent=true 按创建时间倒序。
     */
    query(filter?: {
        layer?: EngramLayer;
        projectId?: string | null;
        sessionId?: string;
        kind?: EngramKind;
        since?: number;
        until?: number;
        limit?: number;
        recent?: boolean;
    }): EngramNode[];
    /** 分层统计（status 工具用）。 */
    layerCounts(): Record<EngramLayer, number>;
    /**
     * 提升/转层：改 layer 与 projectId（保留 id/因果/链接——引用不失效）。
     * 会话结束前把 session 临时记忆提升为 project/global 跨会话持久。
     */
    promote(id: string, layer: EngramLayer, projectId?: string | null): EngramNode | undefined;
    /** 修正节点字段（title 变更会同步标题索引；层变更用 promote）。 */
    update(id: string, patch: Partial<Pick<EngramNode, 'title' | 'summary' | 'content' | 'links' | 'causes' | 'effects' | 'importance'>>): EngramNode | undefined;
    /** 清空一个项目（project 层全部节点；项目移除/归档时）。 */
    clearProject(projectId: string): number;
    /** 登记一次唤醒（LRU 衰减 + 激活强化：命中即复习，类脑巩固）。 */
    touch(id: string): void;
    /** 登记一次强化（展开/链接等深度使用——权重高于命中）。 */
    reinforce(id: string): void;
    /** 全部待确认节点（用户确认制管理面）。 */
    pending(): EngramNode[];
    /** 确认一个待确认节点（确认后才参与检索/唤醒命中）。幂等：已确认返回原节点。 */
    confirmNode(id: string): EngramNode | undefined;
    /** 拒绝（删除）一个待确认节点。非 pending 节点不可拒绝（防误删已生效记忆）。 */
    rejectNode(id: string): boolean;
    /**
     * 退役候选：confirmed 且闲置超过 idleDays 且重要度 ≤ maxImportance。
     * 闲置 = now - lastHitAt（旧数据无 lastHitAt 时按 createdAt 兜底——绝不
     * 因字段缺失而误判为"新鲜"）。pending/retired 不参与。
     * 算法是参谋：只标候选不删数据——退役可复活（unretire）。
     */
    retirementCandidates(opts: {
        idleDays: number;
        maxImportance: number;
        now?: number;
    }): EngramNode[];
    /** 退役一个节点：退出召回/唤醒（lookup 已过滤），数据保留（search/open 可见）。 */
    retire(id: string): EngramNode | undefined;
    /** 复活一个退役节点（open/confirm/update 时自动调用）：重新参与检索/唤醒。 */
    unretire(id: string): EngramNode | undefined;
    /** 全部退役节点（治理盘点；search/status 用）。 */
    retiredNodes(): EngramNode[];
    /**
     * 同标题去重治理（v0.4.0）：同 title 的节点只保留最新（按 createdAt），
     * 旧者退役（数据保留可复活）。titleIndex 指向保留者——否则 byTitle 会
     * 命中已退役节点（open 会误复活）。
     * @returns 保留节点（无重复返回 null）。
     */
    dedupTitle(title: string): EngramNode | null;
    remove(id: string): boolean;
    /**
     * 会话隔离（分层生命周期）：只清该会话的 **session 层** 临时记忆；
     * global/project 跨会话层保留——跨会话沉淀的核心转变。
     * 复用 remove() 统一清理索引（byId/titleIndex/slotIndex）。
     */
    clearSession(sessionId: string): number;
}
