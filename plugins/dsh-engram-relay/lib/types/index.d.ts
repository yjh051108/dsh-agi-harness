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
import type { Context as CordisContext } from 'cordis';
import type LlmService from '@deepseek-ai/dsh-llm';
import type SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import type ToolRegistry from '@deepseek-ai/dsh-tools';
import z from 'schemastery';
type Context = CordisContext & {
    llm: LlmService;
    systemPrompt: SystemPrompt;
    tools: ToolRegistry;
};
export declare const name = "dsh-engram-relay";
export declare const inject: string[];
export interface Config {
    modelId: string;
    dtype: string;
    storeDir: string | null;
    injectBudgetTokens: number;
    maxWakePerTurn: number;
    distillEveryTurns: number;
    gapDailyLimit: number;
    enabled: boolean;
    pythonPath: string;
    pythonTimeoutMs: number;
    checkpoint: string;
    embedModel: string;
    distillRequireConfirm: boolean;
    semanticMinScore: number;
    lingshuVerifyUrl: string;
    lingshuAutoStart: boolean;
    lingshuPython: string;
    retireEnabled: boolean;
    retireAfterDays: number;
    retireMaxImportance: number;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
export {};
