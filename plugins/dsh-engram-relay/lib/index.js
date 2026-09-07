/**
 * dsh-engram-relay — 外置 engram 转接模型插件。
 *
 * 大一统记忆图谱 + 超稀疏精准主动唤醒（**跨会话分层记忆**）：
 *
 *  - 分层：预设 3 层（global=全局持久 / project=项目持久·按工作目录 /
 *    session=会话临时·结束清理），归属由模型 engram_store 时**自主决策**；
 *    层是节点属性（大一统图谱不分家）。
 *  - 唤醒：每次主模型请求前，N-gram 哈希确定性寻址（O(1)，精确命中）
 *    粗筛候选 → **分层准入**（global 所有会话 / project 同 cwd / session
 *    本会话）→ bge 专用嵌入模型语义精排（修跨主题误命中）→ 因果图
 *    双向传播（前因/后果）→ 只注入极少数超稀疏痕迹（预算默认 600
 *    token），渐进披露（入口 = [[标题]] + 摘要，按需展开全文）；
 *  - 写入：模型经 engram_store 工具落节点（分层/标题/摘要/正文/链接/
 *    因果），session 层在会话结束清理，global/project 跨会话持久；
 *  - 维护：engram_search（盘点）/ link（织图谱）/ update / remove /
 *    promote（session→project/global 转长期）——类 LSP 的能力声明 +
 *    按需请求-响应；
 *  - 转接：经 `llm/stream` waterfall 拦截模型调用（请求前注入、回合后
 *    蒸馏），零核心改动。
 *
 * @module dsh-engram-relay
 */
