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
import { type CDPSession, type Page } from 'playwright-core';
/** One console message captured from a page. */
export interface ConsoleEntry {
    readonly type: 'log' | 'error' | 'warn' | 'info' | 'debug';
    readonly text: string;
    readonly url: string;
    readonly ts: number;
}
/** One dialog currently pending on a page. */
export interface DialogEntry {
    readonly id: number;
    readonly type: string;
    readonly message: string;
    readonly ts: number;
}
/** One download initiated from a page. */
export interface DownloadEntry {
    readonly id: number;
    readonly filename: string;
    readonly path?: string;
    readonly ts: number;
}
/** One owned browser instance. Not thread-safe; owner serializes calls. */
export declare class BrowserSession {
    private browser;
    private context;
    private readonly cdpByPage;
    private pages;
    private activeIndex;
    private readonly tabListeners;
    private readonly consoleBuffer;
    private readonly dialogs;
    private readonly downloads;
    private dialogSeq;
    private downloadSeq;
    private lastActive;
    /**
     * Subscribe to tab changes (open/new/switch/close). Used by the screencast
     * pump to re-attach CDP frames to the newly active tab.
     * @param listener - called synchronously after a tab transition.
     * @returns unsubscribe function.
     */
    onTabChange(listener: () => void): () => void;
    private notifyTabChange;
    /** Mark this session as recently used (called on every tool touch). */
    touch(): void;
    /** Milliseconds since the last tool touch; 0 if never touched. */
    idleMs(): number;
    /** Whether an underlying browser is currently alive. */
    get isOpen(): boolean;
    /** The active tab, when open. */
    get page(): Page | undefined;
    /** Current active-tab URL, when a page exists. */
    get url(): string | undefined;
    /** Current active-tab title, when a page exists and is readable. */
    title(): Promise<string | undefined>;
    /** Ordered tab list for the panel and the `browser_tabs` tool. */
    get tabs(): ReadonlyArray<{
        readonly index: number;
        readonly url: string;
        readonly active: boolean;
    }>;
    /** Recent console messages across all tabs (most recent first). */
    get consoleLog(): ReadonlyArray<ConsoleEntry>;
    /** Pending page dialogs awaiting a model decision. */
    get pendingDialogs(): ReadonlyArray<DialogEntry>;
    /** Downloads captured from pages (most recent first). */
    get downloadList(): ReadonlyArray<DownloadEntry>;
    /** Clear the captured console buffer. */
    clearConsole(): void;
    /** Respond to a pending dialog: accept with optional text, or dismiss. */
    respondDialog(id: number, accept: boolean, text?: string): Promise<void>;
    /**
     * Launch the browser and open a fresh page. Idempotent. When `profileDir`
     * is set, the context is persistent (cookies/site storage survive restarts).
     * @param profileDir - absolute directory for the persistent user data, or
     * undefined for an ephemeral context.
     */
    open(profileDir?: string): Promise<void>;
    /**
     * Navigate the active page to an absolute http(s) URL and wait for load.
     * @param url - absolute http(s) URL.
     */
    navigate(url: string): Promise<void>;
    /** Open a new tab and activate it. */
    newTab(): Promise<void>;
    /**
     * Activate the tab at `index`. Brings the underlying page to the front so
     * Chromium keeps rendering/compositing it (headless screencast only emits
     * frames for the foreground target).
     * @param index - 0-based tab index.
     */
    switchTab(index: number): Promise<void>;
    /** Close the tab at `index`; keeps at least one tab. */
    closeTab(index: number): Promise<void>;
    /**
     * The CDP session for `page`, created on first use and cached per page.
     * Each tab keeps its own session so screencast subscriptions stay alive
     * across tab switches (stopping and restarting screencasts across pages is
     * unreliable in headless Chromium).
     */
    cdpSessionFor(page: Page): Promise<CDPSession>;
    /** Close the browser and drop all state. Idempotent. */
    close(): Promise<void>;
    private ensureContext;
    private ensurePage;
    /** Cap the console buffer to keep memory bounded. */
    private static readonly CONSOLE_CAP;
    /** Attach page event listeners (console / dialogs / downloads) once per tab. */
    private wirePage;
}
/** Default persistent profile root shared across sessions. */
export declare const PROFILE_ROOT: string;
