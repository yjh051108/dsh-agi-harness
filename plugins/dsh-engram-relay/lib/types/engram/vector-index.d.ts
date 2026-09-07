/**
 * 向量索引（双量化 + 全量内积粗筛）。
 *
 * - int8 粗筛表：1B/维（10 万条 = 51MB）——排序大致正确即可；
 * - fp16 精筛表：2B/维（10 万条 = 102MB）——阈值判定/细排用（偏差 <0.001）；
 * - 检索：全量内积（TypedArray 循环；10 万×512 单线程 ~15-30ms，超预算时
 *   阶段 4 换 onnxruntime gemm/worker）；
 * - 持久化：vectors.i8.bin / vectors.f32.bin / vectors.meta.json（与 store 同目录）。
 */
export declare const VECTOR_DIM = 512;
export interface VectorHit {
    id: string;
    score: number;
}
export interface VectorIndex {
    add(id: string, vec: Float32Array): void;
    search(q: Float32Array, k: number): VectorHit[];
    remove(id: string): void;
    persist(): void;
    readonly size: number;
    has(id: string): boolean;
}
/** int8 量化：fp32 向量 → [-127,127]（按向量 L2 归一化后量化到单位尺度）。 */
export declare function quantizeI8(vec: Float32Array): Int8Array;
export declare class BruteForceIndex implements VectorIndex {
    /** id → 行号（fp16 表行序；tombstone 用 -1）。 */
    private rowById;
    /** fp32 精筛表（行主序 [N][512]；length = 容量元素，已用行数 = rows）。 */
    private f16;
    /** int8 粗筛表（行主序 [N][512]）。 */
    private i8;
    /** 已用行数（容量 = f16.length / dim，翻倍增长）。 */
    private rows;
    private dim;
    private filePrefix;
    private dirty;
    constructor(dir?: string, dim?: number);
    get size(): number;
    has(id: string): boolean;
    /** 追加一条（行序 = add 顺序；删除标记 tombstone 惰性压缩）。容量翻倍增长，摊还 O(1)/条。 */
    add(id: string, vec: Float32Array): void;
    remove(id: string): void;
    /** int8 全量内积粗筛 → top-k（fp16 细排在 wake 层做）。 */
    search(q: Float32Array, k: number): VectorHit[];
    /** fp16 精确余弦（细筛：top 候选的阈值判定用）。 */
    cosine(id: string, q: Float32Array): number;
    persist(): void;
    private load;
    /** 压缩 tombstone（删除行回收）——惰性，规模增长后调用。 */
    compact(): void;
}