import z from 'schemastery';
import { EngramRelay } from './relay.js';
import { installEngramTools } from './tools.js';
export const name = 'dsh-engram-relay';
export const inject = ['llm', 'systemPrompt', 'tools'];
export const Config = z.object({
    modelId: z.string().default('')
        .description('遗留：0.6B 蒸馏模型目录（已弃用；空 = 不加载，蒸馏/回忆降级）'),
    dtype: z.string().default('bfloat16')
        .description('模型精度（bfloat16/float16/float32）'),
    storeDir: z.string().default('')
        .description('engram 持久化目录（空 = ~/.dsh/engram-relay/）'),
    injectBudgetTokens: z.number().min(0).max(8192).default(600)
        .description('单次唤醒注入的 token 预算（超稀疏：相对 100k 上下文 <1%）'),
    maxWakePerTurn: z.number().min(0).max(32).default(3)
        .description('每回合最多唤醒的 engram 条数'),
    distillEveryTurns: z.number().min(0).max(100).default(1)
        .description('每 N 回合蒸馏一次（0 = 关闭自动蒸馏；0.6B 已移除，默认实际不生效）'),
    gapDailyLimit: z.number().min(1).max(50).default(5)
        .description('自动补卡当日上限（防卡爆炸；人类学新东西也有当天上限）'),
    enabled: z.boolean().default(true)
        .description('总开关'),
    pythonPath: z.string().default('python')
        .description('Python 解释器路径（spawn 转接服务用）'),
    pythonTimeoutMs: z.number().min(1000).max(600000).default(120000)
        .description('Python 服务预热超时'),
    checkpoint: z.string().default('')
        .description('遗留：训练好的原生 engram checkpoint 路径（0.6B 已移除）'),
    embedModel: z.string().default('')
        .description('bge 嵌入模型目录（本地路径；空 = 优先包内 model/bge-small-zh（仓库自带 int8），再空则服务端 ENGRAM_EMBED_MODEL 环境变量）'),
    distillRequireConfirm: z.boolean().default(false)
        .description('蒸馏产物是否需确认才生效：true=写 ⏳pending（确认后才参与检索），false=无确认模式，蒸馏直接 confirmed 立即生效（Obsidian 式开箱即用）'),
    semanticMinScore: z.number().min(0).max(1).default(0.42)
        .description('唤醒语义阈值：bge 余弦相似度下限（低于此值不注入；无关记忆零注入）'),
    lingshuVerifyUrl: z.string().default('http://127.0.0.1:18766')
        .description('融合（Lingshu 白箱验证）：灵枢 wisdom_cloud 服务地址。非空时知识之书注入 + 验证标注 + 写入闸门；空 = 关闭融合。默认开启（热装/装配均生效——注入器不读 patch，默认值即配置）'),
    lingshuAutoStart: z.boolean().default(true)
        .description('融合自愈（v0.4.0）：灵枢服务未运行时自动拉起 lingshu/start_lingshu.py（探测 /dex/status → spawn → 就绪轮询 → 崩溃按需重启，10s 冷却；只 kill 自己拉起的进程）。false = 仅降级不拉起'),
    lingshuPython: z.string().default('')
        .description('灵枢服务的 Python 解释器路径（空 = 沿用 pythonPath）'),
    retireEnabled: z.boolean().default(true)
        .description('记忆退役开关（v0.4.0）：闲置过久 + 重要度 ≤ 门槛 → 自动退役（退出召回/唤醒；engram_search 可见 🗄，engram_open/confirm 复活，不删数据）'),
    retireAfterDays: z.number().min(1).max(3650).default(45)
        .description('记忆退役闲置天数：距最后一次唤醒超过此天数（lastHitAt 缺省按 createdAt）且重要度 ≤ retireMaxImportance → 自动退役'),
    retireMaxImportance: z.number().min(0).max(1).default(1)
        .description('退役重要度门槛：仅重要度 ≤ 此值的记忆可被自动退役（1 = 全部可退役；0 = 关闭自动退役——只用蒸馏同题刷新/手动 engram_retire）'),
});
/** 包内模型解析：空配置 → 仓库自带 model/bge-small-zh（int8 免下载）；旧 engram-trial 路径存在则沿用。 */
function resolveEmbedModel(configured) {
    // 空配置 = 纯算法主路径（SemanticScorer，零模型）——不回退包内模型；
    // ONNX bge 仅在显式配置 embedModel 时启用（对比验证用）
    return configured.trim();
}
export function apply(ctx, config) {
    const relay = new EngramRelay(ctx, {
        modelId: config.modelId,
        dtype: config.dtype,
        storeDir: config.storeDir ?? '',
        injectBudgetTokens: config.injectBudgetTokens,
        maxWakePerTurn: config.maxWakePerTurn,
        distillEveryTurns: config.distillEveryTurns,
        gapDailyLimit: config.gapDailyLimit,
        enabled: config.enabled,
        pythonPath: config.pythonPath,
        pythonTimeoutMs: config.pythonTimeoutMs,
        checkpoint: config.checkpoint ?? '',
        // 包内模型优先：空配置时用仓库自带 model/bge-small-zh（int8，免下载），
        // 兼容旧配置的 engram-trial 路径（若存在则沿用）。
        embedModel: resolveEmbedModel(config.embedModel),
        distillRequireConfirm: config.distillRequireConfirm,
        semanticMinScore: config.semanticMinScore,
        lingshuVerifyUrl: config.lingshuVerifyUrl,
        lingshuAutoStart: config.lingshuAutoStart,
        lingshuPython: config.lingshuPython,
        retireEnabled: config.retireEnabled,
        retireAfterDays: config.retireAfterDays,
        retireMaxImportance: config.retireMaxImportance,
    });
    // 转接核心：llm/stream waterfall 拦截 + systemPrompt 记忆注入
    ctx.effect(() => relay.install(), 'dsh-engram-relay: relay');
    // r40 僵尸治本：fiber dispose 必杀配套 python 子进程（重载不留孤魂——AGENTS effect 生命周期的应有之义）
    ctx.effect(() => () => relay.model.python.stop(), 'dsh-engram-relay: python 子进程随 fiber 收口');
    // 模型面工具
    ctx.effect(() => installEngramTools(ctx, relay), 'dsh-engram-relay: tools');
}
