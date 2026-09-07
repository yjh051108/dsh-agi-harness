/**
 * SemanticScorer — 纯算法语义打分器（v0.5：不用 embedding 模型）。
 *
 * 用户方向：embedding 是"借来的语义"（预训练先验），记忆系统的语义应
 * 来自图谱自身结构与库内统计——自举、确定性、可解释。
 *
 * 语义通道（分数 ∈ [0,1]，语义对齐原 cos 标定，0.6 阈值沿用）：
 *  ① 词汇通道（lexical）：字符 n-gram Jaccard × 词频覆盖——"因为字词
 *     重叠度高"（保底精确，可解释）；
 *  ② 图语义通道（graph）：候选的因果/链接邻居是否命中查询哈希节点——
 *     "因为沿着边相连"（可解释，怎么索引就怎么推荐）；
 *  ③ 统计语义通道（cooc，核心收敛通道）：**词-词共现相似**（PMI 风格，
 *     零矩阵分解）——查询词与记忆词的共现强度。能学语义桥（「缓存」
 *     与「cache」在同一记忆共现 → 共现计数建桥 → 查询命中），随记忆
 *     增多收敛（共现计数依概率收敛）。
 *     诚实声明：学的是"用户的语义空间"（库内统计），通用性上限低于
 *     预训练模型，但在单用户记忆库场景自举、可解释、无外部依赖。
 *     （v0.5 迭代：曾用谱分解（幂迭代 PCA），实测词向量坍缩——无关词
 *     余弦 0.8+，deflate 残留致全词同向；改为直接共现相似，零分解
 *     零坍缩风险，且更可解释。）
 *
 * 纯 CPU：比 ONNX 快几个数量级，永不失败（无模型依赖）。
 */
/** 字符 n-gram 集合（2-3 gram，中文逐字 + ASCII 保词）。 */
function charNgrams(text, n = 2) {
    const out = new Set();
    const t = text.replace(/\s+/g, '');
    if (t.length < n) {
        if (t.length > 0)
            out.add(t);
        return out;
    }
    for (let i = 0; i <= t.length - n; i++)
        out.add(t.slice(i, i + n));
    return out;
}
/** 词频表（token 化：CJK 重叠 bigram + ASCII 整词——单字粒度共现噪音大，
 *  「计」「量」等常用字与大量词共现导致无关记忆 cooc 全高，第五轮实测）。 */
function wordsOf(text) {
    const out = new Map();
    const tokens = text.match(/[a-z0-9]+|[^\u0000-\u007f]+/gi) ?? [];
    const bump = (k) => { out.set(k, (out.get(k) ?? 0) + 1); };
    for (const tok of tokens) {
        if (/[a-z0-9]/i.test(tok)) {
            bump(tok.toLowerCase());
        }
        else if (tok.length === 1) {
            bump(tok);
        }
        else {
            for (let i = 0; i < tok.length - 1; i++)
                bump(tok.slice(i, i + 2));
        }
    }
    return out;
}
/** Jaccard 相似度。 */
function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return inter / (a.size + b.size - inter);
}
/**
 * 统计语义通道（词-词共现相似，PMI 风格，零矩阵分解）。
 *
 * 语义桥机制：词 a、b 在同一记忆出现 → co(a,b) 计数 +1。查询词 q 对
 * 记忆 m 的统计语义分 = Σ_{w∈m} co(q,w)（查询词与记忆词的共现强度），
 * 归一化到 [0,1]。IDF 降权高频词（记忆/系统等通用词不主导）。
 */
