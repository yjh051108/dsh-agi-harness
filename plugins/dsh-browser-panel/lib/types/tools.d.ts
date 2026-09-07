/**
 * Model-facing browser tools over the per-session headed browser. The whole
 * surface is text-only by design (DeepSeek models have no vision):
 * `browser_snapshot` renders the page as structured text with a numbered
 * interactive inventory, and every other tool addresses elements by that
 * inventory's index. Screenshots never enter model context.
 *
 * The tool contracts below are self-declared minimal interfaces (this plugin
 * is a standalone repo with no SDK dependency; the host Harness provides the
 * real services at runtime).
 * @module @dsh-external/dsh-browser-panel/tools
 */
import { BrowserSession } from './browser.ts';
import { type VisionOptions } from './vision.ts';
/** Minimal tool contract the host `tools` registry provides (subset). */
export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: {
        schema: Record<string, unknown>;
        render(args: Record<string, unknown>, value: unknown): unknown;
    };
    execute(args: Record<string, unknown>, exec: ToolExecution): Promise<unknown>;
}
/** Minimal execution context the tool registry supplies. */
export interface ToolExecution {
    readonly signal: AbortSignal;
    readonly agent?: {
        readonly sessionId?: string;
    };
}
/** Minimal Cordis context carrying the tools service. */
export interface ToolsContext {
    tools: {
        register(tool: ToolDefinition): () => void;
    };
}
/** Per-session browser ownership: one BrowserSession per owner session id. */
export declare class BrowserSessionRegistry {
    private readonly sessions;
    /** The browser owned by `sessionId`, creating it on first use. */
    get(sessionId: string): BrowserSession;
    /** Number of sessions whose browser is currently open. */
    openCount(): number;
    /** Close every session idle longer than `idleMs`; returns how many closed. */
    closeIdle(idleMs: number): Promise<number>;
    /** Close and forget every owned session. */
    dispose(): Promise<void>;
}
/** Budgets resolved from plugin config before tool registration. */
export interface BrowserToolsOptions {
    readonly toolTimeoutMs: number;
    readonly snapshotMaxChars: number;
    readonly maxInteractiveItems: number;
    /** Optional vision bridge; enables `browser_vision` when set. */
    readonly vision?: VisionOptions;
}
/**
 * Register the browser tools on `ctx.tools`, all backed by one registry.
 * @param ctx - Cordis context with the tools service.
 * @param registry - the shared per-session browser registry.
 * @param options - resolved tool budgets.
 */
export declare function registerBrowserTools(ctx: ToolsContext, registry: BrowserSessionRegistry, options: BrowserToolsOptions): void;
