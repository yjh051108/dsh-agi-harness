/**
 * 确定性力导向布局（零依赖，纯函数）——两阶段递归布局。
 *
 * **阶段 1（组件级）**：把每个连通分量当作一个"大节点"（半径 = 成员最大
 * 半径余量），在放大空间上做斥力+向心力排布——分量从结构上不可能互相
 * 穿插（这是"图谱糊成一团、边乱交叉"的根治）。
 * **阶段 2（成员级）**：每个分量内，成员绕分量中心做 FR 力导向展开
 * （弹簧 = 期望边距，斥力防重叠）。
 * **归一化**：最终布局缩放进给定画布（分量多时虚拟空间放大 → 自动缩放
 * 回画布，契约不变：坐标永远落在 [0,width]×[0,height] 内）。
 *
 * 物理（两阶段共用）：Fruchterman-Reingold 风格（斥力 ∝ k²/d、弹簧
 * ∝ d²/k，k 随密度缩放）+ 向心力 + **温度冷却**（alpha 逐轮衰减：高温期
 * 局部结构成形，低温期冻结）。**确定性**：初始化与迭代全由输入决定，
 * 相同输入永远得到相同布局。
 *
 * 防重叠双保险：
 *   1. 物理斥力（长程散开）；
 *   2. 碰撞分离后处理（短程硬约束：任何两节点圆心距 ≥ r₁+r₂+gap，成对
 *      确定性推挤直至收敛——保证视觉上零重叠）。
 */

export interface ForceNodeInput {
  id: string
  /** 斥力权重（大节点推得更远；缺省 1）。 */
  weight?: number
  /** 节点半径（碰撞分离的最小间距基准；缺省 opts.radius）。 */
  radius?: number
}

export interface ForceEdgeInput {
  from: string
  to: string
}

export interface ForcePoint {
  x: number
  y: number
}

export interface ForceLayoutOptions {
  width: number
  height: number
  /** 迭代轮数（越多越收敛；缺省 200）。 */
  iterations?: number
  /** 温度冷却：alpha 每轮乘子（0-1；越小冷却越快、布局越"冻"在初始化附近）。 */
  alphaDecay?: number
  /** 斥力强度乘子（FR 斥力 = k²/d · repulsionScale）。 */
  repulsionScale?: number
  /** 弹簧强度乘子（FR 弹簧 = d²/k · springScale）。 */
  springScale?: number
  /** 弹簧自然间距缩放（期望边距 ≈ k·springFactor；缺省 1）。 */
  springFactor?: number
  /** 理想间距下限/上限（FR 的 k 被钳制在此区间）。 */
  kMin?: number
  kMax?: number
  /** 向心力（拉回中心，防飞散）。 */
  center?: number
  /** 分量质心引力强度（同团聚拢；缺省 center/2）。 */
  clusterCenter?: number
  /** 速度阻尼（0-1；越小越快停）。 */
  damping?: number
  /** 单轮最大位移（防抖）。 */
  maxMove?: number
  /** 节点半径（斥力计算的最小间距；缺省 18）。 */
  radius?: number
  /** 碰撞分离后处理：圆心最小间距 = r₁+r₂+gap（缺省 10）。 */
  gap?: number
  /** 碰撞分离轮数（缺省 200）。 */
  collisionIterations?: number
  /** 连通分量感知两阶段布局（缺省 true）。 */
  cluster?: boolean
}

/** 布局结果：nodeId → 中心点坐标。 */
export type ForceLayout = Map<string, ForcePoint>

const DEFAULT_RADIUS = 18

/** 确定性抖动（打破对称环的"斥力合力≈0"陷阱——对称初始化会被弹簧+
 * 向心力净内向拉成团；抖动让斥力获得非零径向分量，网络才能铺开）。 */
function jitter(i: number): number {
  const a = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return a - Math.floor(a) - 0.5
}

/** 连通分量（BFS；cluster=false 或无边时每节点独立分量）。 */
function computeComponents(
  nodes: ForceNodeInput[],
  edges: ForceEdgeInput[],
  cluster: boolean,
): { compOf: Map<string, number>; compMembers: string[][] } {
  const compOf = new Map<string, number>()
  const compMembers: string[][] = []
  if (cluster && edges.length > 0) {
    const adj = new Map<string, Set<string>>()
    for (const node of nodes) adj.set(node.id, new Set())
    for (const e of edges) {
      adj.get(e.from)?.add(e.to)
      adj.get(e.to)?.add(e.from)
    }
    for (const node of nodes) {
      if (compOf.has(node.id)) continue
      const comp = compMembers.length
      const members: string[] = []
      const stack = [node.id]
      compOf.set(node.id, comp)
      while (stack.length > 0) {
        const id = stack.pop()!
        members.push(id)
        for (const nb of adj.get(id) ?? []) {
          if (!compOf.has(nb)) {
            compOf.set(nb, comp)
            stack.push(nb)
          }
        }
      }
      compMembers.push(members)
    }
  } else {
    for (const node of nodes) {
      compOf.set(node.id, 0)
      compMembers.push([node.id])
    }
  }
  return { compOf, compMembers }
}

