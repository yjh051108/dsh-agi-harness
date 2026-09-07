/**
 * TS 内嵌 bge ONNX embedder（免 Python 语义精排）。
 *
 * 降级链：TS ONNX（本模块，优先）→ Python 服务（回退）→ null（重要度兜底）。
 * 模型目录：config.embedModel（含 model.onnx + tokenizer.json + config.json）。
 * bge 的嵌入 = CLS 向量 + L2 归一化（pooling: 'cls' + normalize）。
 */
export interface OnnxEmbedResult {
    query_vec: number[];
    vectors: number[][];
}
export declare function embedWithOnnx(texts: string[], query: string, modelDir: string): Promise<OnnxEmbedResult | null>;
