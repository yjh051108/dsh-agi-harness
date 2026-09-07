/**
 * GraphView — 记忆图谱可视化（DSH 会话页「图谱」Tab）。
 *
 * 数据面：host 的 /engram-relay/api/graph（分层准入：global + 本目录
 * project + 本会话 session）。渲染：确定性力导向布局（force.ts）+ SVG。
 *  - 节点 = 记忆（颜色按层：global 蓝 / project 绿 / session 橙；
 *    半径随 importance 增长）
 *  - 实线边 = 因果（causes），虚线边 = 双向链接（link），随距离淡出
 *  - 交互：滚轮缩放（以光标为中心）、拖拽平移、双击复位、
 *    悬停高亮邻接网络（其余淡化）+ 原生 tooltip（标题/摘要）、
 *    点击节点 → 详情侧栏（渐进披露第二层）
 *  - 过滤切换时节点位置平滑过渡（CSS transform），标签贪心防重叠、
 *    缩放足够深才批量显示（悬停节点标签常显）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { layoutForce, type ForcePoint } from './force.ts'
import styles from './graph.module.css'

export interface GraphNodeData {
  id: string
  title: string
  summary: string
  kind: string
  layer: 'global' | 'project' | 'session'
  projectId: string | null
  importance: number
  hits: number
  createdAt: number
}

export interface GraphEdgeData {
  from: string
  to: string
  kind: 'causes' | 'link'
}

interface GraphData {
  nodes: GraphNodeData[]
  edges: GraphEdgeData[]
  total: number
}

interface NodeDetail extends GraphNodeData {
  content: string
  causes: GraphNodeData[]
  effects: GraphNodeData[]
  links: GraphNodeData[]
}

/** 层 → 颜色。 */
export const LAYER_COLORS: Record<string, string> = {
  global: '#4a7dff',
  project: '#34c98a',
  session: '#ff9f43',
}

/** 边类型 → 渲染样式。 */
export const EDGE_STYLE: Record<'causes' | 'link', { color: string; dash: string }> = {
  causes: { color: '#8a94a6', dash: '' },
  link: { color: '#aab2c0', dash: '5 4' },
}

const VIEW_W = 900
const VIEW_H = 620
const MIN_K = 0.2
const MAX_K = 3.2

/** 视口变换：先平移后缩放（屏幕 = t + p·k）。 */
interface Transform { x: number; y: number; k: number }

/** 把一组节点点集适配进画布（含标签/半径余量），返回初始变换。 */
function fitTransform(points: Array<{ x: number; y: number; r: number }>, w: number, h: number): Transform {
  if (points.length === 0) return { x: w / 2, y: h / 2, k: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    const m = p.r + 42 // 半径 + 标签余量
    if (p.x - m < minX) minX = p.x - m
    if (p.y - m < minY) minY = p.y - m
    if (p.x + m > maxX) maxX = p.x + m
    if (p.y + m > maxY) maxY = p.y + m
  }
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const k = Math.min(1.25, Math.max(0.25, 0.92 * Math.min(w / bw, h / bh)))
  return {
    k,
    x: (w - bw * k) / 2 - minX * k,
    y: (h - bh * k) / 2 - minY * k,
  }
}

interface GraphViewProps {
  t: (key: string, params?: Record<string, unknown>) => string
  /** 当前会话 id（host 端据此解析工作目录做分层准入）。 */
  sessionId?: string
}