/** 单阶段 FR 力导向（两阶段布局的内部引擎；cluster=false 调用）。 */
function simulate(
  nodes: ForceNodeInput[],
  edges: ForceEdgeInput[],
  opts: ForceLayoutOptions,
): ForceLayout {
  const {
    width, height,
    iterations = 200,
    alphaDecay = 0.995,
    repulsionScale = 0.5,
    springScale = 0.6,
    springFactor = 1,
    kMin = 40,
    kMax = 110,
    center = 0.012,
    clusterCenter = center / 2,
    damping = 0.8,
    maxMove = 6,
    radius = DEFAULT_RADIUS,
    gap = 10,
    collisionIterations = 200,
  } = opts

  if (nodes.length === 0) return new Map()

  const cx = width / 2
  const cy = height / 2
  const n = nodes.length
  const ringRadius = Math.max(40, Math.min(width, height) / 2 - 60)
  // FR 理想间距：随密度缩放（节点越少间距越大，填满画布又不溢出）
  const k = Math.max(kMin, Math.min(kMax, 0.75 * Math.sqrt((width * height) / Math.max(1, n))))

  interface Body { x: number; y: number; vx: number; vy: number; weight: number; r: number }
  const bodies = new Map<string, Body>()
  const radiusOf = (node: ForceNodeInput): number => Math.max(4, node.radius ?? radius)

  // 初始：主环均匀展开 + 确定性抖动
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n + jitter(i) * 0.45
    const rr = ringRadius * (1 + jitter(i * 2 + 1) * 0.3)
    bodies.set(node.id, {
      x: cx + rr * Math.cos(angle),
      y: cy + rr * Math.sin(angle),
      vx: 0,
      vy: 0,
      weight: Math.max(0.5, node.weight ?? 1),
      r: radiusOf(node),
    })
  })

  // 边索引（弹簧只沿实际连接）。
  const edgePairs = edges
    .map((e) => ({ a: bodies.get(e.from), b: bodies.get(e.to) }))
    .filter((e): e is { a: Body; b: Body } => e.a !== undefined && e.b !== undefined && e.a !== e.b)

  for (let iter = 0; iter < iterations; iter += 1) {
    const alpha = Math.pow(alphaDecay, iter)

    // ---- 斥力（两两，O(n²)；FR：F = k²/d；图谱规模小，可接受）----
    const list = [...bodies.entries()]
    for (let i = 0; i < list.length; i += 1) {
      const [, a] = list[i]!
      for (let j = i + 1; j < list.length; j += 1) {
        const [, b] = list[j]!
        let dx = b.x - a.x
        let dy = b.y - a.y
        let dist2 = dx * dx + dy * dy
        // 最小间距兜底（重叠节点避免除零/爆力）
        const minDist = a.r + b.r + 12
        if (dist2 < minDist * minDist) dist2 = minDist * minDist
        const dist = Math.sqrt(dist2)
        // F = alpha · repulsionScale · k²/d · (w₁·w₂)
        const force = (alpha * repulsionScale * k * k * a.weight * b.weight) / dist
        const fx = (force * dx) / dist
        const fy = (force * dy) / dist
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    // ---- 弹簧（沿边；FR：F = d²/k，平衡边距 = k·springFactor）----
    for (const { a, b } of edgePairs) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      // 零长弹簧：把边距拉向 k·springFactor（d>L 向外张、d<L 向内收）
      const force = alpha * springScale * ((dist * dist) / k) * ((dist - k * springFactor) / Math.max(1, dist))
      const fx = (force * dx) / dist
      const fy = (force * dy) / dist
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // ---- 向心力（拉回画布中心），随 alpha 冷却 ----
    for (const body of bodies.values()) {
      body.vx += (cx - body.x) * center * alpha * body.weight
      body.vy += (cy - body.y) * center * alpha * body.weight
    }

    // ---- 积分 + 阻尼 + 限速 ----
    for (const body of bodies.values()) {
      body.vx *= damping
      body.vy *= damping
      const speed = Math.sqrt(body.vx * body.vx + body.vy * body.vy)
      if (speed > maxMove) {
        body.vx = (body.vx / speed) * maxMove
        body.vy = (body.vy / speed) * maxMove
      }
      body.x += body.vx
      body.y += body.vy
      // 硬边界（不越出画布）
      body.x = Math.max(body.r, Math.min(width - body.r, body.x))
      body.y = Math.max(body.r, Math.min(height - body.r, body.y))
    }
  }

  // ---- 碰撞分离后处理（短程硬约束：零重叠）----
  // 确定性松弛：固定成对顺序推挤，直到一轮无位移或轮数用尽。
  const list = [...bodies.values()]
  for (let it = 0; it < collisionIterations; it += 1) {
    let moved = false
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!
        const minD = a.r + b.r + gap
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 >= minD * minD) continue
        moved = true
        if (d2 < 1e-6) {
          // 完全重叠（初始同点/收敛到同点）：按索引确定性给出方向
          const dirX = (i + j) % 2 === 0 ? 1 : -1
          const dirY = ((i * 31 + j * 17) % 2 === 0) ? 1 : -1
          dx = minD * dirX
          dy = minD * dirY
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        // 各推一半（+0.5 保证收敛推进，避免浮点死锁）
        const push = (minD - d) / 2 + 0.5
        const ux = dx / d
        const uy = dy / d
        a.x -= ux * push
        a.y -= uy * push
        b.x += ux * push
        b.y += uy * push
      }
    }
    if (!moved) break
    for (const body of list) {
      body.x = Math.max(body.r, Math.min(width - body.r, body.x))
      body.y = Math.max(body.r, Math.min(height - body.r, body.y))
    }
  }

  const out: ForceLayout = new Map()
  for (const [id, body] of bodies) out.set(id, { x: body.x, y: body.y })
  return out
}

