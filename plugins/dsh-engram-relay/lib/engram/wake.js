/**
 * EngramWakeEngine — 超稀疏精准主动唤醒。
 *
 * 唤醒管线（每回合自动执行，无需模型调用工具）：
 *  1. 哈希粗筛：对当前请求文本做 N-gram 哈希（确定性，O(1)），
 *     命中外置 engram 表的槽位 → 候选记忆（精确寻址，不含近似性）；
 *  2. 语义精排：bge 嵌入模型对候选做余弦重排（修掉哈希的
 *     mode-level 跨主题误命中——实测 80 查询精确率 85% → 95%），
 *     嵌入不可用时降级为重要度/遗留门控打分；
 *  3. 因果传播：从命中种子沿因果图双向扩散（前因/后果）——
 *     「什么导致了它 / 它导致了什么」，这是向量索引做不到的；
 *  4. 超稀疏截断：激活分数排序取 top-N（maxWakePerTurn），且总注入
 *     token 受预算约束（默认 600 token ≈ 100k 上下文的 <1%）。
 *
 * 相比普通向量索引：向量索引回答「语义上像什么」（近似），本引擎
 * 回答「确定命中了什么 + 语义上相关什么 + 因果上牵连什么」（精确 +
 * 语义 + 因果）。
 */