class CoocSemantics {
    store;
    /** 词-词共现计数：word → Map<word, count>（同记忆词对共现，IDF 加权）。 */
    co = new Map();
    built = false;
    /** v0.3.48 节流：重建时间戳——写入后 2s 窗口内不重建（旧表可用）——
     *  蒸馏高频写入时查询不再每次撞 6s 重建尖峰 */
    rebuiltAt = 0;
    constructor(store) {
        this.store = store;
    }
    /** 懒重建（store 变化后首次 score 调用时；节流窗口内用旧表）。 */
    ensure() {
        if (this.built)
            return;
        if (Date.now() - this.rebuiltAt < 2000)
            return; // 节流窗口：旧表仍可用
        this.rebuild();
    }
    markDirty() {
        this.built = false;
    }
    /** 重建：全库词对共现统计（IDF 加权）。 */
    rebuild() {
        this.built = true;
        this.rebuiltAt = Date.now();
        this.co = new Map();
        const nodes = this.store.all().filter((e) => e.status !== 'pending');
        if (nodes.length < 2)
            return;
        const df = new Map();
        const nodeWords = [];
        for (const n of nodes) {
            const words = [...wordsOf(`${n.title}：${n.summary}`).keys()];
            if (words.length === 0)
                continue;
            nodeWords.push(words);
            for (const w of new Set(words))
                df.set(w, (df.get(w) ?? 0) + 1);
        }
        const N = nodeWords.length;
        const idf = (w) => Math.log((N + 1) / ((df.get(w) ?? 1) + 1)) + 1;
        // ⚠️ 高频字停用（第五轮新 agent 实测：单字 token 下「计」「量」等常用字
        // 与大量词共现 → 无关记忆 cooc 全 1.0 坍缩）：df > 20% 节点的字不建
        // 共现（不携带语义，纯噪音）。**加绝对下限**：小库（<25 条）时比例
        // 虚高会误杀真语义词（「缓存」在 3 条库里 df=67%）
        const stopSet = new Set();
        for (const [w, d] of df) {
            if (d > Math.max(5, N * 0.2))
                stopSet.add(w);
        }
        const bump = (a, b, w) => {
            // ⚠️ 双向：查询可能从任意一侧发起（queryStrength 只查 co.get(查询词)）——
            // 只建上三角会导致 co(cache,缓) 缺失、co(缓,cache) 存在 → 查询查不到
            for (const [x, y] of [[a, b], [b, a]]) {
                let row = this.co.get(x);
                if (!row) {
                    row = new Map();
                    this.co.set(x, row);
                }
                row.set(y, (row.get(y) ?? 0) + w);
            }
        };
        for (const words of nodeWords) {
            const kept = words.filter((w) => !stopSet.has(w));
            if (kept.length === 0)
                continue;
            const weights = new Map();
            for (const w of kept)
                weights.set(w, idf(w));
            for (let i = 0; i < kept.length; i++) {
                const wi = kept[i];
                const wiw = weights.get(wi);
                for (let j = i; j < kept.length; j++) {
                    const wj = kept[j];
                    bump(wi, wj, wiw * weights.get(wj));
                }
            }
        }
    }
    /** 查询文本 → 查询词的共现邻居强度（对记忆词的共现和）。 */
    queryStrength(queryWords, memWords) {
        let total = 0;
        for (const q of queryWords) {
            const row = this.co.get(q);
            if (!row)
                continue;
            for (const m of memWords) {
                total += row.get(m) ?? 0;
            }
        }
        return total;
    }
    /** 原始共现强度（未归一化——外层按候选集 max 相对归一化，见
     *  SemanticScorer.score。能桥接「缓存」↔「cache」）。 */
    rawScore(query, memText) {
        this.ensure();
        const qWords = [...wordsOf(query).keys()];
        const mWords = [...wordsOf(memText).keys()];
        if (qWords.length === 0 || mWords.length === 0)
            return 0;
        // 直接词匹配分（同词也算"共现"——自共现已含）
        let direct = 0;
        for (const q of qWords) {
            const row = this.co.get(q);
            if (!row)
                continue;
            for (const m of mWords) {
                if (q === m)
                    direct += row.get(m) ?? 0;
            }
        }
        const cross = this.queryStrength(qWords, mWords);
        // 均值化（相对查询词数）——不映射（映射交给外层相对归一化）
        return (cross + direct) / Math.max(1, qWords.length);
    }
    /** 查询扩展（v0.6 粗筛语义对齐）：查询词 + 每个词的 top-k 共现邻居
     *  ——「滚轮」↔「onwheel」这类共现桥进粗筛，语义相关但 token 零共享
     *  的记忆不再被倒排挡在候选外。 */
    expandWords(words, topK = 3) {
        this.ensure();
        const out = new Set(words);
        for (const w of words) {
            const row = this.co.get(w);
            if (!row)
                continue;
            const sorted = [...row.entries()].sort((a, b) => b[1] - a[1]);
            for (const [nb] of sorted.slice(0, topK))
                out.add(nb);
        }
        return [...out];
    }
}
export class SemanticScorer {
    store;
    /** 查询哈希命中的节点 id 集（图语义通道的种子）。 */
    queryHits = new Set();
    cooc;
    constructor(store) {
        this.store = store;
        this.cooc = new CoocSemantics(store);
    }
    /**
     * 对候选打分（同步纯算法）：score = α·lexical + β·graph + γ·cooc。
     * α/β/γ 初始标定（0.5/0.25/0.25）；后续可经 fit-tau 数据驱动调整。
     */
    /** 查询级结果缓存（LRU 16——重复查询免重算；压力阀场景同主题多轮查询收益大） */
    scoreCache = new Map();
    score(query, candidates) {
        const out = new Map();
        if (candidates.length === 0)
            return out;
        // 命中缓存（候选 id 集不变才可用）
        const key = query + '|' + candidates.map((c) => c.id).join(',');
        const cached = this.scoreCache.get(key);
        if (cached) {
            this.scoreCache.delete(key);
            this.scoreCache.set(key, cached);
            return new Map(cached);
        }
        const qGrams = charNgrams(query, 2);
        const qWords = wordsOf(query);
        // 图语义种子：查询哈希命中（O(1) 寻址）
        this.queryHits = new Set(this.store.lookup(query, 64).map((e) => e.id));
        const alpha = 0.5;
        const beta = 0.25;
        const gamma = 0.25;
        for (const e of candidates) {
            const text = `${e.title}：${e.summary}`;
            const mGrams = charNgrams(text, 2);
            // v0.3.34：查询侧 2-gram 命中率（替代 Jaccard——不被候选文本长度稀释，
            // 与灵枢 bigram_hit 对称——变体查询召回增强：
            // 「脏标题怎么处理」vs「脏标题」——加词不再稀释命中率）
            const lex = qGrams.size > 0
                ? [...qGrams].filter((g) => mGrams.has(g)).length / qGrams.size
                : 0;
            // 词频增强：查询词在候选中的覆盖率
            const mWords = wordsOf(text);
            let hitWords = 0;
            let totalW = 0;
            for (const [w, c] of qWords) {
                const mc = mWords.get(w) ?? 0;
                if (mc > 0)
                    hitWords += Math.min(c, mc);
                totalW += c;
            }
            const wordCover = totalW > 0 ? hitWords / totalW : 0;
            const lexical = Math.min(1, lex * 0.6 + wordCover * 0.4);
            // 图语义：候选是否在查询命中节点的 1-2 跳邻居内
            let graph = 0;
            if (this.queryHits.size > 0) {
                const nb = new Set([...(e.causes ?? []), ...(e.effects ?? []), ...(e.links ?? []).map((t) => this.store.byTitle(t)?.id ?? '')]);
                if (this.queryHits.has(e.id) && lexical >= 0.05) {
                    graph = 1; // 自身命中（需词面证据——槽碰撞项 lexical=0 不授予，防无关记忆被哈希碰撞抬分）
                }
                else if ([...nb].some((x) => this.queryHits.has(x))) {
                    graph = 0.7; // 1 跳
                }
                else {
                    graph = 0.15; // 2 跳内（v0.3.29 收紧：任意边弱信号曾让临界误命中过线——
                    //                如「分布式训练」→ 铁门记忆 0.425 vs 阈值 0.42）
                }
            }
            // 统计语义（共现桥——「缓存」↔「cache」）
            const cooc = this.cooc.rawScore(query, text);
            out.set(e.id, {
                score: 0, // 占位，下方统一计算（cooc 需候选集内相对归一化）
                lexical: Number(lexical.toFixed(4)),
                graph: Number(graph.toFixed(2)),
                cooc: cooc,
            });
        }
        // ⚠️ cooc 查询内相对归一化（v0.6：raw 值巨大（max 数百）且 log1p(50)
        // 映射过早饱和 → 无关候选 cooc 也全 1.0 无区分度）：候选内最强 = 1.0，
        // 其余按比例——同主题候选（共现高）相对分高，无关候选低。
        let maxRaw = 1;
        for (const s of out.values())
            if (s.cooc > maxRaw)
                maxRaw = s.cooc;
        for (const [id, s] of out) {
            const cooc = s.cooc > 0 ? s.cooc / maxRaw : 0;
            out.set(id, {
                score: Math.min(1, alpha * s.lexical + beta * s.graph + gamma * cooc),
                lexical: s.lexical,
                graph: s.graph,
                cooc: Number(cooc.toFixed(4)),
            });
        }
        // LRU 写缓存（16 上限）
        this.scoreCache.set(key, new Map(out));
        if (this.scoreCache.size > 16) {
            const first = this.scoreCache.keys().next().value;
            if (first !== undefined)
                this.scoreCache.delete(first);
        }
        return out;
    }
    /** store 变化后调用（共现表懒重建——写入/蒸馏后）。 */
    markDirty() {
        this.cooc.markDirty();
    }
    /** 图语义种子暴露（调试/测试）。 */
    hits() {
        return this.queryHits;
    }
    /** 查询扩展词（粗筛用——共现邻居进 token 倒排，语义对齐）。 */
    expandQuery(query, topK = 3) {
        return this.cooc.expandWords([...wordsOf(query).keys()], topK);
    }
}
