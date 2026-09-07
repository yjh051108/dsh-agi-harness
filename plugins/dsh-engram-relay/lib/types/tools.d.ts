/**
 * installEngramTools — 模型面工具注册（跨会话分层记忆版）。
 *
 * 工具集（大一统记忆图谱 + 分层 + 因果链接）：
 *  - engram_recall：按需唤醒检索（跨会话分层准入 + 因果邻接）
 *  - engram_store：写入一条记忆（**AI 自主决策分层** + 因果前因/后果）
 *  - engram_open：展开入口（渐进披露第二层：正文/链接/因果）
 *  - engram_search：检索记忆图谱（分层/项目/类型/关键词，维护回顾）
 *  - engram_link：显式连接节点（因果/双向链接——织图谱）
 *  - engram_update：修正节点字段
 *  - engram_remove：删除节点
 *  - engram_promote：提升层（session→project/global，会话结束前转长期）
 *  - engram_status：记忆服务状态（分层统计/索引/模型）
 *
 * 可见性边界（跨会话分层）：global 所有会话 / project 同工作目录 / session
 * 本会话。工具 execute 从 exec.agent 取 sessionId + cwd 作为查看者视角。
 */
import type { Context as CordisContext } from 'cordis';
import type ToolRegistry from '@deepseek-ai/dsh-tools';
import { EngramRelay } from './relay.js';
type ToolsContext = CordisContext & {
    tools: ToolRegistry;
};
export declare function installEngramTools(ctx: ToolsContext, relay: EngramRelay): () => void;
export {};