export function GraphView({ t, sessionId }: GraphViewProps) {
  const [data, setData] = useState<GraphData | null>(null)
  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tf, setTf] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const panState = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null)

  const loadGraph = (): void => {
    setLoading(true)
    setError('')
    const q = sessionId !== undefined && sessionId !== '' ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    void fetch(`/engram-relay/api/graph${q}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: GraphData) => setData(d))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadGraph()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 层过滤 + 布局（确定性力导向，含碰撞分离硬约束）。
  const { nodes, edges, layout, radiusOf, neighbors } = useMemo(() => {
    if (data === null) return { nodes: [], edges: [], layout: new Map<string, ForcePoint>(), radiusOf: new Map<string, number>(), neighbors: new Map<string, Set<string>>() }
    const visible = filter === 'all' ? data.nodes : data.nodes.filter((n) => n.layer === filter)
    const ids = new Set(visible.map((n) => n.id))
    const visibleEdges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to))
    // 半径随 importance（7–16），权重随 importance（0.6–1.6）
    const radiusOf = new Map<string, number>()
    for (const n of visible) {
      radiusOf.set(n.id, 7 + Math.max(0, Math.min(1, n.importance)) * 9)
    }
    const layout = layoutForce(
      visible.map((n) => ({ id: n.id, weight: 0.6 + n.importance, radius: radiusOf.get(n.id) })),
      visibleEdges.map((e) => ({ from: e.from, to: e.to })),
      {
        // 两阶段布局（组件级排布 → 成员级展开）：布局保持自然尺度，
        // 视图经 fitTransform 缩放适配；参数经 95 节点压力图扫描定稿
        // （聚团比 4.9、零重叠、边距≈110）
        iterations: 250,
        repulsionScale: 0.25,
        springScale: 2.0,
        center: 0.02,
        alphaDecay: 0.995,
        damping: 0.8,
        maxMove: 8,
        radius: 12,
        gap: 14,
      },
    )
    const neighbors = new Map<string, Set<string>>()
    for (const n of visible) neighbors.set(n.id, new Set())
    for (const e of visibleEdges) {
      neighbors.get(e.from)?.add(e.to)
      neighbors.get(e.to)?.add(e.from)
    }
    return { nodes: visible, edges: visibleEdges, layout, radiusOf, neighbors }
  }, [data, filter])

  // 布局变化（数据/过滤切换）→ 自动适配视图。
  const refit = useCallback((): void => {
    const pts = [...layout.entries()].map(([id, p]) => ({ x: p.x, y: p.y, r: radiusOf.get(id) ?? 12 }))
    setTf(fitTransform(pts, VIEW_W, VIEW_H))
  }, [layout, radiusOf])

  useEffect(() => {
    refit()
  }, [refit])

  // ---- 坐标换算（preserveAspectRatio=meet 的精确逆变换）----
  const toViewBox = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const el = svgRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
    const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H)
    const ox = (rect.width - VIEW_W * s) / 2
    const oy = (rect.height - VIEW_H * s) / 2
    return { x: (clientX - rect.left - ox) / s, y: (clientY - rect.top - oy) / s }
  }, [])

  // ---- 缩放（以光标为锚点，滚轮；原生非 passive 监听）----
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number): void => {
    const p = toViewBox(clientX, clientY)
    setTf((prev) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, prev.k * factor))
      const x = p.x - (p.x - prev.x) * (k / prev.k)
      const y = p.y - (p.y - prev.y) * (k / prev.k)
      return { x, y, k }
    })
  }, [toViewBox])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  // ---- 平移（拖拽空白处）----
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return
    if ((e.target as Element).closest('[data-node]') !== null) return // 节点上不拖拽
    const p = toViewBox(e.clientX, e.clientY)
    panState.current = { sx: p.x, sy: p.y, tx: tf.x, ty: tf.y }
    setPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const pan = panState.current
    if (pan === null) return
    const p = toViewBox(e.clientX, e.clientY)
    setTf((prev) => ({
      x: pan.tx + (p.x - pan.sx),
      y: pan.ty + (p.y - pan.sy),
      k: prev.k,
    }))
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    panState.current = null
    setPanning(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* 已释放 */ }
  }

  const openDetail = (node: GraphNodeData): void => {
    const q = sessionId !== undefined && sessionId !== '' ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
    void fetch(`/engram-relay/api/node/${encodeURIComponent(node.title)}${q}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((d: NodeDetail) => setDetail(d))
      .catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  // ---- 标签布局（贪心防重叠：重要性优先；缩放足够深才批量显示）----
  const labelPlacements = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>()
    if (tf.k < 0.85) return out
    interface Box { x: number; y: number; w: number; h: number }
    const placed: Box[] = []
    const overlaps = (a: Box, b: Box): boolean =>
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    const sorted = [...nodes].sort((a, b) => b.importance - a.importance)
    for (const n of sorted) {
      const p = layout.get(n.id)
      if (p === undefined) continue
      const r = radiusOf.get(n.id) ?? 12
      const text = n.title.length > 14 ? `${n.title.slice(0, 13)}…` : n.title
      // 10px 字号：中文 ~10px/字，拉丁 ~6px/字，取中间值
      const w = text.length * 7 + 4
      const h = 12
      const box: Box = { x: p.x - w / 2, y: p.y + r + 5, w, h }
      let hit = placed.some((b) => overlaps(box, b))
      if (!hit) {
        // 与其他节点圆相交 → 跳过（圆-矩形相交判定）
        for (const m of nodes) {
          if (m.id === n.id) continue
          const pm = layout.get(m.id)
          if (pm === undefined) continue
          const rm = radiusOf.get(m.id) ?? 12
          const cxp = Math.max(box.x, Math.min(pm.x, box.x + box.w))
          const cyp = Math.max(box.y, Math.min(pm.y, box.y + box.h))
          if ((cxp - pm.x) ** 2 + (cyp - pm.y) ** 2 < rm * rm) { hit = true; break }
        }
      }
      if (!hit) {
        placed.push(box)
        out.set(n.id, { x: box.x, y: box.y })
      }
    }
    return out
  }, [nodes, layout, radiusOf, tf.k])

  const titleOf = (n: GraphNodeData): string =>
    n.title.length > 14 ? `${n.title.slice(0, 13)}…` : n.title

  // 悬停邻接网络：节点/边透明度
  const nodeOpacity = (id: string): number => {
    if (hover === null) return 1
    if (id === hover || neighbors.get(hover)?.has(id) === true) return 1
    return 0.15
  }
  const edgeOpacity = (e: GraphEdgeData): number => {
    const a = layout.get(e.from)
    const b = layout.get(e.to)
    let base = 0.9
    if (a !== undefined && b !== undefined) {
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      base = 0.35 + 0.65 * Math.max(0, Math.min(1, 1 - d / 550))
    }
    if (hover === null) return base
    if (e.from === hover || e.to === hover) return 0.95
    return 0.07
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.filters}>
          {['all', 'global', 'project', 'session'].map((f) => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {t(`graph.filter.${f}`)}
            </button>
          ))}
        </div>
        <div className={styles.meta}>
          <span className={styles.count}>
            {data !== null ? t('graph.count', { nodes: nodes.length, edges: edges.length }) : ''}
          </span>
          <button className={styles.refresh} onClick={loadGraph}>{t('graph.refresh')}</button>
        </div>
      </div>

      {error !== '' && <div className={styles.error}>{error}</div>}

      {loading && <div className={styles.state}>{t('graph.loading')}</div>}

      {!loading && data !== null && nodes.length === 0 && (
        <div className={styles.state}>{t('graph.empty')}</div>
      )}

      {!loading && nodes.length > 0 && (
        <div className={styles.canvas}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className={`${styles.svg} ${panning ? styles.svgPanning : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onDoubleClick={(e) => {
              if ((e.target as Element).closest('[data-node]') === null) refit()
            }}
          >
            <g transform={`translate(${tf.x} ${tf.y}) scale(${tf.k})`}>
              {/* 边（全局坐标，随视图缩放；随距离淡出） */}
              {edges.map((e) => {
                const a = layout.get(e.from)
                const b = layout.get(e.to)
                if (a === undefined || b === undefined) return null
                const style = EDGE_STYLE[e.kind] ?? EDGE_STYLE.link
                return (
                  <line
                    key={`${e.from}|${e.to}|${e.kind}`}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={style.color}
                    strokeWidth={e.kind === 'causes' ? 1.4 : 1}
                    strokeDasharray={style.dash}
                    opacity={edgeOpacity(e)}
                    className={styles.edge}
                  />
                )
              })}
              {/* 节点（本地坐标 + CSS transform 平移 → 过滤切换平滑过渡） */}
              {nodes.map((n) => {
                const p = layout.get(n.id)
                if (p === undefined) return null
                const r = radiusOf.get(n.id) ?? 12
                const color = LAYER_COLORS[n.layer] ?? '#888'
                const selected = detail !== null && detail.id === n.id
                const hovering = hover === n.id
                const label = hovering ? 'always' : labelPlacements.get(n.id) !== undefined ? 'shown' : 'hidden'
                return (
                  <g
                    key={n.id}
                    data-node
                    className={`${styles.node} ${hovering ? styles.nodeHover : ''}`}
                    style={{
                      transform: `translate(${p.x}px, ${p.y}px)`,
                      opacity: nodeOpacity(n.id),
                    }}
                    onClick={() => openDetail(n)}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    role="button"
                    tabIndex={0}
                  >
                    <title>{n.title} — {n.summary}</title>
                    <circle
                      r={selected ? r + 5 : hovering ? r + 2.5 : r}
                      fill={color}
                      fillOpacity={0.9}
                      stroke={selected ? '#fff' : 'rgba(255,255,255,0.4)'}
                      strokeWidth={selected ? 2 : hovering ? 1.6 : 1}
                    />
                    {label !== 'hidden' && (
                      <text
                        y={r + 16}
                        textAnchor="middle"
                        fontSize={10 / tf.k}
                        className={`${styles.nodeLabel} ${hovering ? styles.nodeLabelHover : ''}`}
                      >
                        {titleOf(n)}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>

          <div className={styles.legend}>
            <span><span className={styles.legendLineSolid} />{t('graph.legend.causes')}</span>
            <span><span className={styles.legendLineDash} />{t('graph.legend.link')}</span>
            {(['global', 'project', 'session'] as const).map((layer) => (
              <span key={layer}>
                <span className={styles.legendDot} style={{ background: LAYER_COLORS[layer] }} />
                {t(`graph.layer.${layer}`)}
              </span>
            ))}
          </div>

          <div className={styles.zoomHint}>{t('graph.zoomHint')}</div>
        </div>
      )}

      {/* 详情侧栏（渐进披露第二层） */}
      {detail !== null && (
        <div className={styles.detail}>
          <div className={styles.detailHead}>
            <span className={styles.detailTitle}>
              [[{detail.title}]] ({detail.kind} · {t(`graph.layer.${detail.layer}`)})
            </span>
            <button className={styles.detailClose} onClick={() => setDetail(null)}>{t('graph.detail.close')}</button>
          </div>
          <p className={styles.detailSummary}>{detail.summary}</p>
          {detail.content !== '' && (
            <pre className={styles.detailContent}>{detail.content}</pre>
          )}
          <div className={styles.detailSection}>
            <span className={styles.detailSectionTitle}>{t('graph.detail.causes')}</span>
            {detail.causes.length > 0
              ? detail.causes.map((c) => (
                <button key={c.id} className={styles.detailNode} onClick={() => openDetail(c)}>[[{c.title}]]</button>
              ))
              : <span className={styles.detailNone}>{t('graph.detail.none')}</span>}
          </div>
          <div className={styles.detailSection}>
            <span className={styles.detailSectionTitle}>{t('graph.detail.effects')}</span>
            {detail.effects.length > 0
              ? detail.effects.map((c) => (
                <button key={c.id} className={styles.detailNode} onClick={() => openDetail(c)}>[[{c.title}]]</button>
              ))
              : <span className={styles.detailNone}>{t('graph.detail.none')}</span>}
          </div>
          <div className={styles.detailSection}>
            <span className={styles.detailSectionTitle}>{t('graph.detail.links')}</span>
            {detail.links.length > 0
              ? detail.links.map((c) => (
                <button key={c.id !== '' ? c.id : c.title} className={styles.detailNode} onClick={() => c.id !== '' && openDetail(c)}>
                  [[{c.title}]]
                </button>
              ))
              : <span className={styles.detailNone}>{t('graph.detail.none')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
