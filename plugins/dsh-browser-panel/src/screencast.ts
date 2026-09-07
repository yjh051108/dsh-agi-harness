/**
 * CDP screencast pump: streams JPEG frames from the browser's page to a
 * per-session frame cache the panel polls over HTTP. Frames are human-visible
 * only — they never enter model context.
 *
 * Headless Chromium only serves screencast frames for the foreground target,
 * so exactly one subscription is active at a time: tab switches stop the old
 * page's screencast and start the new active page's (via the session's
 * per-page CDP session cache). `bringToFront` in the session keeps the newly
 * active page compositing so frames flow again.
 * @module @dsh-external/dsh-browser-panel/screencast
 */

import type { CDPSession } from 'playwright-core'
import type { BrowserSession } from './browser.ts'

/** Retains the latest screencast frame per session. */
export class FrameCache {
  private readonly frames = new Map<string, string>()

  /** Store the latest frame for `sessionId`. */
  set(sessionId: string, jpegBase64: string): void {
    this.frames.set(sessionId, jpegBase64)
  }

  /** The latest frame for `sessionId`, if any. */
  get(sessionId: string): string | undefined {
    return this.frames.get(sessionId)
  }

  /** Drop a session's frame when its browser closes. */
  drop(sessionId: string): void {
    this.frames.delete(sessionId)
  }
}

/** Options for one screencast pump. */
export interface ScreencastOptions {
  /** Target frame rate (CDP `everyNthFrame`), default 4. */
  readonly fps: number
  /** JPEG quality 0-100, default 70. */
  readonly quality: number
}

/** One active CDP screencast subscription feeding a {@link FrameCache}. */
export class ScreencastPump {
  private cdp: CDPSession | undefined
  private handler: ((payload: { data: string; sessionId: number }) => void) | undefined
  private started = false
  private unlisten: (() => void) | undefined
  private restarting = false
  /** Last frame written to the cache; duplicate CDP frames are skipped. */
  private lastFrame: string | undefined
  /** Frame from the previously active page; dropped after a tab switch. */
  private staleFrame: string | undefined

  /**
   * @param session - the browser session to pump frames from.
   * @param cache - shared frame cache to write into.
   * @param sessionId - cache key for this session.
   * @param options - frame budget.
   */
  constructor(
    private readonly session: BrowserSession,
    private readonly cache: FrameCache,
    private readonly sessionId: string,
    private readonly options: ScreencastOptions,
  ) {}

  /**
   * Begin pumping frames. Idempotent; no-op while already started. Subscribes
   * to session tab changes so the CDP subscription follows the active tab:
   * switching tabs rebuilds the screencast on the newly active page.
   */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.attach()
    this.unlisten = this.session.onTabChange(() => {
      void this.restart().catch(() => {})
    })
  }

  /** Stop pumping frames. Idempotent. */
  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.unlisten?.()
    this.unlisten = undefined
    await this.detach()
  }

  /**
   * Re-create the CDP subscription on the currently active page. The new
   * subscription may emit a stale frame from the previous page before the new
   * target starts compositing; such frames are dropped, and a forced screenshot
   * is taken so the panel always shows the active tab.
   */
  private async restart(): Promise<void> {
    if (this.restarting || !this.started) return
    this.restarting = true
    try {
      this.staleFrame = this.lastFrame
      await this.detach()
      await this.attach()
      await this.capture()
    } finally {
      this.restarting = false
    }
  }

  /** Attach the screencast subscription to the active page. */
  private async attach(): Promise<void> {
    const page = this.session.page
    if (page === undefined) return
    const cdp = await this.session.cdpSessionFor(page)
    this.cdp = cdp
    const handler = ({ data, sessionId }: { data: string; sessionId: number }): void => {
      // Drop frames identical to what we already published, plus any residue
      // from the previously active page after a tab switch.
      if (data !== this.lastFrame && data !== this.staleFrame) {
        this.lastFrame = data
        this.staleFrame = undefined
        this.cache.set(this.sessionId, data)
      }
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    }
    this.handler = handler
    cdp.on('Page.screencastFrame', handler)
    await cdp.send('Page.enable')
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: this.options.quality,
      everyNthFrame: this.options.fps >= 4 ? 1 : 2,
      maxWidth: 960,
      maxHeight: 600,
    })
  }

  /** Capture one fresh JPEG of the active page into the cache. Best-effort. */
  private async capture(): Promise<void> {
    const page = this.session.page
    if (page === undefined) return
    try {
      const shot = await page.screenshot({
        type: 'jpeg',
        quality: this.options.quality,
      })
      const b64 = shot.toString('base64')
      this.lastFrame = b64
      this.cache.set(this.sessionId, b64)
    } catch {
      // The page may be mid-navigation; the screencast feed covers it.
    }
  }

  /** Tear down the current CDP screencast subscription, if any. */
  private async detach(): Promise<void> {
    const cdp = this.cdp
    this.cdp = undefined
    if (cdp !== undefined) {
      const handler = this.handler
      this.handler = undefined
      if (handler !== undefined) cdp.off('Page.screencastFrame', handler)
      await cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}
