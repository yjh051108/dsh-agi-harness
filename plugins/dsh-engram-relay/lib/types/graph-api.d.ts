/**
 * installGraphApi — engram 记忆图谱 Web API（host 侧）。
 *
 * 供 web client「图谱」Tab 消费：按查看者视角（sessionId → cwd）做**分层
 * 准入**后返回节点 + 边（因果边 + 双向链接边），以及单节点详情（渐进披露
 * 第二层：正文/因果/链接）。
 *
 * 路由（prefix /engram-relay/api）：
 *  - GET /graph?sessionId=…        → { nodes, edges, layerCounts, total }
 *  - GET /node/<title>?sessionId=… → 节点详情（content + 前因/后果/关联）
 *
 * 可见性边界与唤醒/工具一致：global 所有会话 / project 同 cwd / session 本会话。
 */
import type { Context as CordisContext } from 'cordis';
import type { EngramRelay } from './relay.js';
type HttpCtx = CordisContext & {
    webServer: {
        register(route: {
            kind: string;
            path: string;
            handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void> | void;
        }): () => void;
    };
};
export declare function installGraphApi(ctx: HttpCtx, relay: EngramRelay): () => void;
export {};
