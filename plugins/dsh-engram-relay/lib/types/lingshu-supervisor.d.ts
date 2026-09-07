/**
 * LingshuSupervisor — 灵枢校准器托管（融合自愈，v0.4.0）。
 *
 * 目标：让「融合灵枢」开箱即用——插件不再依赖用户手动
 * `python lingshu/start_lingshu.py`，而是：
 *  1. 探测：GET {url}/dex/status（短超时）判断服务健康；
 *  2. 自动拉起：探测失败且 lingshuAutoStart=true → spawn
 *     `python <packageRoot>/lingshu/start_lingshu.py <port>`，
 *     轮询就绪（默认 ≤15s；本地 DB 加载通常 <2s）；
 *  3. 按需自愈：每次 verify/respond 前 ensure()；服务中途挂掉
 *     （fetch 失败 → notifyFailure）后下一次 ensure 触发重启，
 *     10s 冷却防风暴；
 *  4. 所有权：只 kill 自己 spawn 的进程（dispose 时）；手动启动的
 *     实例（探测已健康）绝不 touch——尊重用户自管；
 *  5. 降级：不可用时给出友好说明（不抛裸 TypeError）。
 *
 * 约束：Node 侧零第三方依赖（项目约定）——只用 node: 内置。
 * 可测性：spawnFn / fetchFn 注入（单测不碰真实进程/端口）。
 */
import { type SpawnOptions } from 'node:child_process';
/** 进程句柄抽象（真实 ChildProcess 或测试桩）。 */
export interface SpawnHandle {
    pid?: number;
    kill: (signal?: NodeJS.Signals | number) => boolean;
}
export interface LingshuSupervisorOptions {
    /** 服务地址（如 http://127.0.0.1:18766）。 */
    url: string;
    /** 是否允许自动拉起（config.lingshuAutoStart）。 */
    autoStart: boolean;
    /** Python 解释器（config.lingshuPython || config.pythonPath）。 */
    pythonPath: string;
    /** 健康探测超时（ms）。 */
    probeTimeoutMs?: number;
    /** 拉起后轮询就绪的总预算（ms）。 */
    readyTimeoutMs?: number;
    /** 两次拉起尝试的最小间隔（ms，防风暴）。 */
    restartCooldownMs?: number;
    /** 健康缓存 TTL（ms）：期间不再重复探测。 */
    healthTtlMs?: number;
    /** 降级/事件日志回调（ctx.logger 转发）。 */
    logger?: (msg: string) => void;
    /** 测试注入：spawn 替代（默认真实 spawn）。 */
    spawnFn?: (cmd: string, args: string[], opts: SpawnOptions) => SpawnHandle;
    /** 测试注入：fetch 替代（默认真实 fetch）。 */
    fetchFn?: typeof fetch;
}
export type LingshuHealth = 'up' | 'starting' | 'down';
export declare class LingshuSupervisor {
    private opts;
    private proc;
    private weSpawned;
    private lastAttemptAt;
    private lastWarnAt;
    private lastHealth;
    private lastHealthAt;
    private readonly probeTimeoutMs;
    private readonly readyTimeoutMs;
    private readonly restartCooldownMs;
    private readonly healthTtlMs;
    private readonly port;
    private readonly script;
    constructor(opts: LingshuSupervisorOptions);
    /** 是否由本实例拉起（dispose 时据此决定 kill）。 */
    get isSelfManaged(): boolean;
    /** 健康探测：GET /dex/status（短超时，连接拒绝/超时均视为不健康）。 */
    health(): Promise<boolean>;
    /** 带 TTL 的健康探测（每轮唤醒都调用时，30s 内不重复打端口）。 */
    private probeCached;
    /**
     * 确保服务可用（verify/respond 每次调用前）：
     *  - 健康（含缓存）→ up；
     *  - 不健康且允许自动拉起 → 拉起（首调等待就绪；冷却内返回 starting）；
     *  - 不允许自动拉起 → down。
     */
    ensure(): Promise<LingshuHealth>;
    /** 服务中途挂掉（fetch 失败）时通知：失效健康缓存 → 下次 ensure 重新探测并自愈。 */
    notifyFailure(): void;
    /** 尝试拉起灵枢服务（spawn watchdog 脚本 + 轮询就绪）。 */
    private tryStart;
    /** 降级说明（verify/respond 工具面展示；不抛裸 TypeError）。 */
    degradedNote(): string;
    /** 限频告警（60s 一条，防日志风暴）。 */
    maybeWarn(msg: string): void;
    /** 插件卸载：只停自己拉起的进程；手动实例绝不动。 */
    dispose(): void;
    private log;
}
