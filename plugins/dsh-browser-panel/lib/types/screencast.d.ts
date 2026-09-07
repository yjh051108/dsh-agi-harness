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
import type { BrowserSession } from './browser.ts';
/** Retains the latest screencast frame per session. */
export declare class FrameCache {
    private readonly frames;
    /** Store the latest frame for `sessionId`. */
    set(sessionId: string, jpegBase64: string): void;
    /** The latest frame for `sessionId`, if any. */
    get(sessionId: string): string | undefined;
    /** Drop a session's frame when its browser closes. */
    drop(sessionId: string): void;
}
/** Options for one screencast pump. */
export interface ScreencastOptions {
    /** Target frame rate (CDP `everyNthFrame`), default 4. */
    readonly fps: number;
    /** JPEG quality 0-100, default 70. */
    readonly quality: number;
}
/** One active CDP screencast subscription feeding a {@link FrameCache}. */
export declare class ScreencastPump {
    private readonly session;
    private readonly cache;
    private readonly sessionId;
    private readonly options;
    private cdp;
    private handler;
    private started;
    private unlisten;
    private restarting;
    /** Last frame written to the cache; duplicate CDP frames are skipped. */
    private lastFrame;
    /** Frame from the previously active page; dropped after a tab switch. */
    private staleFrame;
    /**
     * @param session - the browser session to pump frames from.
     * @param cache - shared frame cache to write into.
     * @param sessionId - cache key for this session.
     * @param options - frame budget.
     */
    constructor(session: BrowserSession, cache: FrameCache, sessionId: string, options: ScreencastOptions);
    /**
     * Begin pumping frames. Idempotent; no-op while already started. Subscribes
     * to session tab changes so the CDP subscription follows the active tab:
     * switching tabs rebuilds the screencast on the newly active page.
     */
    start(): Promise<void>;
    /** Stop pumping frames. Idempotent. */
    stop(): Promise<void>;
    /**
     * Re-create the CDP subscription on the currently active page. The new
     * subscription may emit a stale frame from the previous page before the new
     * target starts compositing; such frames are dropped, and a forced screenshot
     * is taken so the panel always shows the active tab.
     */
    private restart;
    /** Attach the screencast subscription to the active page. */
    private attach;
    /** Capture one fresh JPEG of the active page into the cache. Best-effort. */
    private capture;
    /** Tear down the current CDP screencast subscription, if any. */
    private detach;
}