import { isVisible } from './store.js';
export class EngramWakeEngine {
    store;
    graph;
    hasher;
    config;
    scorers;
    prefilter;
    activation;
    verifier;
    knowledgeSource;
    /** 最近一次唤醒结果（供 systemPrompt 渲染器读取）。 */
    lastInjection = { engrams: [], reason: 'idle', injectedTokens: 0 };
    /** v2.2 压力阀：会话内查询历史（环形 8）——重复主题 = 深推压力信号 */
    queryHistory = [];
    /** 融合：最近一次查询的知识之书段（renderInjection 合并注入）。 */
    lastKnowledge = null;
    constructor(store, graph, hasher, config, 
    /** 打分器（bge 语义精排 + 遗留门控）；缺省 = 纯哈希 + 重要度。 */
    scorers = null, 
    /** 候选预筛钩子（向量索引粗筛用）：返回候选 id 列表；null = 回退哈希 lookup。 */
    prefilter = null, 
    /** 类脑激活缓存（B=ln(Σt^-d)）：排序融合（阶段 3）；缺省 = 无激活加权。 */
    activation = null, 
    /** 融合：灵枢白箱验证钩子（对选中的 engram 返回标注）；null = 关闭。 */
    verifier = null, 
    /** 融合：浅思维钩子（对查询+唤醒结果返回浅思维文本段）；null = 关闭。 */
    knowledgeSource = null) {
        this.store = store;
        this.graph = graph;
        this.hasher = hasher;
        this.config = config;
        this.scorers = scorers;
        this.prefilter = prefilter;
        this.activation = activation;
        this.verifier = verifier;
        this.knowledgeSource = knowledgeSource;
        this.lastKnowledge = null;
    }
    /** 每回合入口（自动唤醒，极克制）：哈希预筛 → 查询质量门 → 自动阈值 0.5 → top-1。 */
    async maybeWake(sessionId, _options, viewer = {}) {
        const query = extractQuery(_options);
        // 融合：浅思维独立于记忆——查询有效即拉取（空库/零命中也给验证/边界）
        const emptyHit = async (reason) => {
            await this.pullKnowledge(query, { engrams: [] });
            const h = { engrams: [], reason, injectedTokens: 0 };
            this.lastInjection = h;
            return h;
        };
        const emptyHitSync = (reason) => {
            const h = { engrams: [], reason, injectedTokens: 0 };
            this.lastInjection = h;
            return h;
        };
        if (this.store.count() === 0)
            return emptyHit('empty-store');
        if (query.trim() === '')
            return emptyHit('no-query');
        // ① 向量/哈希预筛（零成本）：词汇/语义与任何记忆无重叠 → 直接跳过记忆注入。
        //    这是最大的噪声过滤器——闲聊/过程轮基本在此命中退出（浅思维仍注入）。
        if (this.prefilter) {
            const ids = await this.prefilter(query).catch(() => null);
            if (ids && ids.length === 0) {
                return emptyHit('no-hash-hit');
            }
        }
        else if (this.store.lookup(query, 1).length === 0) {
            return emptyHit('no-hash-hit');
        }
        // ② 查询质量门：太短（口语无锚，如"这个怎么弄"）没有语义锚 → 跳过记忆注入。
        const anchorText = query.trim();
        if (anchorText.length < 8) {
            return emptyHit('short-query');
        }
        // ③④ 自动模式：阈值 +0.08（≈0.50，明显相关才注入）+ top-1（唯一入口，干扰最小）。
        // v2.2 压力阀：与历史查询重叠 ≥0.5 → 深推压力 → 加强召回（limit 2）
        const _qg = new Set();
        for (const _seg of (query.match(/[\u4e00-\u9fff]+/g) ?? [])) {
            for (let _i = 0; _i < _seg.length - 1; _i++)
                _qg.add(_seg.slice(_i, _i + 2));
        }
        let pressure = false;
        if (_qg.size > 0) {
            for (const _h of this.queryHistory) {
                const _hg = new Set();
                for (const _seg of (_h.match(/[\u4e00-\u9fff]+/g) ?? [])) {
                    for (let _i = 0; _i < _seg.length - 1; _i++)
                        _hg.add(_seg.slice(_i, _i + 2));
                }
                const _ov = [..._qg].filter((g) => _hg.has(g)).length / _qg.size;
                if (_ov >= 0.5) {
                    pressure = true;
                    break;
                }
            }
        }
        this.queryHistory.push(query);
        if (this.queryHistory.length > 8)
            this.queryHistory.shift();
        const hit = await this.query(query, pressure ? 2 : 1, { sessionId, ...viewer }, { auto: true });
        if (pressure && hit.engrams.length > 0) {
            // 压力阀标记（可观测）
            ;
            hit.pressure = true;
        }
        this.lastInjection = hit;
        return hit;
    }
    /** 融合：拉取浅思维段（独立于记忆命中；失败降级为空）。 */
    async pullKnowledge(query, hit) {
        if (this.knowledgeSource) {
            try {
                this.lastKnowledge = await this.knowledgeSource(query, hit);
            }
            catch {
                this.lastKnowledge = null;
            }
        }
        else {
            this.lastKnowledge = null;
        }
    }
    /** 核心查询：向量/哈希粗筛 → 分层准入 → 语义精排（bge）→ 因果传播 → 分层稀疏选择。 */
    async query(query, limit, viewer = {}, opts = {}) {
        // （浅思维拉取移至 hit 构建后——条件算子需要唤醒结果）
        // 1. 粗筛：向量索引（prefilter 钩子，语义无盲区）→ 回退哈希 lookup。
        //    多取候选：分层准入会过滤掉一部分，保证命中不因层过滤而丢失。
        let candidates;
        if (this.prefilter) {
            const ids = await this.prefilter(query).catch(() => null);
            candidates = ids
                // v0.4.0：退役/待确认节点即使仍在向量索引/图边中也不进候选
                ? ids.map((id) => this.store.get(id)).filter((e) => !!e && e.status !== 'pending' && e.status !== 'retired')
                : this.store.lookup(query, 256);
        }
        else {
            candidates = this.store.lookup(query, 256);
        }
        // 分层准入：global 所有会话 / project 同 cwd / session 本会话。
        // 这是「跨会话记忆」的可见性边界——看不到的记忆不会被唤醒注入。
        candidates = candidates.filter((e) => isVisible(e, viewer));
        if (candidates.length === 0) {
            await this.pullKnowledge(query, { engrams: [] });
            const h = { engrams: [], reason: 'no-hash-hit', injectedTokens: 0 };
            this.lastInjection = h;
            return h;
        }
        // 2. 打分：bge 语义精排（唯一语义判断）→ 重要度仅作排序兜底。
        //    ⚠️ 相关性门槛（宁缺毋滥）：不相关的记忆一律不注入——
        //      哈希命中只是粗筛，语义余弦低于阈值的候选直接剔除；
        //      embedder 不可用时无法判断语义相关性，本轮不注入
        //      （重要度垫底会带来弱相关污染 + 每轮注入的缓存损耗，宁可空手）。
        const semanticMin = this.config.semanticMinScore ?? 0.42;
        // 自动唤醒稍严：纯算法 SemanticScorer 分数分布比 bge 保守（实测相关记忆
        // 0.48-0.55 vs bge 0.8+），autoBoost 0.03（阈值 ≈0.45）替代原 0.08 适配算法标定
        const autoBoost = opts.auto ? 0.03 : 0;
        // 多重比较校正（温和版）：候选越多误过概率越高，但真实系统哈希第一道防线
        // 已把无关候选压到个位数——仅对候选异常膨胀时温和收紧。
        const threshold = semanticMin + autoBoost + 0.03 * Math.log2(Math.max(1, candidates.length / 16));
        let raw;
        if (this.scorers?.embedder) {
            raw = await this.scorers.embedder(query, candidates).catch(() => null);
        }
        // 降级链：embedder（ONNX 对比验证，可配）→ 纯算法 scorer（默认主路径，永不失败）
        if ((!raw || raw.size === 0) && this.scorers?.scorer) {
            raw = await this.scorers.scorer(query, candidates).catch(() => null);
        }
        if (!raw || raw.size === 0) {
            await this.pullKnowledge(query, { engrams: [] });
            const h = { engrams: [], reason: 'no-embedder', injectedTokens: 0 };
            this.lastInjection = h;
            return h;
        }
        // 阈值过滤仅限「主席位」资格：前因/后果的语义常与查询不同（因果邻接
        // 不是语义相似），若在此处全量过滤会把因果邻居挡在传播之外。
        // 因果席位从全候选的传播结果选取（见第 3 步），不受阈值限制。
        const relevant = candidates.filter((e) => (raw.get(e.id) ?? 0) >= threshold);
        if (relevant.length === 0) {
            await this.pullKnowledge(query, { engrams: [] });
            const h = { engrams: [], reason: 'below-threshold', injectedTokens: 0 };
            this.lastInjection = h;
            return h;
        }
        const scores = new Map(candidates.map((e) => [e.id, raw.get(e.id) ?? e.importance]));
        // 3. 因果传播（前因/后果双向）——基于全候选分数（含低于阈值的邻居种子）。
        const activated = this.graph.propagate(scores);
        // 4. 分层稀疏选择（因果席位保证）：
        //    - 主席位：**阈值内**候选按激活分数排序；
        //    - 因果席位：传播激活的因果邻居（可低于阈值）占独立席位。
        const relevantIds = new Set(relevant.map((e) => e.id));
        const hitIds = new Set(candidates.map((e) => e.id));
        const causalSlots = Math.max(1, Math.ceil(limit / 2));
        // 时序衰减权重：近期记忆加分（新近优先，20 回合指数衰减；无 turn 信息时退化为 1）
        const curTurn = viewer.turn;
        const nodeById = new Map(candidates.map((e) => [e.id, e]));
        const recency = (id) => {
            const e = nodeById.get(id);
            if (!e || typeof curTurn !== 'number' || typeof e.turn !== 'number')
                return 1;
            const d = Math.max(0, curTurn - e.turn);
            return 1 + 0.25 * Math.exp(-d / 20);
        };
        // 类脑激活加权（阶段 3）：排序分数 = 语义激活 × sigmoid(基础激活 - 基准)，
        // 强化历史（命中/展开/链接）驱动——使用即巩固、闲置即遗忘。
        // 无激活缓存时退化为纯语义排序。
        const actBias = (id) => {
            if (!this.activation)
                return 1;
            const b = this.activation.get(id);
            // sigmoid 温和提升：B 高（近期多强化）加权，B 低（久未强化）不压死
            return 1 + 0.6 / (1 + Math.exp(-(b + 1.5))); // B≈0 时 ~1.09，B 大趋 1.6
        };
        const ranked = [];
        // 主席位：**阈值内**候选按「语义激活 × 激活加权 × 时序权重」排序
        const hitRanked = [...activated.entries()]
            .filter(([id]) => hitIds.has(id) && relevantIds.has(id))
            .sort((a, b) => b[1] * actBias(b[0]) * recency(b[0]) - a[1] * actBias(a[0]) * recency(a[0]));
        const mainQuota = Math.max(1, limit - causalSlots);
        const mainPicked = hitRanked.slice(0, mainQuota);
        ranked.push(...mainPicked);
        const mainIds = new Set(mainPicked.map(([id]) => id));
        // 因果席位：activated 中未进主席位的节点（含被截断的哈希命中邻居）
        // 按「因果传播增益」排序——激活分数高于自身重要性者优先
        // v0.3.30：加传播激活门槛（threshold×0.5）——纯噪声激活（哈希碰撞远邻居
        // 弱传播，如「分布式训练」→铁门记忆）不进席位；真因果邻居激活通常 ≥0.3
        const baseScores = scores;
        const causalMin = threshold * 0.5;
        const causalCandidates = [...activated.entries()]
            .filter(([id]) => !mainIds.has(id) && (activated.get(id) ?? 0) >= causalMin)
            .sort((a, b) => {
            const gainA = a[1] - (baseScores.get(a[0]) ?? 0);
            const gainB = b[1] - (baseScores.get(b[0]) ?? 0);
            return gainB - gainA || b[1] - a[1];
        });
        ranked.push(...causalCandidates.slice(0, causalSlots));
        // 主席位不足时用其余节点补齐
        let extra = ranked.length;
        const rest = causalCandidates.slice(causalSlots);
        while (extra < limit && rest.length > 0) {
            ranked.push(rest[extra - ranked.length]);
            extra += 1;
        }
        ranked.length = Math.min(ranked.length, limit);
        // 动态注入（分数团）：top1 的 0.9 倍以内的都注入（上限 limit）——
        // 明显第一只注入 1 条（确定，省噪声）；并列相关注入 2-3 条。
        // 自动唤醒（limit=1）自然收窄到 1 条；手动 recall 可到 3 条。
        const picked = [];
        let tokens = 0;
        const topScore = ranked[0]?.[1] ?? 0;
        for (const [id, score] of ranked) {
            if (picked.length >= limit)
                break;
            if (picked.length > 0 && score < topScore * 0.9)
                break;
            const e = this.store.get(id);
            // v0.4.0：因果传播可能经图边激活退役节点——选中时终审剔除
            if (!e || e.status === 'pending' || e.status === 'retired')
                continue;
            const cost = estimateTokens(e.title) + estimateTokens(e.summary);
            if (tokens + cost > this.config.injectBudgetTokens && picked.length > 0)
                break;
            picked.push(e);
            tokens += cost;
            this.store.touch(id);
        }
        const hit = {
            engrams: picked,
            reason: picked.length > 0 ? `hybrid-wake:${picked.length}` : 'below-threshold',
            injectedTokens: tokens,
        };
        // 融合：灵枢白箱验证闸门——选中的 engram 过 auto_verify，标注注入行
        // （✓锚定 / ~部分 / ?图谱外）；验证失败降级为无标注，绝不阻塞唤醒。
        const vf = opts.skipVerify ? undefined : this.verifier;
        if (vf && picked.length > 0) {
            const marks = {};
            await Promise.all(picked.slice(0, 3).map(async (e) => {
                try {
                    const m = await vf(e);
                    if (m)
                        marks[e.id] = m;
                }
                catch {
                    marks[e.id] = { status: 'error' };
                }
            }));
            hit.verify = marks;
        }
        // 融合：浅思维——hit 构建后拉取（条件/验证/边界；独立于命中数）
        await this.pullKnowledge(query, hit);
        // 去重：同 title 节点只留 hits 最高者（蒸馏/迁移可能产生同标题副本）
        const seenT = new Map();
        for (const e of hit.engrams) {
            const prev = seenT.get(e.title);
            if (!prev || (e.hits ?? 0) > (prev.hits ?? 0))
                seenT.set(e.title, e);
        }
        if (seenT.size !== hit.engrams.length) {
            hit.engrams = [...seenT.values()];
        }
        // query 是核心入口（maybeWake 与工具共用），结果供渲染器读取
        this.lastInjection = hit;
        return hit;
    }
    /** 渲染记忆注入段（动态预算：按相关度分级——高分完整入口、中分标题+摘要、低分仅标题）。 */
    renderInjection(budgetTokens) {
        const { engrams } = this.lastInjection;
        // 融合：记忆零命中但浅思维有内容 → 渲染纯浅思维段（灵枢校准器独立工作）
        if (engrams.length === 0) {
            if (this.lastKnowledge) {
                return `<engram-memory>（浅思维：灵枢校准器——当前话题图谱外，回答需标注边界）\n${this.lastKnowledge}\n</engram-memory>`;
            }
            return '';
        }
        // 考究的使用引导：让模型知道「入口可直接用、细节可展开、更多可检索」——
        // 渐进披露的入口层语义（摘要够用直接用，不够才展开，避免无谓的 open 调用）。
        const HEADER = '（统一大脑自动注入：记忆入口 = 相关往事；浅思维 = 灵枢校准（条件/验证/边界）——「图谱外」可用 engram_verify/engram_respond 求助深挖，查不到会自动补卡；分支探索结束后用 engram_store 沉淀结论（causes 关联主链）——分支思考入图谱；细节用 engram_open 展开）';
        const lines = [];
        let tokens = estimateTokens(HEADER);
        engrams.forEach((e, idx) => {
            if (tokens >= budgetTokens)
                return;
            // 分级渲染（engrams 已按激活分数降序）：
            //  - 第 1 条（最高分）：完整入口（标题+层+因果+摘要）
            //  - 第 2-3 条：标题+摘要（省因果注）
            //  - 其余：仅 [[标题]]（最大化覆盖，预算内尽量多挂入口）
            let line;
            if (idx === 0) {
                const causes = this.graph.causesOf(e.id);
                const effects = this.graph.effectsOf(e.id);
                const causeNote = causes.length > 0 ? ` ↑因:${causes.map((c) => c.title).join(';').slice(0, 60)}` : '';
                const effectNote = effects.length > 0 ? ` ↓果:${effects.map((c) => c.title).join(';').slice(0, 60)}` : '';
                line = `- [[${e.title}]][${e.layer}]${causeNote}${effectNote}: ${e.summary.slice(0, 120)}`;
            }
            else if (idx <= 2) {
                line = `- [[${e.title}]][${e.layer}]: ${e.summary.slice(0, 80)}`;
            }
            else {
                line = `- [[${e.title}]]`;
            }
            // 融合：灵枢白箱验证标注（anchored ✓ / partial ~ / unverified ?图谱外）
            const v = this.lastInjection.verify?.[e.id];
            if (v) {
                if (v.status === 'anchored')
                    line += ' ✓已锚定';
                else if (v.status === 'partial')
                    line += ' ~部分锚定';
                else if (v.status === 'unverified')
                    line += ' ?图谱外';
            }
            const cost = estimateTokens(line);
            if (tokens + cost > budgetTokens)
                return;
            lines.push(line);
            tokens += cost;
        });
        // 融合：知识之书段并入注入（灵枢知识卡——记忆入口 + 知识出招一次给到）
        if (this.lastKnowledge) {
            lines.push('');
            lines.push(this.lastKnowledge);
        }
        return lines.length > 0
            ? `<engram-memory>${HEADER}\n${lines.join('\n')}\n</engram-memory>`
            : '';
    }
    /** 供 status 工具读取。 */
    lastWake() {
        return this.lastInjection;
    }
}
/** 从 GenerateOptions 提取查询文本（最后一条 user 消息 + 前一条 assistant 回复摘要拼接）。 */
function extractQuery(options) {
    const messages = options.messages;
    if (!messages || messages.length === 0)
        return '';
    const textOf = (content) => {
        if (typeof content === 'string')
            return content;
        if (Array.isArray(content)) {
            return content
                .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String(b.text) : ''))
                .join(' ');
        }
        return '';
    };
    let userText = '';
    let lastAssistant = '';
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        const t = textOf(m.content).trim();
        if (t === '')
            continue;
        if (m.role === 'user' && userText === '') {
            userText = t;
            // 继续向上找最近一条 assistant 回复（上下文增益：口语-术语 gap 缩小，实测 +6.7% 召回）
        }
        else if (m.role === 'assistant' && userText !== '' && lastAssistant === '') {
            lastAssistant = t;
            break;
        }
    }
    if (userText === '')
        return '';
    const base = userText.slice(0, 1200);
    if (lastAssistant === '')
        return base;
    // 拼接上轮回复（截断保证查询不长——bge 对长查询也敏感）
    return `${lastAssistant.slice(0, 400)}\n${base}`;
}
/** 粗略 token 估算：CJK 约 1 字 ≈ 0.7 token（DeepSeek 中文实测 ~1.4 字/token），ASCII ≈ 0.25 token/字符。 */
export function estimateTokens(text) {
    let cjk = 0;
    let ascii = 0;
    for (const ch of text) {
        if (/[\u3000-\u9fff]/.test(ch))
            cjk += 1;
        else
            ascii += 1;
    }
    return Math.ceil(cjk * 0.7 + ascii / 4);
}
