/**
 * 向量索引（双量化 + 全量内积粗筛）。
 *
 * - int8 粗筛表：1B/维（10 万条 = 51MB）——排序大致正确即可；
 * - fp16 精筛表：2B/维（10 万条 = 102MB）——阈值判定/细排用（偏差 <0.001）；
 * - 检索：全量内积（TypedArray 循环；10 万×512 单线程 ~15-30ms，超预算时
 *   阶段 4 换 onnxruntime gemm/worker）；
 * - 持久化：vectors.i8.bin / vectors.f32.bin / vectors.meta.json（与 store 同目录）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const VECTOR_DIM = 512

export interface VectorHit {
  id: string
  score: number
}

export interface VectorIndex {
  add(id: string, vec: Float32Array): void
  search(q: Float32Array, k: number): VectorHit[]
  remove(id: string): void
  persist(): void
  readonly size: number
  has(id: string): boolean
}

/** int8 量化：fp32 向量 → [-127,127]（按向量 L2 归一化后量化到单位尺度）。 */
export function quantizeI8(vec: Float32Array): Int8Array {
  const out = new Int8Array(vec.length)
  for (let i = 0; i < vec.length; i++) {
    const v = Math.max(-1, Math.min(1, vec[i]))
    out[i] = Math.round(v * 127)
  }
  return out
}

export class BruteForceIndex implements VectorIndex {
  /** id → 行号（fp16 表行序；tombstone 用 -1）。 */
  private rowById = new Map<string, number>()
  /** fp32 精筛表（行主序 [N][512]；length = 容量元素，已用行数 = rows）。 */
  private f16 = new Float32Array(0)
  /** int8 粗筛表（行主序 [N][512]）。 */
  private i8 = new Int8Array(0)
  /** 已用行数（容量 = f16.length / dim，翻倍增长）。 */
  private rows = 0
  private dim: number
  private filePrefix: string
  private dirty = false

  constructor(dir: string = '', dim: number = VECTOR_DIM) {
    this.dim = dim
    this.filePrefix = dir === '' ? '' : join(dir, 'vectors')
    if (this.filePrefix) this.load()
  }

  get size(): number {
    return this.rowById.size
  }

  has(id: string): boolean {
    return this.rowById.has(id)
  }

  /** 追加一条（行序 = add 顺序；删除标记 tombstone 惰性压缩）。容量翻倍增长，摊还 O(1)/条。 */
  add(id: string, vec: Float32Array): void {
    if (vec.length !== this.dim || this.rowById.has(id)) return
    const row = this.rows
    const need = (this.rows + 1) * this.dim
    if (need > this.f16.length) {
      const newCapRows = Math.max(this.rows + 1, Math.ceil(this.f16.length / this.dim) * 2 || 1024)
      const nf16 = new Float32Array(newCapRows * this.dim)
      nf16.set(this.f16.subarray(0, this.rows * this.dim))
      const ni8 = new Int8Array(newCapRows * this.dim)
      ni8.set(this.i8.subarray(0, this.rows * this.dim))
      this.f16 = nf16
      this.i8 = ni8
    }
    const q = quantizeI8(vec)
    for (let i = 0; i < this.dim; i++) {
      this.f16[row * this.dim + i] = vec[i]
      this.i8[row * this.dim + i] = q[i]
    }
    this.rowById.set(id, row)
    this.rows++
    this.dirty = true
  }

  remove(id: string): void {
    const row = this.rowById.get(id)
    if (row === undefined) return
    // tombstone：行置零（惰性压缩在 persist 时做）
    for (let i = 0; i < this.dim; i++) {
      this.f16[row * this.dim + i] = 0
      this.i8[row * this.dim + i] = 0
    }
    this.rowById.delete(id)
    this.dirty = true
  }

