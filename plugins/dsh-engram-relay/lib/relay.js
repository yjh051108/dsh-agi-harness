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
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { EngramStore } from './engram/store.js';
import { BruteForceIndex } from './engram/vector-index.js';
import { CausalGraph } from './engram/causal.js';
import { NgramHashAddressing } from './engram/hash.js';
import { ActivationCache } from './engram/activation.js';
import { EngramWakeEngine } from './engram/wake.js';
import { RelayModel } from './model/relay-model.js';
import { installGraphApi } from './graph-api.js';
import { LingshuSupervisor } from './lingshu-supervisor.js';
import { decideInjection, alreadyPresent, skipReasonText } from './inject-guard.js';
import { VerifyCache } from './verify-cache.js';
import { ENGRAM_LAYERS } from './engram/store.js';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
export class EngramRelay {
    ctx;
    config;
    store;
    graph;
    hasher;
    wake;
    model;
    /** 类脑激活缓存（B=ln(Σt^-d)，强化事件驱动；wake 阶段 3 接入排序）。 */
    activation;
    /** 向量索引（int8 粗筛 + fp32 精筛双表；prefilter 候选来源）。 */
    vectorIndex;
    /** 灵枢服务托管（v0.4.0 融合自愈）：探测 → 自动拉起 → 按需重启 → 只 kill 自拉起进程。 */
    supervisor;
    /** 灵枢验证结果 LRU 缓存（v0.4.0 性能）：同主题重复轮次零 HTTP；error 不缓存。 */
    verifyCache = new VerifyCache();
    disposers = [];
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.store = new EngramStore(config.storeDir ?? '');
        this.hasher = new NgramHashAddressing({ seed: 0 });
        this.graph = new CausalGraph(this.store);
        this.model = new RelayModel(ctx, config, this.store);
        this.activation = new ActivationCache();
        this.activation.rebuild(this.store.all());
        this.vectorIndex = new BruteForceIndex(this.store.dir);
        this.supervisor = new LingshuSupervisor({
            url: (config.lingshuVerifyUrl ?? '').trim(),
            autoStart: config.lingshuAutoStart !== false,
            pythonPath: (config.lingshuPython ?? '').trim() || config.pythonPath || 'python',
            logger: (msg) => this.ctx.logger?.info?.('[engram-relay] %s', msg),
        });
        this.wake = new EngramWakeEngine(this.store, this.graph, this.hasher, config, {
            embedder: (query, candidates) => this.model.embed(query, candidates),
            scorer: (query, candidates) => this.model.score(query, candidates),
        }, (query) => this.vectorPrefilter(query), this.activation, this.lingshuVerifier(), this.thinkLight());
    }
    /** 融合核心：灵枢 auto_verify HTTP 调用 → VerifyMark（服务不可用/超时 → error）。
     *  v0.4.0：LRU 缓存命中零 HTTP；未命中先 ensure（自愈拉起），服务未就绪
     *  返回友好 error（不抛裸 TypeError）；error 不缓存（恢复后立即重试）。 */
    async lingshuAutoVerify(text) {
        const url = this.config.lingshuVerifyUrl?.trim();
        if (!url)
            return null;
        const cached = this.verifyCache.get(text);
        if (cached)
            return cached;
        const s = await this.supervisor.ensure();
        if (s !== 'up') {
            const note = this.supervisor.degradedNote();
            this.supervisor.maybeWarn(`灵枢融合降级：${note}`);
            return { status: 'error', note };
        }
        try {
            const res = await fetch(`${url}/dex/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    op: 'auto_verify',
                    params: { knowledge: text.slice(0, 500), limit: 3, threshold: 0.5 },
                }),
                signal: AbortSignal.timeout(2500),
            });
            if (!res.ok)
                return { status: 'error', note: `http ${res.status}` };
            const data = (await res.json());
            const j = data.results?.judgment ?? '';
            const bestName = data.results?.best?.name ?? '无';
            const dnorm = (data.results?.D_norm ?? 0).toFixed(2);
            // 白箱：无论裁决与否都给出依据（候选卡 + D_norm——可溯源不是口号）
            let mark;
            if (j.startsWith('采纳')) {
                mark = { status: 'anchored', note: `${bestName}（D_norm=${dnorm}）` };
            }
            else {
                mark = { status: 'unverified', note: `${j}（最近候选卡: ${bestName}，D_norm=${dnorm}）` };
            }
            this.verifyCache.set(text, mark);
            return mark;
        }
        catch (e) {
            // 服务中途挂掉 → 通知自愈（下次 ensure 重新探测并拉起）
            this.supervisor.notifyFailure();
            return { status: 'error', note: String(e).slice(0, 80) };
        }
    }
    /** 唤醒验证钩子（wake 用）：engram 节点 → 灵枢验证。 */
    lingshuVerifier() {
        const url = this.config.lingshuVerifyUrl?.trim();
        if (!url)
            return null;
        return (node) => this.lingshuAutoVerify(`${node.title}：${(node.summary ?? '').slice(0, 200)}`);
    }
    /**
     * 浅思维钩子（每轮注入 · 统一大脑）：图上算子 + 灵枢校准器 → 3 行。
     *  ① 条件算子：唤醒邻域的 kind 分布 → 条件空间（知识/决策/事件/情感）
     *  ② 验证算子：灵枢 D_norm 外部校准锚（图网络敢想，灵枢把关）
     *  ③ 边界算子：诚实边界种子词 + 教训邻域检测（规范性提醒）
     * 纪律：只提示姿态（≤100 token），不替 agent 思考；深挖由 agent 主动。
     */
    thinkLight() {
        const url = this.config.lingshuVerifyUrl?.trim();
        if (!url)
            return null;
        const BOUNDARY_SEEDS = ['保证', '绝对', '一定', '永远', '证明', '超光速', '不可能'];
        return async (query, hit) => {
            const lines = [];
            // ① 条件算子：邻域 kind 分布（簇性质 = 条件空间，不预设类别）
            const kinds = new Map();
            for (const e of hit.engrams) {
                const k = e.kind ?? 'note';
                kinds.set(k, (kinds.get(k) ?? 0) + 1);
            }
            if (kinds.size > 0) {
                const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${n > 1 ? `×${n}` : ''}`).join('/');
                lines.push(`浅思维·条件：${top}`);
            }
            // ② 验证算子：灵枢校准器（外部锚，防自嗨）
            let vMark = null;
            try {
                vMark = await this.lingshuAutoVerify(query.slice(0, 200));
                if (vMark) {
                    lines.push(vMark.status === 'anchored' ? '浅思维·验证：✓图谱锚定' : '浅思维·验证：?图谱外——勿硬答（不裁决）');
                }
            }
            catch { /* 校准器不可用时不阻塞 */ }
            // （补卡信号不在此——只有 agent 主动求助且无答案才记录，避免常识补卡）
            // ③ 边界算子：诚实边界种子词 + 教训邻域
            const hitBoundary = BOUNDARY_SEEDS.some((s) => query.includes(s));
            const lessonNear = hit.engrams.some((e) => /教训|边界|不能|别|切忌|慎/.test(`${e.title}${e.summary ?? ''}`));
            if (hitBoundary || lessonNear) {
                lines.push('浅思维·边界：涉及边界词/教训记忆——回答需标注不确定性与证据边界');
            }
            if (lines.length === 0)
                return null;
            return lines.join('\n');
        };
    }
    // ---- 自动补卡闭环（人类式：当场不会→当场学；每日上限节制） ----
    knowledgeGaps = new Map();
    gapLlmInFlight = false;
    gapAddedToday = 0;
    /** 记录知识缺口：agent 求助且无答案 = 双不会 → 当场补卡（人类查漏式）。 */
    recordKnowledgeGap(query) {
        const q = query.trim();
        if (q.length < 8)
            return;
        const key = q.slice(0, 40);
        const g = this.knowledgeGaps.get(key);
        if (g) {
            g.count += 1;
            g.lastAt = Date.now();
        }
        else {
            this.knowledgeGaps.set(key, { query: q, count: 1, lastAt: Date.now(), handled: false });
        }
        if (this.knowledgeGaps.size > 100) {
            const oldest = [...this.knowledgeGaps.entries()].sort((a, b) => a[1].lastAt - b[1].lastAt)[0];
            if (oldest)
                this.knowledgeGaps.delete(oldest[0]);
        }
        // 当场补卡：不需要重复 3 次——查不到的那一刻就是学习时机
        // （像人类：不会 → 查 → 没查到 → 当场记下/当场学）
        if (g && !g.handled && !this.gapLlmInFlight) {
            g.handled = true;
            const dailyLimit = this.config.gapDailyLimit ?? 5;
            if (this.gapAddedToday >= dailyLimit) {
                this.ctx.logger?.info?.('[engram-relay] 补卡已达当日上限（%d 张），跳过: %s', dailyLimit, q.slice(0, 30));
                this.debugLog(`auto-card daily limit reached (${dailyLimit}): ${q.slice(0, 30)}`);
                return;
            }
            this.gapAddedToday += 1;
            void this.autoAddCard(q).catch(() => { });
        }
    }
    /** 自动补卡：查重（记忆）→ LLM 生成卡 → 灵枢 add_card 写入。 */
    async autoAddCard(query) {
        const url = this.config.lingshuVerifyUrl?.trim();
        if (!url || !this.lastLlmRoute)
            return;
        this.gapLlmInFlight = true;
        try {
            // 查重①：记忆库已有该知识 → 不补卡（记忆管个性化，卡管通用，避免重复）
            const head = query.slice(0, 6);
            const memDup = this.store.all().some((n) => `${n.title}${n.summary}`.includes(head));
            if (memDup)
                return;
            // LLM 生成卡（复用蒸馏通道，单次调用 ~600 token，成本最小化）
            const prompt = `把下面的高频问题提炼成一张知识卡，只输出 JSON：\n{"name":"标题≤10字","domain":"学科域","claim":"核心知识≤100字","trigger":"触发词逗号分隔","action":"出招≤80字","level":2}\n高频问题：${query.slice(0, 200)}`;
            let text = '';
            const stream = this.ctx.llm.stream({
                provider: this.lastLlmRoute.provider,
                model: this.lastLlmRoute.model,
                system: '你是知识卡生成器。输出严格 JSON，不要多余文字。',
                messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] })],
                temperature: 0.3,
                reasoningEffort: ReasoningEffortId('off'),
                maxTokens: 600,
            });
            for await (const chunk of stream) {
                if (chunk.type === 'text-delta')
                    text += chunk.text;
            }
            this.debugLog(`auto-card llm outLen=${text.length}`);
            let card = parseCardJson(text);
            if (card) {
                // 卡名质量门：LLM 常把整句查询当卡名（如「做事情的顺序怎么安排」）——
                // 过长或含疑问词的卡名降级为保底名（词段拼接）
                const rawName = String(card.name ?? '').trim();
                if (rawName.length > 12 || /[怎么什么如何为什么哪个多少是否能否要不要]/.test(rawName)) {
                    const _g2 = new Set();
                    for (const _seg of (query.match(/[\u4e00-\u9fff]+/g) ?? [])) {
                        for (let _i = 0; _i < _seg.length - 1; _i++)
                            _g2.add(_seg.slice(_i, _i + 2));
                    }
                    const words = [..._g2].filter((w) => !/[怎么什么如何为什么哪个多少能否要不要啥哪]/.test(w));
                    card.name = (words.slice(0, 2).join('') || '未知主题').slice(0, 10);
                    this.debugLog(`auto-card name sanitized: ${rawName} → ${card.name}`);
                }
            }
            if (!card) {
                // 保底卡：LLM 空返回时从查询启发式构造（占位可用，下次即命中）
                // 词提取用 2-gram（无标点长句也能拆词）+ ASCII 词
                const _grams = new Set();
                for (const _seg of (query.match(/[\u4e00-\u9fff]+/g) ?? [])) {
                    for (let _i = 0; _i < _seg.length - 1; _i++)
                        _grams.add(_seg.slice(_i, _i + 2));
                }
                for (const _m of query.toLowerCase().matchAll(/[a-z0-9]{2,}/g))
                    _grams.add(_m[0]);
                const words = [..._grams].filter((w) => !/[怎么什么如何为什么哪个多少能否要不要啥哪]/.test(w));
                // 标题：取前两个实义词段（避免整句截断成半句）
                const nameParts = words.slice(0, 2).join('');
                card = {
                    name: (nameParts || query.replace(/[，。！？,.!?;；]/g, ' ').trim().slice(0, 8) || '未知主题').slice(0, 10),
                    domain: '通用',
                    claim: `主题「${query.slice(0, 60)}」为图谱外高频问题（保底卡）`,
                    trigger: words.slice(0, 5).join(','),
                    action: '按未知主题处理：先声明条件空间，谨慎回答并标注不确定性',
                    level: 2,
                    // 占位卡标记 pending：不参与 respond/verify（防污染），等 LLM 生成真卡
                    status: 'pending',
                };
                this.debugLog(`auto-card fallback card: ${card.name}`);
            }
            const cardFinal = card;
            // v0.4.0 自愈：补卡写入前确保服务可用（不可用则静默放弃——补卡不阻塞主链路）
            const s = await this.supervisor.ensure();
            if (s !== 'up') {
                this.debugLog(`auto-card skipped: lingshu not up (${s})`);
                return;
            }
            // 查重②：灵枢 add_card 内部同名检查（existed）
            const res = await fetch(`${url}/dex/query`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op: 'add_card', params: { ...cardFinal, source: 'auto-gap' } }),
                signal: AbortSignal.timeout(4000),
            });
            const data = (await res.json());
            this.ctx.logger?.info?.('[engram-relay] 自动补卡: %s → %s', cardFinal.name, data.existed ? '已存在' : '新增');
            this.debugLog(`auto-card written: ${cardFinal.name} ${data.existed ? '(existed)' : '(new)'}`);
        }
        catch (e) {
            this.ctx.logger?.warn?.('[engram-relay] 自动补卡失败: %s', String(e).slice(0, 120));
        }
        finally {
            this.gapLlmInFlight = false;
        }
    }
    /** 供工具使用：验证任意知识主张（外置大脑 · 白箱闸门）。 */
    async verifyClaim(claim) {
        const v = await this.lingshuAutoVerify(claim);
        // 补卡信号：agent 主动求助验证 + 灵枢不裁决 = 双不会 → 记录缺口（高频补卡）
        if (v && v.status !== 'anchored') {
            this.recordKnowledgeGap(claim);
        }
        return v;
    }
    /** 供工具使用：灵枢知识出招（外置大脑 · 知识之书）——条件 → 命中学科卡。 */
    async lingshuRespond(condition, limit = 3) {
        const url = this.config.lingshuVerifyUrl?.trim();
        if (!url)
            return { error: 'lingshuVerifyUrl 未配置（灵枢融合未启用）' };
        // v0.4.0 自愈：服务未就绪 → 自动拉起/降级说明（不抛裸 fetch 错）
        const s = await this.supervisor.ensure();
        if (s !== 'up')
            return { error: this.supervisor.degradedNote() };
        try {
            const res = await fetch(`${url}/dex/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op: 'respond', params: { condition, limit } }),
                signal: AbortSignal.timeout(3000),
            });
            if (!res.ok)
                return { error: `http ${res.status}` };
            const data = (await res.json());
            // 补卡信号：agent 求助出招但图谱无命中 = 双不会 → 记录缺口
            const rs = data.results ?? [];
            if (!rs.some((h) => h.name && (h.score ?? 0) >= 0.02)) {
                this.recordKnowledgeGap(condition);
                // 跨端联动（v0.3.33）：图谱无命中 → 附记忆侧线索（知+忆双通道）
                try {
                    const mh = await this.wake.query(condition, 1, {
                        sessionId: this.currentSessionId ?? undefined,
                        cwd: this.resolveViewerCwd(this.currentSessionId ?? undefined),
                    });
                    if (mh.engrams.length > 0) {
                        const e = mh.engrams[0];
                        data.memoryHint = {
                            title: e.title,
                            summary: (e.summary ?? '').slice(0, 60),
                            id: e.id,
                        };
                    }
                }
                catch {
                    // 记忆补充失败不影响主路径
                }
            }
            return data;
        }
        catch (e) {
            return { error: String(e).slice(0, 80) };
        }
    }
    /**
     * 向量预筛（prefilter 钩子）：查询向量 → int8 全量内积 top-50 → 候选 id。
     * 含懒补 ensure：新记忆未入向量表时差量 embed 补入；embedder 不可用返回 null（哈希兜底）。
     */
    async vectorPrefilter(query) {
        try {
            // 懒补：store 节点数 > 向量表行数 → 差量补算（写入后首次检索前补）
            // v0.4.0：退役/待确认节点不补入向量表（已入表的历史条目由 wake 候选过滤兜底）
            const all = this.store.all().filter((e) => e.status !== 'pending' && e.status !== 'retired');
            if (all.length > this.vectorIndex.size) {
                const missing = all.filter((e) => !this.vectorIndex.has(e.id));
                if (missing.length > 0) {
                    const raw = await this.model.embedRaw(query, missing.map((e) => `${e.title}：${e.summary.slice(0, 200)}`));
                    if (raw) {
                        missing.forEach((e, i) => {
                            if (raw.vectors[i])
                                this.vectorIndex.add(e.id, Float32Array.from(raw.vectors[i]));
                        });
                        this.vectorIndex.persist();
                    }
                }
            }
            if (this.vectorIndex.size === 0)
                return null;
            const raw = await this.model.embedRaw(query, [query]);
            if (!raw)
                return null;
            const hits = this.vectorIndex.search(Float32Array.from(raw.query_vec), 50);
            return hits.map((h) => h.id);
        }
        catch {
            return null;
        }
    }
    /** 挂载所有 seam。 */
    install() {
        // 0. 预热 Python 魔改模型服务（失败降级，不阻塞）。
        void this.model.warmup();
        // 1. 请求前唤醒（llm/stream 旁路观察，不包装流）。
        //    ⚠️ llm/stream 是 waterfall：监听器必须同步返回 AsyncIterable。
        //    处理逻辑放进 async generator（其本身是 AsyncIterable，内部可 await），
        //    先完成唤醒+注入，再逐块转发底层流——既满足契约又保留"唤醒后注入"。
        this.disposers.push(this.ctx.on('llm/stream', (options, next) => {
            if (this.config.enabled) {
                // 捕获最近一次模型调用的路由（LLM 蒸馏复用同一 provider/model）
                this.lastLlmRoute = { provider: options.provider, model: options.model };
                // 融合：每次 API 调度前都注入（不限于主对话轮）——sessionId 可缺省
                // （后台/子任务/工具内推理），viewer 无会话时 isVisible 只放行 global 层。
                const sessionId = options.sessionId ?? '';
                // 分层准入需要查看者视角：sessionId + 该会话自己的工作目录。
                // ⚠️ 不能直接用全局 currentCwd：进程级单字段，多会话并发时后写者
                // 覆盖先写者，会把另一会话的 project 层记忆按错误 cwd 过滤。
                // 改为按 sessionId 解析，currentCwd 仅兜底（见 resolveViewerCwd）。
                const viewerCwd = this.resolveViewerCwd(sessionId || undefined);
                const _t0 = Date.now();
                const wakeP = this.wake.maybeWake(sessionId, options, { cwd: viewerCwd, turn: this.lastTurnAt }).then((h) => {
                    if (h) {
                        // v0.4.0 性能观测：唤醒耗时入 distill-debug.log（p50/p95 收敛数据源）
                        this.debugLog(`wake ${h.reason}${h.pressure ? ' [pressure]' : ''} items=${h.engrams.length} cwd=${viewerCwd ?? 'none'} took=${Date.now() - _t0}ms`);
                    }
                    return h;
                }).catch((error) => {
                    this.ctx.logger?.warn?.('[engram-relay] wake failed: %s', String(error));
                    return null;
                });
                // 训练模型的原生回忆（异步，结果缓存供记忆段渲染）
                const query = extractQueryText(options);
                if (query) {
                    void this.maybeRecall(query).catch((error) => {
                        this.ctx.logger?.warn?.('[engram-relay] recall failed: %s', String(error));
                    });
                }
                // 限时等待唤醒完成（本地灵枢 respond 约 50ms；慢路径限时降级），
                // 完成后渲染记忆并注入到本轮消息，再返回（转发）底层流。
                const wakeReady = Promise.race([wakeP, new Promise((r) => setTimeout(r, 800))]);
                const self = this;
                return (async function* () {
                    await wakeReady;
                    try {
                        const injection = self.renderMemorySection();
                        // issue #14：注入必须走 DSH 的消息契约（决策收在 inject-guard，纯函数可测）——
                        // ① content 是 ContentBlock[]（字符串会被 dsh-llm 的 contentHasImage 打成
                        //    "content.some is not a function"：/compact 必崩）；
                        // ② 辅助调用（compaction/session-title）跳过——摘要指令必须是最后一条消息；
                        // ③ 正常轮次请求被 agent-loop deepFreeze——本轮不注，交给 agent/pre-step。
                        const d = decideInjection(options, injection);
                        if (d.action === 'inject' && d.message) {
                            ;
                            options.messages.push(d.message);
                        }
                        else if (d.why && d.why !== 'no-injection' && d.why !== 'already-present') {
                            self.noteInjectionSkip(skipReasonText(d.why));
                        }
                    }
                    catch (error) {
                        self.noteInjectionFailure(error);
                    }
                    yield* next();
                })();
            }
            return next();
        }));
        // 1.5 issue #14 路线 2：正常轮次走 `agent/pre-step` 正规接缝注入。
        //     为什么不能只靠 llm/stream：轮次请求被 agent-loop deepFreeze，就地改必抛，
        //     而异常被吞=静默失效（这就是"每轮记忆注入"长期不生效的真因）。
        //     pre-step 的 decision.messages 可变、且作为 durable user/message 落盘——
        //     与 DSH 自己的 "Current runtime context" 同一机制（不碰冻结请求、不破前缀缓存）。
        //     去重：与 llm/stream 路径共用 alreadyPresent（同一记忆段不重复注入）。
        this.disposers.push(this.ctx.on('agent/pre-step', async (_payload, next) => {
            const decision = await next();
            try {
                if (!this.config.enabled)
                    return decision;
                if (!decision || decision.kind === 'reject')
                    return decision;
                const msgs = decision.messages;
                if (!Array.isArray(msgs))
                    return decision;
                const injection = this.renderMemorySection();
                if (!injection)
                    return decision;
                if (alreadyPresent(msgs.slice(-3), injection))
                    return decision;
                return { ...decision, messages: [...msgs, { role: 'user', content: [{ type: 'text', text: injection }] }] };
            }
            catch (error) {
                this.noteInjectionFailure(error);
                return decision;
            }
        }));
        // 2. 记忆能力说明（固定文本，零动态：system 稳定 → 前缀缓存保持命中）。
        //    动态召回内容走消息尾注入（上方），需要时也可用 engram_recall 工具。
        //    ⚠️ 必须挂 ctx.effect：裸注册在 fiber 重建（热重载/失败回滚）时不注销，
        //    残留导致下次 apply duplicate "engram:relay already registered"。
        this.ctx.effect(() => this.ctx.systemPrompt.context({
            name: 'engram:relay',
            order: 9997,
            text: '本环境有统一大脑（跨会话记忆图谱 + 灵枢知识校准器）：\n' +
                '· 每轮请求自动注入：相关记忆入口 + 浅思维三行（条件/验证/边界）。浅思维说「图谱外」= 灵枢无卡——可直接 engram_verify/engram_respond 求助；查不到会当场自动补卡（双不会→当场学会），下次就有。\n' +
                '· 记忆工具：recall 检索往事 / store 写入（AI 自主分层 global/project/session）/ open 展开细节 / link 织因果网 / update 修订 / promote 转长期 / search 盘点。\n' +
                '· 知识工具：verify 验证主张（✓锚定/?图谱外，证据不足不裁决——回答须标注边界）/ respond 知识出招（条件→学科卡）。\n' +
                '· 原则：注入段给线索（浅层自动），细节用工具深挖（渐进披露）；不确定的主张先 verify 再下结论；灵枢不裁决时不硬答。',
        }), 'engram-relay: memory-context');
        // 3. 回合后蒸馏（agent/turn-stopping：回合关闭边界，serial 不 veto）。
        //    从 agent.session.deriveMessages() 提取最近回合文本 → <1B 模型
        //    蒸馏为 engram（实时留底——在官方 compact 折叠之前，细节已进
        //    外置记忆表，折叠后仍可唤醒找回）。
        this.disposers.push(this.ctx.on('agent/turn-stopping', ({ agent, turn }) => {
            if (!this.config.enabled)
                return;
            this.lastTurnAt = turn;
            this.currentSessionId = agent.session.id;
            // 持续追踪当前工作目录（分层准入：project 层按 cwd 过滤）
            const cwd = agent.session.header?.cwd;
            if (typeof cwd === 'string' && cwd !== '')
                this.currentCwd = cwd;
            const messages = extractRecentTurn(agent.session.deriveMessages(), turn);
            this.lastConversationText = messages;
            void this.maybeDistill().catch((error) => {
                this.ctx.logger?.warn?.('[engram-relay] distill failed: %s', String(error));
            });
        }));
        // 4. 会话结束（分层生命周期）：只清该会话的 session 层临时记忆；
        //    global/project 跨会话层持久保留——跨会话沉淀的核心转变。
        this.disposers.push(this.ctx.on('agent/disposed', ({ agent }) => {
            if (!this.config.enabled)
                return;
            const cleared = this.store.clearSession(agent.session.id);
            if (cleared > 0) {
                this.ctx.logger?.info?.('[engram-relay] session %s ended, cleared %d session-layer engrams (global/project kept)', agent.session.id, cleared);
            }
        }));
        // 5. 图谱 Web API（web-only）：记忆图谱 Tab 的数据面（分层准入）。
        //    DSH 的 webserver 服务名是 `webServer`（dsh-host-webserver），
        //    旧名 httpServer 已不存在——等不到服务则图谱 API 永不挂载。
        this.ctx.inject(['webServer'], (webCtx) => {
            const disposeGraphApi = installGraphApi(webCtx, this);
            this.disposers.push(disposeGraphApi);
        });
        // 6. 过时记忆退役 sweep（v0.4.0 淘汰机制）：闲置超限 + 重要度 ≤ 门槛
        //    → 自动退役（退出召回/唤醒；数据保留，search/open 可复活）。
        //    算法是参谋：只标状态不删数据——误伤可一键复活。
        if (this.config.retireEnabled !== false) {
            try {
                const cands = this.store.retirementCandidates({
                    idleDays: this.config.retireAfterDays,
                    maxImportance: this.config.retireMaxImportance,
                });
                for (const c of cands)
                    this.store.retire(c.id);
                if (cands.length > 0) {
                    this.ctx.logger?.info?.('[engram-relay] 自动退役 %d 条闲置记忆（闲置>%d 天；engram_search 可见 🗄，open/confirm 可复活）', cands.length, this.config.retireAfterDays);
                }
                // 同标题重复治理：同 title 只留最新（旧者退役，titleIndex 指向保留者）
                let deduped = 0;
                const titles = new Set(this.store.all()
                    .filter((e) => e.status === 'confirmed')
                    .map((e) => e.title));
                for (const t of titles) {
                    if (this.store.dedupTitle(t))
                        deduped++;
                }
                if (deduped > 0) {
                    this.ctx.logger?.info?.('[engram-relay] 同标题重复记忆治理: %d 条旧副本已退役（保留最新）', deduped);
                }
            }
            catch (e) {
                this.ctx.logger?.warn?.('[engram-relay] retire sweep failed: %s', String(e));
            }
        }
        return () => {
            this.disposers.forEach((d) => d());
            this.disposers = [];
            // 融合自愈清理：只停自己拉起的灵枢进程（手动实例绝不动）
            this.supervisor.dispose();
        };
    }
    /** 注入被跳过：首次显式留痕——issue #14 最贵的部分是「静默」，不是崩溃。 */
    injectionSkipLogged = false;
    noteInjectionSkip(why) {
        if (this.injectionSkipLogged)
            return;
        this.injectionSkipLogged = true;
        this.ctx.logger?.warn?.('[engram-relay] injection skipped（只记一次）: %s', why);
    }
    /** 注入失败：首次升 error 并计数，之后按次数 warn——不再把异常降级成静默。 */
    injectionFailCount = 0;
    noteInjectionFailure(error) {
        this.injectionFailCount += 1;
        if (this.injectionFailCount === 1) {
            this.ctx.logger?.error?.('[engram-relay] injection failed (first, 后续按次计数): %s', String(error));
        }
        else {
            this.ctx.logger?.warn?.('[engram-relay] injection failed ×%d: %s', this.injectionFailCount, String(error));
        }
    }
    renderMemorySection() {
        // engram 文本注入（哈希唤醒）
        const base = this.wake.renderInjection(this.config.injectBudgetTokens);
        // 训练模型的「原生回忆」结果（异步缓存，唤醒时填充）
        if (this.lastRecallText && base !== '') {
            return `${base}\n<engram-recall>（记忆模型原生回忆）${this.lastRecallText.slice(0, 160)}</engram-recall>`;
        }
        return base;
    }
    /** 异步触发训练模型的原生回忆（由 llm/stream 旁路调用，缓存结果）。 */
    async maybeRecall(query) {
        if (!this.config.enabled)
            return;
        try {
            const recalled = await this.model.recall(query);
            if (recalled)
                this.lastRecallText = recalled;
        }
        catch {
            // 回忆失败静默（降级为纯 engram 注入）
        }
    }
    lastRecallText = null;
    /** 回合后蒸馏：LLM 把最近回合内容提取为 engram（⏳待确认，用户确认后生效）。 */
    async maybeDistill() {
        this.debugLog(`distill called: everyTurns=${this.config.distillEveryTurns} convLen=${(this.lastConversationText ?? '').length} route=${this.lastLlmRoute ? `${this.lastLlmRoute.provider}/${this.lastLlmRoute.model}` : 'none'}`);
        if (this.config.distillEveryTurns === 0)
            return;
        const conversation = this.lastConversationText ?? '';
        if (!conversation.trim()) {
            this.debugLog('distill skip: conversation empty');
            return;
        }
        const route = this.lastLlmRoute;
        if (!route) {
            this.ctx.logger?.warn?.('[engram-relay] distill skipped: no llm route captured yet');
            this.debugLog('distill skip: no llm route');
            return;
        }
        let text = '';
        try {
            // 已有记忆入口（供因果推断引用——入口级，控制体积）
            const entryList = this.store.all()
                .map((n) => `[[${n.title}]] ${n.summary.slice(0, 40)}`)
                .join('\n');
            const userText = `已有记忆入口：\n${entryList.slice(0, 1800)}\n\n最近对话回合：\n${conversation.slice(0, 3800)}`;
            const stream = this.ctx.llm.stream({
                provider: route.provider,
                model: route.model,
                system: DISTILL_SYSTEM_PROMPT,
                messages: [createUserMessage({
                        source: { kind: 'user' },
                        content: [{ type: 'text', text: userText }],
                    })],
                temperature: 0.3,
                // 蒸馏是结构化抽取任务，不需要思考链：显式关闭 reasoning，
                // 否则 reasoningEffort=max 的思考会吃光 800 token 预算导致输出为空
                // （实测 distill-debug.log 大量 `outLen=0`）。
                reasoningEffort: ReasoningEffortId('off'),
                maxTokens: 1500,
            });
            for await (const chunk of stream) {
                if (chunk.type === 'text-delta')
                    text += chunk.text;
            }
            this.debugLog(`distill llm ok: outLen=${text.length}`);
        }
        catch (error) {
            this.ctx.logger?.warn?.('[engram-relay] distill llm failed: %s', String(error));
            this.debugLog(`distill llm FAILED: ${String(error)}`);
            return;
        }
        let parsed = parseDistillJson(text);
        if (!parsed || parsed.length === 0) {
            // 保底蒸馏：LLM 空返回时启发式直接沉淀（自组织记忆不断流）
            const fb = fallbackDistill(conversation);
            if (fb.length > 0) {
                this.debugLog(`distill fallback: ${fb.length} items (llm empty)`);
                parsed = fb;
            }
            else {
                this.ctx.logger?.warn?.('[engram-relay] distill output unparsable/empty: %s', text.slice(0, 160));
                this.debugLog(`distill output unparsable/empty: ${text.slice(0, 160)}`);
                return;
            }
        }
        this.debugLog(`distill parsed: ${parsed.length} items`);
        // 自动沉淀 → ⏳待确认（用户确认制合流：不擅自写入生效记忆）
        let proposed = 0;
        const sessionId = this.currentSessionId ?? '';
        const cwd = this.currentCwd ?? null;
        for (const item of parsed) {
            const layer = item.layer;
            if (!ENGRAM_LAYERS.includes(layer))
                continue;
            if (layer === 'project' && !cwd)
                continue;
            if (layer === 'session' && !sessionId)
                continue;
            if (!item.title || !item.summary)
                continue;
            // 蒸馏冗余去重 + 过时治理（v0.3.46 + v0.4.0）：与已有（未退役）记忆
            // 2-gram 重叠 ≥0.55 时：
            //  - 同标题 → 就地刷新（summary/content 更新 + touch，不新增节点）；
            //  - 异标题且旧节点已过时（createdAt 距今 ≥ retireAfterDays）→ 旧节点
            //    退役（退出召回），新节点写入接管（淘汰过时记忆——信息更新换代）；
            //  - 异标题且旧节点还新 → 跳过（汇报/状态片段反复蒸馏不去重堆积）。
            {
                const _tgrams = new Set();
                for (const _seg of (String(item.title).match(/[\u4e00-\u9fff]+/g) ?? [])) {
                    for (let _i = 0; _i < _seg.length - 1; _i++)
                        _tgrams.add(_seg.slice(_i, _i + 2));
                }
                let dupNode = null;
                if (_tgrams.size > 0) {
                    for (const _e of this.store.all()) {
                        if (_e.status === 'retired')
                            continue;
                        const _eg = new Set();
                        for (const _seg of ((_e.title ?? '').match(/[\u4e00-\u9fff]+/g) ?? [])) {
                            for (let _i = 0; _i < _seg.length - 1; _i++)
                                _eg.add(_seg.slice(_i, _i + 2));
                        }
                        if ([..._tgrams].filter((g) => _eg.has(g)).length / _tgrams.size >= 0.55) {
                            dupNode = _e;
                            break;
                        }
                    }
                }
                if (dupNode) {
                    const sameTitle = dupNode.title === String(item.title);
                    const oldEnough = dupNode.createdAt < Date.now() - Math.max(1, this.config.retireAfterDays ?? 45) * 86_400_000;
                    if (sameTitle) {
                        // 同题刷新：内容更新 + 触碰（新鲜度归零），图谱引用/边全部保留
                        this.store.update(dupNode.id, {
                            summary: String(item.summary ?? dupNode.summary),
                            content: String(item.content ?? dupNode.content),
                        });
                        this.store.touch(dupNode.id);
                        this.debugLog(`distill refresh (same title): ${dupNode.title}`);
                        continue;
                    }
                    if (!oldEnough) {
                        this.debugLog(`distill dedup skip: ${String(item.title).slice(0, 20)}`);
                        continue;
                    }
                    // 旧题接替：旧节点退役（数据保留可复活），新节点接管
                    this.store.retire(dupNode.id);
                    this.debugLog(`distill supersede: retire ${dupNode.title} → add ${String(item.title).slice(0, 20)}`);
                }
            }
            // 自动因果：causesOf 引用的已有记忆标题 → 建因果边（前因 → 新节点）。
            const causeIds = [];
            for (const causeTitle of (Array.isArray(item.causesOf) ? item.causesOf : [])) {
                const cause = this.store.all().find((n) => n.title === causeTitle && n.id !== undefined);
                if (cause)
                    causeIds.push(cause.id);
            }
            this.store.add({
                kind: (item.kind && KINDS.has(item.kind)) ? item.kind : 'note',
                layer,
                projectId: layer === 'project' ? cwd : null,
                title: item.title,
                summary: item.summary,
                content: item.content ?? '',
                links: [],
                sessionId: layer === 'session' ? sessionId : null,
                turn: this.lastTurnAt,
                causes: causeIds,
                effects: [],
                importance: 0.6,
                // 无确认模式（默认）：蒸馏直接 confirmed 立即生效；distillRequireConfirm
                // true 时写 pending，等用户 engram_confirm。
                ...(this.config.distillRequireConfirm ? { status: 'pending' } : {}),
            });
            // 建边 + 前因节点 effects 双写
            const added = this.store.all().find((n) => n.title === item.title);
            if (added) {
                for (const causeId of causeIds) {
                    this.graph.addEdge(causeId, added.id, 'causes', 1);
                    this.store.update(causeId, { effects: [...(this.store.get(causeId)?.effects ?? []), added.id] });
                }
            }
            proposed++;
        }
        this.debugLog(`distill proposed: ${proposed}`);
        this.ctx.logger?.info?.('[engram-relay] distill: %d 条回合记忆已沉淀为 ⏳待确认节点', proposed);
    }
    /** 蒸馏排查日志（写入图谱目录 distill-debug.log）。 */
    debugLog(msg) {
        try {
            appendFileSync(join(this.store.dir, 'distill-debug.log'), `${new Date().toISOString()} ${msg}\n`);
        }
        catch {
            // 日志失败静默
        }
    }
    lastConversationText = '';
    /** 最近一次模型调用的路由（llm/stream 拦截时捕获；LLM 蒸馏复用）。 */
    lastLlmRoute = null;
    /** 当前会话 id（工具写入时归属；会话结束清理用）。 */
    currentSessionId = null;
    /** 当前回合号（工具写入时归属）。 */
    lastTurnAt = 0;
    /** 当前工作目录（分层准入：project 层按 cwd 过滤；turn-stopping 持续追踪）。 */
    currentCwd = null;
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
    resolveViewerCwd(sessionId) {
        if (sessionId) {
            const agents = this.ctx.get('agents');
            const cwd = agents?.get?.(sessionId)?.session?.header?.cwd;
            if (typeof cwd === 'string' && cwd !== '')
                return cwd;
        }
        if (this.currentCwd)
            return this.currentCwd;
        const recent = this.store.query({ layer: 'project', limit: 1, recent: true });
        const fallback = recent[0]?.projectId;
        return typeof fallback === 'string' && fallback !== '' ? fallback : undefined;
    }
    /**
     * 供工具使用的唤醒查询入口。
     * @param viewer - 查看者视角（分层准入：{ sessionId, cwd }）。
     * @param layer - 可选层过滤（逗号分隔如 'global,project'；缺省不过滤，
     *   由 viewer 准入决定可见层）。
     */
    async recall(query, limit, viewer = {}, layer) {
        const hit = await this.wake.query(query, limit ?? this.config.maxWakePerTurn, viewer);
        let engrams = hit.engrams;
        if (layer !== undefined && layer.trim() !== '') {
            const layers = layer.split(',').map((s) => s.trim()).filter(Boolean);
            if (layers.length > 0)
                engrams = engrams.filter((e) => layers.includes(e.layer));
        }
        return {
            engrams,
            reason: hit.reason,
            injectedTokens: hit.injectedTokens,
            verify: hit.verify,
        };
    }
    async status() {
        const retireCandidates = this.config.retireEnabled !== false
            ? this.store.retirementCandidates({
                idleDays: this.config.retireAfterDays,
                maxImportance: this.config.retireMaxImportance,
            })
            : [];
        return {
            enabled: this.config.enabled,
            semanticEngine: this.config.embedModel?.trim() ? `embedding(${this.config.embedModel})` : '纯算法 SemanticScorer（零模型，主路径）',
            storeDir: this.store.dir,
            engramCount: this.store.count(),
            pendingCount: this.store.pending().length,
            retiredCount: this.store.retiredNodes().length,
            // 过时记忆治理（v0.4.0）：当前符合退役条件的候选数（下次 install sweep 自动退役）
            retireCandidates: retireCandidates.length,
            retireAfterDays: this.config.retireAfterDays,
            layerCounts: this.store.layerCounts(),
            slotCount: this.store.slotCount(),
            graphEdges: this.graph.edgeCount(),
            model: await this.model.describe(),
            budgetTokens: this.config.injectBudgetTokens,
            currentCwd: this.currentCwd,
            compactCoexist: this.ctx.get('compact') !== undefined,
            // 融合自愈（v0.4.0）：灵枢服务托管状态
            lingshu: {
                url: this.config.lingshuVerifyUrl?.trim() || null,
                autoStart: this.config.lingshuAutoStart !== false,
                selfManaged: this.supervisor.isSelfManaged,
            },
        };
    }
}
/**
 * 从会话消息投影中提取「最近一个回合」的文本（供蒸馏）。
 * deriveMessages 返回完整历史（frozen Message[]）；取最后一条 user
 * 消息起至末尾的文本块拼接。长度上限由调用方（distillTurn）截断。
 */
function extractRecentTurn(messages, _turn) {
    // 找最后一条 user 消息的起点
    let start = 0;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i]?.role === 'user') {
            start = i;
            break;
        }
    }
    const parts = [];
    for (let i = start; i < messages.length; i += 1) {
        const m = messages[i];
        if (!m)
            continue;
        const role = m.role ?? 'unknown';
        const content = m.content;
        if (typeof content === 'string') {
            parts.push(`[${role}] ${content}`);
        }
        else if (Array.isArray(content)) {
            const text = content
                .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String(b.text) : ''))
                .filter((t) => t !== '')
                .join(' ');
            if (text !== '')
                parts.push(`[${role}] ${text}`);
        }
    }
    return parts.join('\n').slice(0, 4000);
}
/** 从 GenerateOptions 提取最后一条 user 消息文本（供原生回忆查询）。 */
function extractQueryText(options) {
    const messages = options.messages;
    if (!messages || messages.length === 0)
        return '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m?.role !== 'user')
            continue;
        const content = m.content;
        if (typeof content === 'string')
            return content.slice(0, 300);
        if (Array.isArray(content)) {
            const text = content
                .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String(b.text) : ''))
                .join(' ');
            if (text.trim() !== '')
                return text.slice(0, 300);
        }
    }
    return '';
}
/** 蒸馏允许的 kind 集合。 */
const KINDS = new Set(['fact', 'decision', 'event', 'note']);
/** LLM 自动蒸馏的系统提示（回合 → 记忆条目，JSON 数组输出）。 */
const DISTILL_SYSTEM_PROMPT = `你是 engram 记忆提取器。从用户提供的「最近对话回合」中提取值得长期记住的信息（事实/决策/事件/约定/踩坑），最多 3 条。只提取可复用、有长期价值的；寒暄、过程性、一次性内容一律不提取（返回空数组 []）。
每条输出 JSON 对象：
- kind: fact(事实/约定) / decision(决策/方案) / event(事件/进展) / note(笔记/其它)
- layer: global(跨项目通用，如环境/工具/偏好) / project(仅当前项目相关，如架构/踩坑/约定) / session(仅本次会话，如临时进度)
- title: 简短入口标题（10 字内，如「部署端口决策」）
- summary: 一句话摘要（30 字内）
- content: 完整细节（关键参数、上下文，200 字内）
- causesOf: 导致这条记忆的**已有记忆标题**数组（从下方「已有记忆入口」列表精确引用，最多 2 个；没有因果关系的填 []）——例如本轮"修复了 X"是由之前的「Y 故障定位」导致的，则 causesOf: ["Y 故障定位"]
- 额外：若本回合的内容与「已有记忆入口」中的多条记忆构成**反复出现的模式/规律**（如"每次改 X 都会引发 Y"），可再输出一条规律记忆（kind=fact，title 以「规律」开头，content 描述模式与证据）——没有明显规律则不输出。
只输出 JSON 数组，不要任何其他文字。`;
/** 宽松解析蒸馏输出：剥代码围栏 → 取首个 JSON 数组。 */
function fallbackDistill(conversation) {
    const text = conversation.trim();
    if (text.length < 40)
        return [];
    // 取末尾 200 字符（跨行，避免最后一行是短工具行）
    // v0.3.31：窗口起点对齐最近句边界——避免从半句开头取标题（如「询铁门…」）
    let _start = Math.max(0, text.length - 200);
    const _rel = text.slice(_start).search(/[。！？\n]/);
    if (_rel > 0)
        _start += _rel + 1;
    let clean = text.slice(_start).replace(/^[用户助手AI]\s*[:：]?\s*/i, '').trim();
    if (clean.length < 20)
        clean = text.slice(-200).replace(/^[用户助手AI]\s*[:：]?\s*/i, '').trim();
    if (clean.length < 20)
        return [];
    // 去引导词 + 取首个完整句段（标题不再从词中间切）
    // v0.3.120：清洗行首 markdown 符号（##/###/emoji/列表符——蒸馏汇报残留）
    let title = clean
        .replace(/^[\s#>*\-`]+/, '')
        .replace(/^[🗑️✅❌🔧📌✨⚡🏷️]+/, '')
        .replace(/^[询问请问查找查询关于]+/i, '')
        .split(/[，。！？,.!?;；\n]/)[0]
        .replace(/[\[\]()（）#]/g, '').trim().slice(0, 10);
    if (!title || /^(assistant|user|ai|助手|用户|对话)$/i.test(title))
        title = '对话片段';
    return [{ kind: 'note', layer: 'session', title, summary: clean.slice(0, 80), content: clean }];
}
function parseCardJson(text) {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence)
        t = fence[1];
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start)
        return null;
    try {
        const obj = JSON.parse(t.slice(start, end + 1));
        if (obj && typeof obj === 'object' && obj.name)
            return obj;
        return null;
    }
    catch {
        return null;
    }
}
function parseDistillJson(text) {
    let t = text.trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fence)
        t = fence[1];
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start < 0 || end <= start)
        return null;
    try {
        const arr = JSON.parse(t.slice(start, end + 1));
        return Array.isArray(arr)
            ? arr
            : null;
    }
    catch {
        return null;
    }
}
