/**
 * Per-session headed-browser lifecycle: one persistent Playwright Chromium
 * context per owner session, created lazily on first use and destroyed with
 * its owner. The browser runs headless with a CDP screencast feed for the
 * panel; "headed" refers to the live visible page in the WebUI, not an OS
 * window.
 *
 * Login persistence: when a profile directory is configured, the context is
 * launched persistent (user data dir under `~/.dsh/browser-panel/profiles/`),
 * so cookies and site storage survive dsh restarts for the same session.
 *
 * Tabs: the session owns a tab list; exactly one tab is active at a time and
 * the CDP screencast always feeds the active tab.
 * @module @dsh-external/dsh-browser-panel/browser
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { chromium, type Browser, type BrowserContext, type CDPSession, type ConsoleMessage, type Dialog, type Download, type Page } from 'playwright-core'

/** One console message captured from a page. */
export interface ConsoleEntry {
  readonly type: 'log' | 'error' | 'warn' | 'info' | 'debug'
  readonly text: string
  readonly url: string
  readonly ts: number
}

/** One dialog currently pending on a page. */
export interface DialogEntry {
  readonly id: number
  readonly type: string
  readonly message: string
  readonly ts: number
}

/** One download initiated from a page. */
export interface DownloadEntry {
  readonly id: number
  readonly filename: string
  readonly path?: string
  readonly ts: number
}

/** One owned browser instance. Not thread-safe; owner serializes calls. */
export class BrowserSession {
  private browser: Browser | undefined
  private context: BrowserContext | undefined
  private readonly cdpByPage = new Map<Page, CDPSession>()
  private pages: Page[] = []
  private activeIndex = 0
  private readonly tabListeners = new Set<() => void>()
  private readonly consoleBuffer: ConsoleEntry[] = []
  private readonly dialogs = new Map<number, Dialog>()
  private readonly downloads: DownloadEntry[] = []
  private dialogSeq = 0
  private downloadSeq = 0
  private lastActive = 0

  /**
   * Subscribe to tab changes (open/new/switch/close). Used by the screencast
   * pump to re-attach CDP frames to the newly active tab.
   * @param listener - called synchronously after a tab transition.
   * @returns unsubscribe function.
   */
  onTabChange(listener: () => void): () => void {
    this.tabListeners.add(listener)
    return () => { this.tabListeners.delete(listener) }
  }

  private notifyTabChange(): void {
    for (const listener of this.tabListeners) listener()
  }

  /** Mark this session as recently used (called on every tool touch). */
  touch(): void {
    this.lastActive = Date.now()
  }

  /** Milliseconds since the last tool touch; 0 if never touched. */
  idleMs(): number {
    if (this.lastActive === 0) return 0
    return Date.now() - this.lastActive
  }

  /** Whether an underlying browser is currently alive. */
  get isOpen(): boolean {
    return this.browser !== undefined && this.browser.isConnected()
  }

  /** The active tab, when open. */
  get page(): Page | undefined {
    return this.pages[this.activeIndex]
  }

  /** Current active-tab URL, when a page exists. */
  get url(): string | undefined {
    return this.page?.url()
  }

  /** Current active-tab title, when a page exists and is readable. */
  async title(): Promise<string | undefined> {
    if (this.page === undefined) return undefined
    return await this.page.title().catch(() => '')
  }

  /** Ordered tab list for the panel and the `browser_tabs` tool. */
  get tabs(): ReadonlyArray<{ readonly index: number; readonly url: string; readonly active: boolean }> {
    return this.pages.map((page, index) => ({ index, url: page.url(), active: index === this.activeIndex }))
  }

  /** Recent console messages across all tabs (most recent first). */
  get consoleLog(): ReadonlyArray<ConsoleEntry> {
    return this.consoleBuffer
  }

  /** Pending page dialogs awaiting a model decision. */
  get pendingDialogs(): ReadonlyArray<DialogEntry> {
    return [...this.dialogs.entries()].map(([id, dialog]) => ({
      id,
      type: dialog.type(),
      message: dialog.message(),
      ts: Date.now(),
    }))
  }

  /** Downloads captured from pages (most recent first). */
  get downloadList(): ReadonlyArray<DownloadEntry> {
    return [...this.downloads].reverse()
  }

  /** Clear the captured console buffer. */
  clearConsole(): void {
    this.consoleBuffer.length = 0
  }

  /** Respond to a pending dialog: accept with optional text, or dismiss. */
  async respondDialog(id: number, accept: boolean, text?: string): Promise<void> {
    const dialog = this.dialogs.get(id)
    if (dialog === undefined) throw new Error(`dialog ${id} not pending`)
    this.dialogs.delete(id)
    if (accept) {
      await dialog.accept(text).catch(() => {})
    } else {
      await dialog.dismiss().catch(() => {})
    }
  }

