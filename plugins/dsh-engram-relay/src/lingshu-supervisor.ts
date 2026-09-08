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

import { spawn, type SpawnOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** 进程句柄抽象（真实 ChildProcess 或测试桩）。 */
export interface SpawnHandle {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean
}

export interface LingshuSupervisorOptions {
  /** 服务地址（如 http://127.0.0.1:18766）。 */
  url: string
  /** 是否允许自动拉起（config.lingshuAutoStart）。 */
  autoStart: boolean
  /** Python 解释器（config.lingshuPython || config.pythonPath）。 */
  pythonPath: string
  /** 健康探测超时（ms）。 */
  probeTimeoutMs?: number
  /** 拉起后轮询就绪的总预算（ms）。 */
  readyTimeoutMs?: number
  /** 两次拉起尝试的最小间隔（ms，防风暴）。 */
  restartCooldownMs?: number
  /** 健康缓存 TTL（ms）：期间不再重复探测。 */
  healthTtlMs?: number
  /** 降级/事件日志回调（ctx.logger 转发）。 */
  logger?: (msg: string) => void
  /** 测试注入：spawn 替代（默认真实 spawn）。 */
  spawnFn?: (cmd: string, args: string[], opts: SpawnOptions) => SpawnHandle
  /** 测试注入：fetch 替代（默认真实 fetch）。 */
  fetchFn?: typeof fetch
}

export type LingshuHealth = 'up' | 'starting' | 'down'

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export class LingshuSupervisor {
  private proc: SpawnHandle | null = null
  private weSpawned = false
  private lastAttemptAt = 0
  private lastWarnAt = 0
  private lastHealth: boolean | null = null
  private lastHealthAt = 0
  private readonly probeTimeoutMs: number
  private readonly readyTimeoutMs: number
  private readonly restartCooldownMs: number
  private readonly healthTtlMs: number
  private readonly port: string
  private readonly script: string

  constructor(private opts: LingshuSupervisorOptions) {
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 600
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 15_000
    this.restartCooldownMs = opts.restartCooldownMs ?? 10_000
    this.healthTtlMs = opts.healthTtlMs ?? 30_000
    try {
      this.port = new URL(opts.url).port || '18766'
    } catch {
      this.port = '18766'
    }
    // lib/lingshu-supervisor.js → ../lingshu/start_lingshu.py（包根）
    this.script = join(dirname(fileURLToPath(import.meta.url)), '..', 'lingshu', 'start_lingshu.py')
  }

  /** 是否由本实例拉起（dispose 时据此决定 kill）。 */
  get isSelfManaged(): boolean {
    return this.weSpawned
  }

  /** 健康探测：GET /dex/status（短超时，连接拒绝/超时均视为不健康）。 */
  async health(): Promise<boolean> {
    const f = this.opts.fetchFn ?? fetch
    try {
      const res = await f(`${this.opts.url}/dex/status`, { signal: AbortSignal.timeout(this.probeTimeoutMs) })
      return res.ok
    } catch {
      return false
    }
  }

  /** 带 TTL 的健康探测（每轮唤醒都调用时，30s 内不重复打端口）。 */
  private async probeCached(): Promise<boolean> {
    const now = Date.now()
    if (this.lastHealth !== null && now - this.lastHealthAt < this.healthTtlMs) {
      return this.lastHealth
    }
    const ok = await this.health()
    this.lastHealth = ok
    this.lastHealthAt = now
    return ok
  }

  /**
   * 确保服务可用（verify/respond 每次调用前）：
   *  - 健康（含缓存）→ up；
   *  - 不健康且允许自动拉起 → 拉起（首调等待就绪；冷却内返回 starting）；
   *  - 不允许自动拉起 → down。
   */
  async ensure(): Promise<LingshuHealth> {
    if (await this.probeCached()) return 'up'
    if (!this.opts.autoStart) return 'down'
    const now = Date.now()
    if (now - this.lastAttemptAt < this.restartCooldownMs) return 'starting'
    this.lastAttemptAt = now
    await this.tryStart()
    // 拉起后复查（tryStart 内部已轮询；再确认一次走缓存也无妨）
    return this.lastHealth === true ? 'up' : 'starting'
  }

  /** 服务中途挂掉（fetch 失败）时通知：失效健康缓存 → 下次 ensure 重新探测并自愈。 */
  notifyFailure(): void {
    this.lastHealth = false
    this.lastHealthAt = 0
  }

  /** 尝试拉起灵枢服务（spawn watchdog 脚本 + 轮询就绪）。 */
  private async tryStart(): Promise<void> {
    // 案底 issue #1（JJLLKKDD）：spawn 找不到可执行文件触发的是 ChildProcess 异步 'error' 事件，
    // try/catch 接不住；无监听 → Unhandled 'error' → 杀死整个宿主进程。必须挂 on('error') 入盒。
    const spawnFail = { err: null }
    const doSpawn = this.opts.spawnFn ?? ((cmd: string, args: string[], o: SpawnOptions): SpawnHandle => {
      const child = spawn(cmd, args, o)
      child.on('error', (err) => { spawnFail.err = err })
      return { pid: child.pid, kill: (sig) => child.kill(sig) }
    })
    // 脚本缺失（快照不含 python 运行集）：直接跳过并降级，不 spawn
    if (!existsSync(this.script)) {
      this.weSpawned = false
      this.lastHealth = false
      this.lastHealthAt = Date.now()
      this.log('灵枢脚本不存在——降级为纯算法模式；如需语义服务请配置 pythonPath 与灵枢运行集')
      return
    }
    try {
      const handle = doSpawn(this.opts.pythonPath, [this.script, this.port], {
        stdio: 'ignore',
        windowsHide: true,
      })
      this.proc = handle
      this.weSpawned = true
      this.log(`灵枢服务未运行——自动拉起: ${this.opts.pythonPath} ${this.script} ${this.port}`)
      // 轮询就绪（本地 DB 加载通常 <2s；预算 15s）
      const deadline = Date.now() + this.readyTimeoutMs
      while (Date.now() < deadline) {
        await sleep(300)
        if (spawnFail.err) throw spawnFail.err
        if (await this.health()) {
          this.lastHealth = true
          this.lastHealthAt = Date.now()
          this.log('灵枢服务就绪（自愈完成）')
          return
        }
      }
      this.lastHealth = false
      this.lastHealthAt = Date.now()
      this.log(`灵枢服务拉起超时（${this.readyTimeoutMs}ms）——后台进程仍在，下次调用自动重试`)
    } catch (e) {
      // spawn 失败（python 不存在/路径错）：不重复尝试直到冷却结束
      this.weSpawned = false
      this.lastHealth = false
      this.lastHealthAt = Date.now()
      const code = String(e && e.code || '')
      const hint = code.includes('ENOENT') && this.opts.pythonPath === 'python' ? '（Linux/macOS 请把 pythonPath 配为 python3）' : ''
      this.log(`灵枢服务自动拉起失败: ${String(e).slice(0, 120)}${hint}`)
    }
  }

  /** 降级说明（verify/respond 工具面展示；不抛裸 TypeError）。 */
  degradedNote(): string {
    if (this.opts.autoStart) {
      return `灵枢服务未就绪（自动拉起中，${Math.ceil(this.restartCooldownMs / 1000)}s 内自动重试；也可手动: python lingshu/start_lingshu.py）`
    }
    return `灵枢服务未运行（lingshuVerifyUrl=${this.opts.url}；启动: python lingshu/start_lingshu.py）`
  }

  /** 限频告警（60s 一条，防日志风暴）。 */
  maybeWarn(msg: string): void {
    const now = Date.now()
    if (now - this.lastWarnAt >= 60_000) {
      this.lastWarnAt = now
      this.log(msg)
    }
  }

  /** 插件卸载：只停自己拉起的进程；手动实例绝不动。 */
  dispose(): void {
    if (this.weSpawned && this.proc) {
      try {
        this.proc.kill('SIGTERM')
        this.log('已停止自拉起的灵枢服务（插件卸载）')
      } catch {
        /* kill 失败不阻塞卸载 */
      }
    }
    this.proc = null
    this.weSpawned = false
  }

  private log(msg: string): void {
    try {
      this.opts.logger?.(msg)
    } catch {
      /* 日志回调失败静默 */
    }
  }
}


