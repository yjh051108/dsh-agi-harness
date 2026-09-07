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
import { isVisible } from './engram/store.js';
/** 发送 JSON 响应。 */
function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(text);
}
/** 从请求 query 解析查看者视角：sessionId → cwd（agents 服务解析会话工作目录）。 */
function resolveViewer(ctx, url, relay) {
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    const agents = ctx.get('agents');
    let cwd = sessionId !== undefined
        ? agents?.get?.(sessionId)?.session?.header?.cwd
        : undefined;
    // 兜底：agents 表查不到该会话（已归档/非活跃/服务未暴露）时，回退到
    // relay 持续追踪的当前工作目录——web 图谱 Tab 服务当前活动会话，
    // 这样 project 层记忆仍然可见，不会只剩 global 一个点。
    if (cwd === undefined && sessionId !== undefined) {
        cwd = relay.currentCwd ?? undefined;
    }
    // 最终兜底：store 里最近写入的 project 层节点所属项目（HMR 后
    // currentCwd 可能尚未捕获；web 图谱面向「当前/最近项目」的记忆网络）。
    if (cwd === undefined && sessionId !== undefined) {
        const recent = relay.store.query({ layer: 'project', limit: 1, recent: true });
        cwd = recent[0]?.projectId ?? undefined;
    }
    return { sessionId, cwd };
}
/** 节点视图（图谱渲染最小集）。 */
function nodeView(n) {
    return {
        id: n.id,
        title: n.title,
        summary: n.summary,
        kind: n.kind,
        layer: n.layer,
        projectId: n.projectId,
        importance: n.importance,
        hits: n.hits,
        createdAt: n.createdAt,
        status: n.status ?? 'confirmed',
    };
}
export function installGraphApi(ctx, relay) {
    // 融合：真实检索端点（staging/外部工具用）——走 relay.wake 完整唤醒管线
    const disposers = [];
    disposers.push(ctx.webServer.register({
        kind: 'delete',
        path: '/engram-relay/api/graph/clean-dirty',
        handler: async (req, res) => {
            // 插件内清理脏 session 标题（内存+持久化一致——不碰文件）
            // 脏特征：含换行 / 超长 / 截断开头 / 标点结尾
            let removed = 0;
            try {
                const all = relay.store?.all?.() ?? [];
                for (const n of all) {
                    if (n.layer !== 'session')
                        continue;
                    const t = n.title || '';
                    const bad = t.includes('\n') || t.length > 30 || /^[，。！？、的了吗呢询态#*]/.test(t) || /[，。！？、]{1,2}$/.test(t);
                    if (bad) {
                        relay.store?.remove?.(n.id);
                        removed++;
                    }
                }
            }
            catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(e).slice(0, 200) }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, removed }));
        },
    }));
    disposers.push(ctx.webServer.register({
        kind: 'get',
        path: '/engram-relay/api/search',
        handler: async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const q = url.searchParams.get('q') ?? '';
            const limit = Math.min(10, Number(url.searchParams.get('limit') ?? 5));
            const _t0 = Date.now();
            try {
                const hit = await relay.wake.query(q, limit, {
                    sessionId: relay.currentSessionId ?? undefined,
                    cwd: relay.currentCwd ?? undefined,
                }, { skipVerify: true });
                const items = hit.engrams.map((e) => ({
                    id: e.id, title: e.title, summary: e.summary, kind: e.kind,
                    layer: e.layer, importance: e.importance, hits: e.hits,
                    verify: hit.verify?.[e.id] ?? null,
                }));
                relay.debugLog?.(`search ${q.slice(0, 16)} took ${Date.now() - _t0}ms reason=${hit.reason} items=${items.length}`);
                sendJson(res, 200, { query: q, reason: hit.reason, items, total: items.length });
            }
            catch (error) {
                sendJson(res, 500, { error: String(error).slice(0, 200) });
            }
        },
    }));
    disposers.push(ctx.webServer.register({
        kind: 'prefix',
        path: '/engram-relay/api',
        handler: async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const viewer = resolveViewer(ctx, url, relay);
            // GET /graph：可见节点 + 边（分层准入）
            if (req.method === 'GET' && url.pathname === '/engram-relay/api/graph') {
                // 无会话视角（未传 sessionId）→ 只暴露 global 层——浏览器端是用户
                // 可见界面，必须保守：不泄露他人项目/会话记忆（isVisible 的空
                // viewer 宽容分支只用于 wake/tools 的向后兼容）。
                const visible = relay.store.all().filter((n) => (viewer.sessionId === undefined && viewer.cwd === undefined
                    ? n.layer === 'global'
                    : isVisible(n, viewer))
                    // v0.4.0：退役节点不进图谱主视图（治理可见性交给 search/status）
                    && n.status !== 'retired');
                const ids = new Set(visible.map((n) => n.id));
                const edges = [];
                const seen = new Set();
                const addEdge = (from, to, kind) => {
                    const key = `${from}|${to}|${kind}`;
                    if (seen.has(key))
                        return;
                    seen.add(key);
                    edges.push({ from, to, kind });
                };
                for (const n of visible) {
                    // 因果边（前因/后果双向展开）
                    for (const c of n.causes)
                        if (ids.has(c))
                            addEdge(c, n.id, 'causes');
                    for (const e of n.effects)
                        if (ids.has(e))
                            addEdge(n.id, e, 'causes');
                    // 双向链接边（Obsidian 风格 [[标题]]）
                    for (const l of n.links) {
                        const t = relay.store.byTitle(l);
                        if (t && ids.has(t.id) && t.id !== n.id)
                            addEdge(n.id, t.id, 'link');
                    }
                }
                sendJson(res, 200, {
                    nodes: visible.map(nodeView),
                    edges,
                    layerCounts: relay.store.layerCounts(),
                    total: visible.length,
                    viewer,
                });
                return;
            }
            // GET /node/<title>：节点详情（渐进披露第二层）
            const match = /^\/engram-relay\/api\/node\/(.+)$/.exec(url.pathname);
            if (req.method === 'GET' && match !== null) {
                const title = decodeURIComponent(match[1]).replace(/^\[\[|\]\]$/g, '');
                const node = relay.store.byTitle(title);
                if (!node) {
                    sendJson(res, 404, { error: `node not found: ${title}` });
                    return;
                }
                // 无会话视角 → 只看 global 层（隐私边界，同上）
                const visible = viewer.sessionId === undefined && viewer.cwd === undefined
                    ? node.layer === 'global'
                    : isVisible(node, viewer);
                if (!visible) {
                    sendJson(res, 403, { error: `node ${title} is not visible to this session` });
                    return;
                }
                relay.store.touch(node.id);
                sendJson(res, 200, {
                    ...nodeView(node),
                    content: node.content,
                    causes: relay.store.getMany(node.causes).map((c) => nodeView(c)),
                    effects: relay.store.getMany(node.effects).map((e) => nodeView(e)),
                    links: node.links.map((t) => {
                        const target = relay.store.byTitle(t);
                        return target ? nodeView(target) : { id: '', title: t, summary: '', kind: 'note', layer: 'global', projectId: null, importance: 0, hits: 0, createdAt: 0 };
                    }),
                });
                return;
            }
            sendJson(res, 404, { error: 'not found' });
        },
    }));
    return () => disposers.forEach((d) => d());
}
