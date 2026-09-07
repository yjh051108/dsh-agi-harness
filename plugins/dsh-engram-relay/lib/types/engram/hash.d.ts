/**
 * NgramHashAddressing — DeepSeek Engram 风格的多头 N-gram 哈希寻址。
 *
 * 论文（Conditional Memory via Scalable Lookup）核心：对 token 序列做
 * 2/3-gram 多项式哈希（multi-head，多素数取模），O(1) 确定性寻址到
 * 巨大记忆表的槽位。确定性寻址 = 相同模式永远命中相同槽位，无相似度
 * 检索的近似性——这是「比普通向量索引更强」的根源。
 *
 * 本实现按论文 demo（engram_demo_v1.py）的逻辑移植到 TypeScript：
 *  - token 归一化（大小写折叠 + 空白归一，对应论文 CompressedTokenizer）
 *  - 逐层独立随机奇数乘子（对应论文 layer_multipliers）
 *  - 多头：每 n-gram 长度多个素数模数（对应论文 head_vocab_sizes）
 *
 * 与论文差异：论文的记忆表是训练出的 embedding table；本插件的外置
 * engram 表是「哈希槽 → 记忆条目」（JSONL 持久化），由 <1B 模型蒸馏
 * 写入、请求前按当前上下文的哈希寻址唤醒。
 */
/** 多头哈希配置。 */
export interface HashConfig {
    /** 最大 n-gram 长度（论文 max_ngram_size=3 → 2-gram、3-gram 两级）。 */
    maxNgramSize: number;
    /** 每级 n-gram 的头数（论文 n_head_per_ngram=8）。 */
    headsPerNgram: number;
    /** 每级 n-gram 的槽位数（论文 engram_vocab_size，这里用 2 的幂便于取模）。 */
    slotsPerNgram: number;
    /** 随机种子（决定乘子与素数序列，固定后寻址确定）。 */
    seed: number;
    /** 归一化时折叠大小写。 */
    lowercase: boolean;
}
export declare const DEFAULT_HASH_CONFIG: HashConfig;
/** 一次哈希寻址的结果：展开后的槽位键列表（所有位置 × 所有头，去重）。 */
export interface HashResult {
    /** 槽位键：`n{len}h{head}:{slotId}`（文本内全部 n-gram 窗口的命中槽位）。 */
    slots: string[];
    /** 归一化后的 token 序列（调试/日志用）。 */
    tokens: string[];
}
export declare class NgramHashAddressing {
    private config;
    /** 每层（n-gram 长度）的随机奇数乘子（对应论文 layer_multipliers）。 */
    private multipliers;
    /** 每层每头的素数模数（对应论文 head_vocab_sizes）。 */
    private primesPerHead;
    constructor(config?: Partial<HashConfig>);
    /** 归一化文本 → token 数组（对应论文 CompressedTokenizer 的压缩）。 */
    normalize(text: string): string[];
    /**
     * 对 token 序列做多头 n-gram 哈希寻址（per-position，论文语义）。
     *
     * 论文（engram_demo_v1.py `_get_ngram_hashes`）：对每个 token 位置 i，
     * 取以 i 结尾的 n-gram 窗口，用乘子多项式/XOR 混合后对多头素数取模。
     * **相同 n-gram 模式永远命中相同槽位**——与出现在文本的哪个位置无关。
     *
     * 因此查询与记忆文本只要**共享任意一个 n-gram 窗口**（如「部署端口」
     * 这个 2-gram），就至少有一个槽位重叠 → 确定性命中。
     */
    hashTokens(tokens: string[]): HashResult;
    /** 便捷入口：文本 → 寻址。 */
    hash(text: string): HashResult;
    /** 把多头槽位折叠成一组可索引的键（per-position 展开后的去重键）。 */
    slotKeys(result: HashResult): string[];
}
