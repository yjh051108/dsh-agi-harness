/**
 * TS 内嵌 bge ONNX embedder（免 Python 语义精排）。
 *
 * 降级链：TS ONNX（本模块，优先）→ Python 服务（回退）→ null（重要度兜底）。
 * 模型目录：config.embedModel（含 model.onnx + tokenizer.json + config.json）。
 * bge 的嵌入 = CLS 向量 + L2 归一化（pooling: 'cls' + normalize）。
 */

export interface OnnxEmbedResult {
  query_vec: number[]
  vectors: number[][]
}

let pipelinePromise: Promise<unknown> | null = null

export async function embedWithOnnx(texts: string[], query: string, modelDir: string): Promise<OnnxEmbedResult | null> {
  if (!modelDir || modelDir.trim() === '') return null
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowRemoteModels = false
    env.useBrowserCache = false
    if (!pipelinePromise) {
      // q8 = int8 量化（包内 model_quantized.onnx）；fp32 模型存在时可用 'fp32' 覆盖
      pipelinePromise = pipeline('feature-extraction', modelDir, { dtype: 'q8' })
    }
    const extractor: any = await pipelinePromise
    const all = await extractor([query, ...texts], { pooling: 'cls', normalize: true })
    // transformers.js 3.x 批量输出是 Tensor（batch [N, dim]）——按 dims 切行；
    // 兼容旧版数组形态。
    const toVec = (t: unknown): number[] => {
      const data = (t as { data: ArrayLike<number> }).data
      return data ? Array.from(data) : []
    }
    let queryVec: number[]
    let vectors: number[][]
    if (Array.isArray(all)) {
      queryVec = toVec(all[0])
      vectors = all.slice(1).map(toVec)
    } else {
      const data = (all as { data: ArrayLike<number> }).data
      const dims = (all as { dims?: number[] }).dims
      const rows = dims?.[0] ?? 1
      const cols = dims?.[1] ?? (data ? data.length / rows : 512)
      const rowVec = (r: number): number[] => {
        const out: number[] = new Array(cols)
        for (let i = 0; i < cols; i++) out[i] = data[r * cols + i]
        return out
      }
      queryVec = rowVec(0)
      vectors = []
      for (let r = 1; r < rows; r++) vectors.push(rowVec(r))
    }
    if (queryVec.length === 0) return null
    if (vectors.some((v: number[]) => v.length !== queryVec.length)) return null
    return { query_vec: queryVec, vectors }
  } catch (error) {
    console.warn('[onnx-embedder] embed 失败: %s', String(error).slice(0, 300))
    return null
  }
}
