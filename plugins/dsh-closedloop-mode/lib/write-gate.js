/**
 * write-gate — v0.6.27 写闸（导演拍板 2026-09-06「一起上」：Gate A 开单闸 + Gate B 步闸）。
 * 治的病（活案底：模型开任务不进环、裸干绕行——绕行免费、黑市比正规市场便宜）。
 * 规则：写类工具（write/edit）仅当「rolling + 已冻结 + 有 open 步」放行；其余按段位拒并指路。
 * 自由面（永不闸）：读/搜/探针/测量/终端检查等非写类工具；无闭环盘档的会话（子代理干活）不闸。
 * 接线：index.js 经 ctx.tools.guard 注册（effect 托管，重载即清）；Config.writeGate=false 整闸旁路。
 * 边界（诚实位）：pwsh 侧写文件不闸（测试/构建需跑；二期交 fs-sandbox 策略接）。
 */

/** 写类工具表（登记面可审；扩表=改这里+配测试） */
export const WRITE_TOOLS = ['write', 'edit']

/**
 * 闸决策（纯函数）：返回 undefined=放行，字符串=拒因（原样给模型看）。
 * @param {{toolName?:string, state?:object|null, hasOpenStep?:boolean}} args
 */
export function gateWrite(args) {
  const toolName = String(args?.toolName || '')
  if (!WRITE_TOOLS.includes(toolName)) return undefined
  const state = args?.state
  if (!state) {
    // v0.8.1 堵「绕环免费」（对照案底 session-b4a281a7：真人主会话全程未入环，
    // 51 次 write/edit 零拦截——本为子代理开的免闸口，成了主会话的免罪门）。
    // 只闸「有真人帧且未显式关自动接管」的会话；子代理（无真人帧）与 autoStart:false 仍放行。
    if (args?.hasHumanTurn && args?.autoStartDisabled !== true) {
      return '【开始一个任务】先用工具 super_task_completion_mode 启动超级任务完成模式：说明目标、完成标准和验证方式——之后你就可以自由写代码。侦察和测量（read/probe/搜索）此刻就可用。'
    }
    return undefined // 无真人帧=委派干活通道（导演定向：subagent=干活）
  }
  const stage = state.stage || 'off'
  if (stage === 'rolling') {
    if (!state.weightsLocked) return '【开始】先完成超级任务完成模式的准备（decompose→freeze），然后你就可以自由写代码了。侦察和测量（read/probe）现在就可用。'
    if (!args?.hasOpenStep) return '【下一步】用 optimal_declare 声明你要做的这一步（预期什么+怎么验证），通过后本步内写文件自由。一次专注做好一件事。'
    return undefined
  }
  if (stage === 'off') return '【开始一个任务】先启动超级任务完成模式，说明目标、完成标准和验证方式——之后你就可以自由写代码。侦察和测量（read/probe）现在就可用。'
  if (stage === 'final') return '【新任务】上一单已完成。启动超级任务完成模式，继续你的成长记录。'
  return '【准备中】超级任务完成模式的准备阶段走完（decompose→freeze）即可开始写代码。侦察和测量自由。'
}
