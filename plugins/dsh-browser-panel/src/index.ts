/**
 * `@dsh-external/dsh-browser-panel`: WebUI-embedded headed browser for the
 * model and the user. The host half owns one Playwright Chromium per owner
 * session, registers the text-only `browser_*` tool set (non-multimodal
 * control: numbered accessibility-style snapshots, index addressing, atomic
 * actions), and serves a per-session JPEG frame cache the client panel polls
 * for the live view. Screenshots are human-visible only and never enter model
 * context.
 *
 * Standalone repo convention: no SDK dependency; the minimal service
 * interfaces below are supplied by the host Harness at runtime.
 * @module @dsh-external/dsh-browser-panel
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import z from 'schemastery'
import { join } from 'node:path'
import { BrowserSessionRegistry, registerBrowserTools, type ToolsContext } from './tools.ts'
import { FrameCache, ScreencastPump } from './screencast.ts'
import { extractCss, pickElement, renderCssBlock } from './pick.ts'
import { PANEL_ROUTE, PANEL_STREAM_PATH } from './protocol.ts'
import { PROFILE_ROOT } from './browser.ts'
import type { VisionOptions } from './vision.ts'

/** Persistent profile dir for a host-opened session. */
function profileDirForHost(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(PROFILE_ROOT, safe)
}

