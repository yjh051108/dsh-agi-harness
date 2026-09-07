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
  maxNgramSize: number
  /** 每级 n-gram 的头数（论文 n_head_per_ngram=8）。 */
  headsPerNgram: number
  /** 每级 n-gram 的槽位数（论文 engram_vocab_size，这里用 2 的幂便于取模）。 */
  slotsPerNgram: number
  /** 随机种子（决定乘子与素数序列，固定后寻址确定）。 */
  seed: number
  /** 归一化时折叠大小写。 */
  lowercase: boolean
}

export const DEFAULT_HASH_CONFIG: HashConfig = {
  maxNgramSize: 3,
  headsPerNgram: 4,
  slotsPerNgram: 4096,
  seed: 0,
  lowercase: true,
}

/** 一次哈希寻址的结果：展开后的槽位键列表（所有位置 × 所有头，去重）。 */
export interface HashResult {
  /** 槽位键：`n{len}h{head}:{slotId}`（文本内全部 n-gram 窗口的命中槽位）。 */
  slots: string[]
  /** 归一化后的 token 序列（调试/日志用）。 */
  tokens: string[]
}

/** 确定性伪随机数生成器（mulberry32）——保证跨进程/跨平台一致。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 确定性素数判定 + 取下一个素数（论文用 sympy.isprime，这里用 Miller-Rabin）。 */
function isPrime(n: number): boolean {
  if (n < 2) return false
  for (const p of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
    if (n % p === 0) return n === p
  }
  // 确定性 Miller-Rabin（适用于 < 2^32）
  let d = n - 1
  let s = 0
  while (d % 2 === 0) { d /= 2; s += 1 }
  for (const a of [2, 3, 5, 7, 11, 13, 17]) {
    if (a >= n) continue
    let x = modPow(a, d, n)
    if (x === 1 || x === n - 1) continue
    let composite = true
    for (let r = 1; r < s; r += 1) {
      x = (x * x) % n
      if (x === n - 1) { composite = false; break }
    }
    if (composite) return false
  }
  return true
}

function modPow(base: number, exp: number, mod: number): number {
  let result = 1
  base %= mod
  while (exp > 0) {
    if (exp % 2 === 1) result = (result * base) % mod
    base = (base * base) % mod
    exp = Math.floor(exp / 2)
  }
  return result
}

/** 下一素数（跳过已用）。 */
function nextPrime(start: number, seen: Set<number>): number {
  let c = start + 1
  while (true) {
    if (isPrime(c) && !seen.has(c)) return c
    c += 1
  }
}

export class NgramHashAddressing {
  private config: HashConfig
  /** 每层（n-gram 长度）的随机奇数乘子（对应论文 layer_multipliers）。 */
  private multipliers: number[][]
  /** 每层每头的素数模数（对应论文 head_vocab_sizes）。 */
  private primesPerHead: number[][]

  constructor(config: Partial<HashConfig> = {}) {
    this.config = { ...DEFAULT_HASH_CONFIG, ...config }
    const { maxNgramSize, headsPerNgram, slotsPerNgram, seed } = this.config

    // 乘子：每 n-gram 长度一个随机奇数（种子固定 → 确定）。
    const rng = mulberry32(seed)
    this.multipliers = []
    for (let n = 2; n <= maxNgramSize; n += 1) {
      this.multipliers.push(Array.from({ length: n }, () => {
        const r = Math.floor(rng() * 0x3fffffff)
        return r * 2 + 1
      }))
    }

    // 素数模数：每层每头一个素数，从 slotsPerNgram 附近开始递增。
    this.primesPerHead = []
    const seen = new Set<number>()
    for (let n = 2; n <= maxNgramSize; n += 1) {
      const heads: number[] = []
      let start = slotsPerNgram - 1
      for (let h = 0; h < headsPerNgram; h += 1) {
        const p = nextPrime(start, seen)
        seen.add(p)
        heads.push(p)
        start = p
      }
      this.primesPerHead.push(heads)
    }
  }

  /** 归一化文本 → token 数组（对应论文 CompressedTokenizer 的压缩）。 */
  normalize(text: string): string[] {
    let t = text
    if (this.config.lowercase) t = t.toLowerCase()
    // 空白归一 + 去首尾
    t = t.replace(/[ \t\r\n]+/g, ' ')
    t = t.trim()
    if (t === '') return []
    // 按空白切词
    const words = t.split(' ')
    const tokens: string[] = []
    for (const w of words) {
      if (w === '') continue
      // 先去掉标点/符号（统一处理，保证带标点与纯文本走同一分支）
      const cleaned = w.replace(/[^\w\u4e00-\u9fff-]+/g, '')
      if (cleaned === '') continue
      // 中文汉字逐字拆、连续字母/数字段成词——中英混合词也拆
      // （否则 "主题0" / "browser-panel操控" 整词成单 token，无 n-gram 可寻址）。
      const parts = cleaned.match(/[\u4e00-\u9fff]|[\w-]+/g) ?? []
      for (const p of parts) {
        tokens.push(p)
      }
    }
    return tokens.filter((x) => x !== '')
  }

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
  hashTokens(tokens: string[]): HashResult {
    const { maxNgramSize, headsPerNgram } = this.config
    const slotSet = new Set<string>()

    for (let n = 2; n <= maxNgramSize; n += 1) {
      const layerIdx = n - 2
      const mults = this.multipliers[layerIdx]
      const primes = this.primesPerHead[layerIdx]
      // 逐位置计算 n-gram 窗口哈希（论文：mix = Σ token_k * mult_k，XOR 混合）
      for (let i = n - 1; i < tokens.length; i += 1) {
        let mix = 0
        for (let k = 0; k < n; k += 1) {
          const tokHash = hashStr(tokens[i - n + 1 + k])
          mix = (mix + tokHash * mults[k]) % 2147483647
        }
        for (let h = 0; h < headsPerNgram; h += 1) {
          slotSet.add(`n${n}h${h}:${mix % primes[h]}`)
        }
      }
    }
    return { slots: [...slotSet], tokens }
  }

  /** 便捷入口：文本 → 寻址。 */
  hash(text: string): HashResult {
    return this.hashTokens(this.normalize(text))
  }

  /** 把多头槽位折叠成一组可索引的键（per-position 展开后的去重键）。 */
  slotKeys(result: HashResult): string[] {
    return result.slots
  }
}

/** FNV-1a 字符串哈希（32 位，确定性）。 */
function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
