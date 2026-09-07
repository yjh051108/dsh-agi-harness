/**
 * PythonEngramClient — spawn Python 转接服务（JSON 行协议）。
 *
 * 对接 python/engram_model/server.py：stdin/stdout JSON 行 RPC。
 * 能力：load / generate / distill / write_memory / embed / status。
 *
 * 服务未就绪/启动失败时：所有调用返回 null（插件降级为纯哈希
 * 路由 + 文本注入，不阻塞主流程）。
 */
export interface DistillEntry {
    kind: 'fact' | 'decision' | 'event' | 'note';
    label: string;
    text: string;
    importance: number;
    causes: string[];
}
export declare class PythonEngramClient {
    private pythonPath;
    private modelId;
    private checkpoint;
    private embedModel;
    private proc;
    private pending;
    private seq;
    private buffer;
    private ready;
    private failed;
    constructor(pythonPath?: string, modelId?: string, checkpoint?: string, embedModel?: string);
    /** 启动服务（幂等；失败记录后所有调用返回 null）。 */
    start(): void;
    private request;
    load(): Promise<{
        loaded: boolean;
        stats?: {
            entries: number;
            slots: number;
        };
        lora?: boolean;
    } | null>;
    generate(text: string, maxNewTokens?: number, temperature?: number): Promise<{
        text: string;
    } | null>;
    distill(conversation: string): Promise<{
        raw: string;
        parsed: DistillEntry | null;
    } | null>;
    writeMemory(entries: Array<{
        text: string;
    }>): Promise<{
        written: number;
        slots: number[];
    } | null>;
    /** 文本编码（bge 嵌入模型；embedModel 空时由服务端 ENGRAM_EMBED_MODEL 决定）。 */
    embed(texts: string[], query?: string): Promise<{
        vectors: number[][];
        query_vec?: number[];
    } | null>;
    status(): Promise<{
        loaded: boolean;
        entries?: number;
        slots?: number;
    } | null>;
    stop(): void;
}