/** Minimal Cordis context carrying the host services this plugin needs. */
interface HostContext extends ToolsContext {
  webServer: {
    register(route: {
      kind: 'exact'
      path: string
      handler(req: IncomingMessage, res: ServerResponse): Promise<void>
    }): () => void
  }
  effect(callback: () => (() => void), label?: string): void
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'browser-panel'

/** Services required by this plugin. */
export const inject = ['webServer', 'tools']

/** Plugin config: tool budgets plus panel frame quality. */
export interface Config {
  /** Per-tool-call budget (ms). */
  toolTimeoutMs?: number
  /** Upper bound on one snapshot's rendered characters. */
  snapshotMaxChars?: number
  /** Upper bound on interactive inventory items per snapshot. */
  maxInteractiveItems?: number
  /** Screencast target frame rate. */
  screencastFps?: number
  /** Screencast JPEG quality 0-100. */
  screencastQuality?: number
  /** Close a session's browser after this many ms of tool inactivity; 0 disables. */
  idleTimeoutMs?: number
  /** Optional vision bridge (OpenAI-compatible VLM); enables `browser_vision`. */
  vision?: VisionOptions
}

export const Config: z<Config> = z.object({
  toolTimeoutMs: z.number().default(60_000),
  snapshotMaxChars: z.number().default(12_000),
  maxInteractiveItems: z.number().default(60),
  screencastFps: z.number().default(4),
  screencastQuality: z.number().default(70),
  idleTimeoutMs: z.number().default(0),
  vision: z.object({
    endpoint: z.string(),
    apiKey: z.string(),
    model: z.string(),
  }),
})

/** Resolved config shape after schemastery defaults. */
type ResolvedConfig = Required<Config>

/** Parse the `session` query parameter; empty when absent. */
function sessionParam(url: string | undefined): string {
  if (url === undefined) return ''
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  for (const pair of query.split('&')) {
    const [key, value] = pair.split('=')
    if (key === 'session') return decodeURIComponent(value ?? '')
  }
  return ''
}

/** Parse a normalized 0..1 coordinate query parameter; NaN when absent. */
function ratioParam(url: string | undefined, key: string): number {
  if (url === undefined) return Number.NaN
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  for (const pair of query.split('&')) {
    const [name, value] = pair.split('=')
    if (name === key) return Number(decodeURIComponent(value ?? ''))
  }
  return Number.NaN
}

/** Register the host half: tools, state/frame routes, and teardown. */
export function apply(ctx: HostContext, config: Config): void {
  const resolved = config as ResolvedConfig
  const registry = new BrowserSessionRegistry()
  const cache = new FrameCache()
  const pumps = new Map<string, ScreencastPump>()

  /** Start the frame pump for a session once its browser exists; no-op otherwise. */
  const ensurePump = async (sessionId: string): Promise<void> => {
    if (pumps.has(sessionId)) return
    const session = registry.get(sessionId)
    if (!session.isOpen) return
    const pump = new ScreencastPump(session, cache, sessionId, {
      fps: resolved.screencastFps,
      quality: resolved.screencastQuality,
    })
    pumps.set(sessionId, pump)
    await pump.start().catch(() => pumps.delete(sessionId))
  }

  registerBrowserTools(ctx, registry, {
    toolTimeoutMs: resolved.toolTimeoutMs,
    snapshotMaxChars: resolved.snapshotMaxChars,
    maxInteractiveItems: resolved.maxInteractiveItems,
    vision: resolved.vision,
  })

  /** 路由注册挂 effect：热重载/卸载时自动注销（否则旧 fiber 路由残留导致 duplicate route）。 */
  const registerRoute = (route: Parameters<HostContext['webServer']['register']>[0]): void => {
    ctx.effect(() => ctx.webServer.register(route), 'browser-panel:route')
  }

  registerRoute({
    kind: 'exact',
    path: PANEL_ROUTE,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const sessionId = sessionParam(req.url)
      const session = registry.get(sessionId)
      const payload = JSON.stringify({
        sessionId,
        open: session.isOpen,
        url: session.url,
        title: session.isOpen ? await session.title() : undefined,
        tabs: session.isOpen ? session.tabs : [],
        dialogs: session.pendingDialogs.length,
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(payload)
    },
  })

  registerRoute({
    kind: 'exact',
    path: PANEL_STREAM_PATH,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const sessionId = sessionParam(req.url)
      await ensurePump(sessionId)
      const frame = cache.get(sessionId)
      if (frame === undefined) {
        res.writeHead(204)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
      res.end(Buffer.from(frame, 'base64'))
    },
  })

  /** Shared handler for pick/css: resolve the session, then run the page script. */
  const coordinateHandler = async (req: IncomingMessage, res: ServerResponse, kind: 'pick' | 'css'): Promise<void> => {
    const sessionId = sessionParam(req.url)
    const xRatio = ratioParam(req.url, 'x')
    const yRatio = ratioParam(req.url, 'y')
    if (sessionId === '' || !Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'session, x, and y query parameters are required' }))
      return
    }
    const session = registry.get(sessionId)
    if (!session.isOpen || session.page === undefined) {
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'browser not open' }))
      return
    }
    const result = kind === 'pick'
      ? await pickElement(session.page, xRatio, yRatio)
      : await extractCss(session.page, xRatio, yRatio)
    if (result === null) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'no element at coordinates' }))
      return
    }
    const payload = kind === 'css'
      ? { ...result, block: renderCssBlock(result as Awaited<ReturnType<typeof extractCss>> & object) }
      : result
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }

  registerRoute({
    kind: 'exact',
    path: `${PANEL_ROUTE}/tab`,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const sessionId = sessionParam(req.url)
      const rawAction = (() => {
        if (req.url === undefined) return ''
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : ''
        for (const pair of query.split('&')) {
          const [key, value] = pair.split('=')
          if (key === 'action') return decodeURIComponent(value ?? '')
        }
        return ''
      })()
      if (sessionId === '' || !['new', 'refresh', 'close', 'switch'].includes(rawAction)) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'session and action (new|refresh|close|switch) query parameters are required' }))
        return
      }
      const session = registry.get(sessionId)
      if (!session.isOpen || session.page === undefined) {
        res.writeHead(409, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'browser not open' }))
        return
      }
      const rawIndex = Number(ratioParam(req.url, 'index'))
      try {
        if (rawAction === 'new') {
          await session.newTab()
        } else if (rawAction === 'refresh') {
          await session.page.reload({ waitUntil: 'load', timeout: 30_000 })
        } else if (rawAction === 'switch') {
          const index = Number.isFinite(rawIndex) ? Math.round(rawIndex) : session.tabs.findIndex(tab => tab.active)
          await session.switchTab(index)
        } else {
          const count = session.tabs.length
          const index = Number.isFinite(rawIndex) ? Math.round(rawIndex) : session.tabs.findIndex(tab => tab.active)
          if (count > 1) await session.closeTab(index >= 0 && index < count ? index : session.tabs.findIndex(tab => tab.active))
        }
        session.touch()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, tabs: session.tabs }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'tab action failed' }))
      }
    },
  })

  registerRoute({
    kind: 'exact',
    path: `${PANEL_ROUTE}/pick`,
    handler(req, res) {
      return coordinateHandler(req, res, 'pick')
    },
  })

  registerRoute({
    kind: 'exact',
    path: `${PANEL_ROUTE}/css`,
    handler(req, res) {
      return coordinateHandler(req, res, 'css')
    },
  })

  registerRoute({
    kind: 'exact',
    path: `${PANEL_ROUTE}/open`,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const sessionId = sessionParam(req.url)
      if (sessionId === '') {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'session query parameter is required' }))
        return
      }
      const session = registry.get(sessionId)
      if (!session.isOpen) {
        await session.open(profileDirForHost(sessionId)).catch((error: unknown) => {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'failed to open browser' }))
          return
        })
      }
      session.touch()
      await ensurePump(sessionId)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, open: session.isOpen }))
    },
  })

  registerRoute({
    kind: 'exact',
    path: `${PANEL_ROUTE}/close`,
    async handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const sessionId = sessionParam(req.url)
      const session = registry.get(sessionId)
      const pump = pumps.get(sessionId)
      if (pump !== undefined) {
        await pump.stop()
        pumps.delete(sessionId)
      }
      cache.drop(sessionId)
      await session.close()
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, open: session.isOpen }))
    },
  })

  // 空闲回收：定期关闭超时未活动的浏览器，防止资源泄漏（默认关闭）。
  let idleTimer: NodeJS.Timeout | undefined
  if (resolved.idleTimeoutMs > 0) {
    idleTimer = setInterval(() => {
      void registry.closeIdle(resolved.idleTimeoutMs).then((closed) => {
        if (closed > 0) {
          for (const pump of pumps.values()) void pump.stop()
          pumps.clear()
        }
      })
    }, Math.min(resolved.idleTimeoutMs, 60_000))
  }

  ctx.effect(() => {
    const cleanup = (): void => {
      if (idleTimer !== undefined) clearInterval(idleTimer)
      for (const pump of pumps.values()) void pump.stop()
      pumps.clear()
      void registry.dispose()
    }
    return cleanup
  }, 'browser-panel.dispose')
}