  /**
   * Launch the browser and open a fresh page. Idempotent. When `profileDir`
   * is set, the context is persistent (cookies/site storage survive restarts).
   * @param profileDir - absolute directory for the persistent user data, or
   * undefined for an ephemeral context.
   */
  async open(profileDir?: string): Promise<void> {
    if (this.isOpen) return
    // 绕过一切代理：chromium 在 Windows 会继承系统代理（注册表，如 127.0.0.1:7892），
    // 本机代理常未运行 → ERR_PROXY_CONNECTION_FAILED。实测 --no-proxy-server 无效
    // （系统代理仍被继承），必须用 --proxy-server=direct:// 显式覆盖为直连。
    const noProxyArgs = ['--proxy-server=direct://']
    const cleanEnv: Record<string, string> = {}
    for (const [key, value] of Object.entries(process.env)) {
      if (/^(http|https|all|no)_proxy$/i.test(key)) continue
      if (value !== undefined) cleanEnv[key] = value
    }
    if (profileDir !== undefined) {
      await mkdir(profileDir, { recursive: true })
      this.context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: noProxyArgs,
        env: cleanEnv,
      })
      // persistent 模式必须记录 browser：isOpen 依赖它，否则每次工具调用都
      // 视为未打开而重复 launch（浏览器进程泄漏 + 跨调用状态丢失）。
      this.browser = this.context.browser() ?? undefined
      this.pages = this.context.pages()
      this.activeIndex = 0
    } else {
      this.browser = await chromium.launch({ headless: true, args: noProxyArgs, env: cleanEnv })
      this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true })
      this.pages = [await this.context.newPage()]
      this.activeIndex = 0
    }
    for (const page of this.pages) this.wirePage(page)
    this.notifyTabChange()
  }

  /**
   * Navigate the active page to an absolute http(s) URL and wait for load.
   * @param url - absolute http(s) URL.
   */
  async navigate(url: string): Promise<void> {
    await this.ensurePage()
    await this.page!.goto(url, { waitUntil: 'load', timeout: 30_000 })
  }

  /** Open a new tab and activate it. */
  async newTab(): Promise<void> {
    await this.ensureContext()
    const page = await this.context!.newPage()
    this.wirePage(page)
    this.pages.push(page)
    this.activeIndex = this.pages.length - 1
    await page.bringToFront().catch(() => {})
    this.notifyTabChange()
  }

  /**
   * Activate the tab at `index`. Brings the underlying page to the front so
   * Chromium keeps rendering/compositing it (headless screencast only emits
   * frames for the foreground target).
   * @param index - 0-based tab index.
   */
  async switchTab(index: number): Promise<void> {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`tab index ${index} out of range (${this.pages.length} tabs)`)
    }
    this.activeIndex = index
    await this.page?.bringToFront().catch(() => {})
    this.notifyTabChange()
  }

  /** Close the tab at `index`; keeps at least one tab. */
  async closeTab(index: number): Promise<void> {
    if (this.pages.length <= 1) throw new Error('cannot close the last tab')
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`tab index ${index} out of range (${this.pages.length} tabs)`)
    }
    const closing = this.pages[index]!
    this.cdpByPage.delete(closing)
    await closing.close().catch(() => {})
    this.pages.splice(index, 1)
    if (this.activeIndex >= this.pages.length) this.activeIndex = this.pages.length - 1
    this.notifyTabChange()
  }

  /**
   * The CDP session for `page`, created on first use and cached per page.
   * Each tab keeps its own session so screencast subscriptions stay alive
   * across tab switches (stopping and restarting screencasts across pages is
   * unreliable in headless Chromium).
   */
  async cdpSessionFor(page: Page): Promise<CDPSession> {
    const cached = this.cdpByPage.get(page)
    if (cached !== undefined) return cached
    await this.ensureContext()
    const cdp = await this.context!.newCDPSession(page)
    this.cdpByPage.set(page, cdp)
    return cdp
  }

  /** Close the browser and drop all state. Idempotent. */
  async close(): Promise<void> {
    const closingBrowser = this.browser
    const closingContext = this.context
    this.cdpByPage.clear()
    this.pages = []
    this.activeIndex = 0
    this.browser = undefined
    this.context = undefined
    this.dialogs.clear()
    if (closingBrowser !== undefined) {
      await closingBrowser.close().catch(() => {})
    } else if (closingContext !== undefined) {
      await closingContext.close().catch(() => {})
    }
  }

  private async ensureContext(): Promise<void> {
    if (this.context === undefined) await this.open()
  }

  private async ensurePage(): Promise<void> {
    await this.ensureContext()
    if (this.page === undefined) throw new Error('browser page unavailable')
  }

  /** Cap the console buffer to keep memory bounded. */
  private static readonly CONSOLE_CAP = 200

  /** Attach page event listeners (console / dialogs / downloads) once per tab. */
  private wirePage(page: Page): void {
    page.on('console', (message: ConsoleMessage) => {
      const text = message.text()
      if (text === '') return
      const type = message.type()
      const entry: ConsoleEntry = {
        type: type === 'error' || type === 'info' || type === 'debug' ? type : (type === 'warning' ? 'warn' : 'log'),
        text: text.slice(0, 1000),
        url: page.url(),
        ts: Date.now(),
      }
      this.consoleBuffer.push(entry)
      if (this.consoleBuffer.length > BrowserSession.CONSOLE_CAP) this.consoleBuffer.splice(0, this.consoleBuffer.length - BrowserSession.CONSOLE_CAP)
    })
    page.on('dialog', (dialog: Dialog) => {
      this.dialogs.set(++this.dialogSeq, dialog)
    })
    page.on('download', (download: Download) => {
      const id = ++this.downloadSeq
      const filename = download.suggestedFilename()
      void download.path()
        .then((path) => {
          this.downloads.push({ id, filename, path: path ?? undefined, ts: Date.now() })
        })
        .catch(() => {
          this.downloads.push({ id, filename, ts: Date.now() })
        })
    })
  }
}

/** Default persistent profile root shared across sessions. */
export const PROFILE_ROOT = join(homedir(), '.dsh', 'browser-panel', 'profiles')
