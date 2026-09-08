/**
 * EngramRelay — 转接核心：大 engram 小 KV 的落地实现。
 *
 * 链路（全部挂在公开 seam 上，零核心改动）：
 *
 * 1. 请求前唤醒（读取）：`llm/stream` 旁路观察当前请求 → N-gram 哈希
 *    寻址外置 engram 表 → 门控打分 → 因果传播 → 超稀疏注入
 *    （systemPrompt 记忆段，预算默认 600 token）。
 *
 * 2. 回合后蒸馏（写入）：`agent/turn-stopping`（回合关闭边界）→ 从
 *    `agent.session.deriveMessages()` 提取最近回合文本 → <1B 模型蒸馏
 *    为 engram 条目写入外置表。**实时留底**：在官方 compact 折叠之前
 *    细节已进记忆表，折叠后仍可唤醒找回。
 *
 * 3. 与官方 compact 共存：不阻止、不替代官方折叠（它负责腾 KV，是
 *    成熟的有损总结式压缩）。engram 的职责在官方折叠之前完成——细节
 *    保真（可检索、带因果），官方负责空间（surface 替换）。
 */
import type { Context as CordisContext } from 'cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import type SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import type ToolRegistry from '@deepseek-ai/dsh-tools';
import { EngramStore } from './engram/store.js';
import { CausalGraph } from './engram/causal.js';
import { NgramHashAddressing } from './engram/hash.js';
import { EngramWakeEngine, type WakeViewer } from './engram/wake.js';
import { RelayModel } from './model/relay-model.js';
import { LingshuSupervisor } from './lingshu-supervisor.js';
import type { EngramRelayConfig, VerifyMark } from './types.js';
export interface EngramRelayDeps {
    llm: LlmService;
    systemPrompt: SystemPrompt;
    tools: ToolRegistry;
    compact?: unknown;
}
/** 唤醒结果：本次请求注入的记忆痕迹（哈希命中 + 因果激活，超稀疏）。 */
export interface WakeResult {
    engrams: import('./engram/store.js').EngramNode[];
    reason: string;
    injectedTokens: number;
    /** 融合：条目的灵枢白箱验证标注（id → 结果）；未启用/无标注时缺省。 */
    verify?: Record<string, VerifyMark>;
}
export declare class EngramRelay {
    private ctx;
    private config;
    readonly store: EngramStore;
    readonly graph: CausalGraph;
    readonly hasher: NgramHashAddressing;
    readonly wake: EngramWakeEngine;
    readonly model: RelayModel;
    /** 类脑激活缓存（B=ln(Σt^-d)，强化事件驱动；wake 阶段 3 接入排序）。 */
    readonly activation: import('./engram/activation.js').ActivationCache;
    /** 向量索引（int8 粗筛 + fp32 精筛双表；prefilter 候选来源）。 */
    readonly vectorIndex: import('./engram/vector-index.js').BruteForceIndex;
    /** 灵枢服务托管（v0.4.0 融合自愈）：探测 → 自动拉起 → 按需重启 → 只 kill 自拉起进程。 */
    readonly supervisor: LingshuSupervisor;
    /** 灵枢验证结果 LRU 缓存（v0.4.0 性能）：同主题重复轮次零 HTTP；error 不缓存。 */
    private verifyCache;
    private disposers;
    constructor(ctx: CordisContext, config: EngramRelayConfig);
    /** 融合核心：灵枢 auto_verify HTTP 调用 → VerifyMark（服务不可用/超时 → error）。
     *  v0.4.0：LRU 缓存命中零 HTTP；未命中先 ensure（自愈拉起），服务未就绪
     *  返回友好 error（不抛裸 TypeError）；error 不缓存（恢复后立即重试）。 */
    private lingshuAutoVerify;
    /** 唤醒验证钩子（wake 用）：engram 节点 → 灵枢验证。 */
    private lingshuVerifier;
    /**
     * 浅思维钩子（每轮注入 · 统一大脑）：图上算子 + 灵枢校准器 → 3 行。
     *  ① 条件算子：唤醒邻域的 kind 分布 → 条件空间（知识/决策/事件/情感）
     *  ② 验证算子：灵枢 D_norm 外部校准锚（图网络敢想，灵枢把关）
     *  ③ 边界算子：诚实边界种子词 + 教训邻域检测（规范性提醒）
     * 纪律：只提示姿态（≤100 token），不替 agent 思考；深挖由 agent 主动。
     */
    private thinkLight;
    private knowledgeGaps;
    private gapLlmInFlight;
    private gapAddedToday;
    /** 记录知识缺口：agent 求助且无答案 = 双不会 → 当场补卡（人类查漏式）。 */
    private recordKnowledgeGap;
    /** 自动补卡：查重（记忆）→ LLM 生成卡 → 灵枢 add_card 写入。 */
    private autoAddCard;
    /** 供工具使用：验证任意知识主张（外置大脑 · 白箱闸门）。 */
    verifyClaim(claim: string): Promise<VerifyMark | null>;
    /** 供工具使用：灵枢知识出招（外置大脑 · 知识之书）——条件 → 命中学科卡。 */
    lingshuRespond(condition: string, limit?: number): Promise<unknown>;
    /**
     * 向量预筛（prefilter 钩子）：查询向量 → int8 全量内积 top-50 → 候选 id。
     * 含懒补 ensure：新记忆未入向量表时差量 embed 补入；embedder 不可用返回 null（哈希兜底）。
     */
    private vectorPrefilter;
    /** 挂载所有 seam。 */
    install(): () => void;
    /** 注入被跳过：首次显式留痕——issue #14 最贵的部分是「静默」，不是崩溃。 */
    private injectionSkipLogged;
    private noteInjectionSkip;
    /** 注入失败：首次升 error 并计数，之后按次数 warn——不再把异常降级成静默。 */
    private injectionFailCount;
    private noteInjectionFailure;
    private renderMemorySection;
    /** 异步触发训练模型的原生回忆（由 llm/stream 旁路调用，缓存结果）。 */
    maybeRecall(query: string): Promise<void>;
    private lastRecallText;
    /** 回合后蒸馏：LLM 把最近回合内容提取为 engram（⏳待确认，用户确认后生效）。 */
    private maybeDistill;
    /** 蒸馏排查日志（写入图谱目录 distill-debug.log）。 */
    private debugLog;
    private lastConversationText;
    /** 最近一次模型调用的路由（llm/stream 拦截时捕获；LLM 蒸馏复用）。 */
    private lastLlmRoute;
    /** 当前会话 id（工具写入时归属；会话结束清理用）。 */
    currentSessionId: string | null;
    /** 当前回合号（工具写入时归属）。 */
    lastTurnAt: number;
    /** 当前工作目录（分层准入：project 层按 cwd 过滤；turn-stopping 持续追踪）。 */
    currentCwd: string | null;
    /**
     * 解析查看者工作目录（分层准入中 project 层的边界）。
     *
     * 优先按会话解析：agents 服务 → 该会话 header.cwd（与图谱 API
     * graph-api.ts:resolveViewer 同一口径）；再回退到最近一次 turn-stopping
     * 捕获的 currentCwd；最后回退到 store 里最近写入的 project 层节点所属
     * 项目（热重载后 currentCwd 尚未捕获时的兜底）。
     *
     * ⚠️ 不能只用 currentCwd：它是进程级单字段，任何会话的 turn-stopping
     * 都会覆盖它（下方写入处），多会话并发时后写者赢——拿它当每个会话的
     * viewer.cwd 会让另一会话的 project 层记忆被错误过滤（表现为 wake
     * items=0）。
     */
    resolveViewerCwd(sessionId?: string): string | undefined;
    /**
     * 供工具使用的唤醒查询入口。
     * @param viewer - 查看者视角（分层准入：{ sessionId, cwd }）。
     * @param layer - 可选层过滤（逗号分隔如 'global,project'；缺省不过滤，
     *   由 viewer 准入决定可见层）。
     */
    recall(query: string, limit?: number, viewer?: WakeViewer, layer?: string): Promise<WakeResult>;
    status(): Promise<Record<string, unknown>>;
}