export function layoutForce(
  nodes: ForceNodeInput[],
  edges: ForceEdgeInput[],
  opts: ForceLayoutOptions,
): ForceLayout {
  const {
    width, height,
    cluster = true,
  } = opts

  if (nodes.length === 0) return new Map()

  // 关闭聚类 → 单阶段（坐标契约：落在给定画布内）
  if (!cluster) {
    return simulate(nodes, edges, opts)
  }

  const { compOf, compMembers } = computeComponents(nodes, edges, true)
  const C = compMembers.length

  // 单分量（或关闭聚类）→ 直接单阶段
  if (C <= 1) {
    return simulate(nodes, edges, opts)
  }

  // ═══ 阶段 1：组件级排布（虚拟空间 = 刚好容纳组件的环）═══
  const memberR = new Map<string, number>()
  for (const node of nodes) memberR.set(node.id, Math.max(4, node.radius ?? opts.radius ?? DEFAULT_RADIUS))
  // 每分量成员级展开空间的边长（阶段 2 用同款公式）
  const memberSide = (members: string[]): number =>
    Math.max(240, members.length * 80 + 60)
  const compExtent = (members: string[]): number =>
    memberSide(members) / 2 + (Math.max(...members.map((id) => memberR.get(id) ?? 0)) * 2) + 24
  const compRadiusList = compMembers.map(compExtent)
  const maxExtent = Math.max(...compRadiusList)
  // 环半径：让相邻组件中心弧距 ≥ 组件直径+余量（组件不会挤在一起；
  // 布局保持自然尺度，缩放交给视图 fitTransform）
  const requiredArc = Math.max(...compRadiusList.map((r) => r * 2 + 60))
  const ringRadius1 = Math.max(160, (C * requiredArc) / (2 * Math.PI))
  const W1 = (ringRadius1 + maxExtent + 100) * 2
  const H1 = W1
  const compNodes: ForceNodeInput[] = compMembers.map((members, c) => ({
    id: `__comp${c}`,
    weight: members.length > 1 ? 1 + Math.min(1, members.length / 12) : 1,
    radius: compRadiusList[c],
  }))
  const compEdges: ForceEdgeInput[] = []
  for (const e of edges) {
    const ca = compOf.get(e.from)
    const cb = compOf.get(e.to)
    if (ca !== undefined && cb !== undefined && ca !== cb) {
      compEdges.push({ from: `__comp${ca}`, to: `__comp${cb}` })
    }
  }
  const compLayout = simulate(compNodes, compEdges, {
    ...opts,
    width: W1,
    height: H1,
    cluster: false,
    kMin: 90,
    kMax: Math.max(110, Math.min(260, 0.75 * Math.sqrt((W1 * H1) / Math.max(1, C)) * 1.1)),
    iterations: opts.iterations ?? 200,
  })

  // ═══ 阶段 2：成员级展开（绕组件中心）═══
  const out: ForceLayout = new Map()
  for (let c = 0; c < C; c += 1) {
    const members = compMembers[c]!
    const cc = compLayout.get(`__comp${c}`) ?? { x: width / 2, y: height / 2 }
    if (members.length === 1) {
      out.set(members[0]!, { x: cc.x, y: cc.y })
      continue
    }
    // 成员级空间：边长随成员数（链/簇展开半径；与阶段 1 的 memberSide 同款）
    const side = memberSide(members)
    const memberSet = new Set(members)
    const intraEdges = edges
      .filter((e) => memberSet.has(e.from) && memberSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))
    const local = simulate(
      members.map((id) => nodes.find((nd) => nd.id === id) ?? { id }),
      intraEdges,
      {
        ...opts,
        width: side,
        height: side,
        cluster: false,
        kMin: 55,
        kMax: 90,
        iterations: Math.max(120, Math.min(240, Math.round((opts.iterations ?? 200) * 0.6))),
        center: 0.02,
      },
    )
    for (const id of members) {
      const p = local.get(id)
      if (p === undefined) continue
      out.set(id, {
        x: cc.x + p.x - side / 2,
        y: cc.y + p.y - side / 2,
      })
    }
  }

  return out
}