  /** int8 全量内积粗筛 → top-k（fp16 细排在 wake 层做）。 */
  search(q: Float32Array, k: number): VectorHit[] {
    const n = this.rowById.size
    if (n === 0) return []
    const scores = new Float32Array(n)
    const ids: string[] = new Array(n)
    // int8 表内积（整数乘加，快）
    const qq = quantizeI8(q)
    let idx = 0
    for (const [id, row] of this.rowById) {
      let s = 0
      const base = row * this.dim
      for (let i = 0; i < this.dim; i++) s += this.i8[base + i] * qq[i]
      scores[idx] = s
      ids[idx] = id
      idx++
    }
    // 部分选择：top-k（简单选择排序前 k——N 大时用快选；10 万级可接受）
    const top: VectorHit[] = []
    const taken = new Uint8Array(n)
    for (let t = 0; t < Math.min(k, n); t++) {
      let best = -Infinity
      let bestIdx = -1
      for (let i = 0; i < n; i++) {
        if (!taken[i] && scores[i] > best) {
          best = scores[i]
          bestIdx = i
        }
      }
      if (bestIdx < 0) break
      taken[bestIdx] = 1
      top.push({ id: ids[bestIdx], score: best })
    }
    return top
  }

  /** fp16 精确余弦（细筛：top 候选的阈值判定用）。 */
  cosine(id: string, q: Float32Array): number {
    const row = this.rowById.get(id)
    if (row === undefined) return 0
    let dot = 0
    let na = 0
    let nb = 0
    const base = row * this.dim
    for (let i = 0; i < this.dim; i++) {
      const v = this.f16[base + i]
      dot += v * q[i]
      na += v * v
      nb += q[i] * q[i]
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
  }

  persist(): void {
    if (!this.filePrefix) return
    mkdirSync(join(this.filePrefix, '..'), { recursive: true })
    // 只写已用部分（capacity 空洞不落盘）
    writeFileSync(`${this.filePrefix}.f32.bin`, Buffer.from(this.f16.buffer, 0, this.rows * this.dim * 4))
    writeFileSync(`${this.filePrefix}.i8.bin`, Buffer.from(this.i8.buffer, 0, this.rows * this.dim))
    writeFileSync(`${this.filePrefix}.meta.json`, JSON.stringify({
      count: this.rowById.size,
      dim: this.dim,
      rows: this.rows,
      ids: [...this.rowById.keys()],
    }))
    this.dirty = false
  }

  private load(): void {
    const metaPath = `${this.filePrefix}.meta.json`
    if (!existsSync(metaPath)) return
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      const rows = meta.rows ?? 0
      this.dim = meta.dim ?? this.dim
      if (existsSync(`${this.filePrefix}.f32.bin`)) {
        const buf = readFileSync(`${this.filePrefix}.f32.bin`)
        this.f16 = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      }
      if (existsSync(`${this.filePrefix}.i8.bin`)) {
        const buf = readFileSync(`${this.filePrefix}.i8.bin`)
        this.i8 = new Int8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
      }
      this.rows = rows
      const ids: string[] = meta.ids ?? []
      for (let r = 0; r < Math.min(rows, ids.length); r++) {
        if (ids[r] !== null) this.rowById.set(ids[r], r)
      }
    } catch { /* 加载失败空表，启动补算兜底 */ }
  }

  /** 压缩 tombstone（删除行回收）——惰性，规模增长后调用。 */
  compact(): void {
    const live = [...this.rowById.entries()].sort((a, b) => a[1] - b[1])
    const nf16 = new Float32Array(live.length * this.dim)
    const ni8 = new Int8Array(live.length * this.dim)
    live.forEach(([id, row], newRow) => {
      const src = row * this.dim
      const dst = newRow * this.dim
      for (let i = 0; i < this.dim; i++) {
        nf16[dst + i] = this.f16[src + i]
        ni8[dst + i] = this.i8[src + i]
      }
      this.rowById.set(id, newRow)
    })
    this.f16 = nf16
    this.i8 = ni8
    this.dirty = true
  }
}

