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
import type { IncomingMessage, ServerResponse } from 'node:http';
import z from 'schemastery';
import { type ToolsContext } from './tools.ts';
import type { VisionOptions } from './vision.ts';
/** Minimal Cordis context carrying the host services this plugin needs. */
interface HostContext extends ToolsContext {
    webServer: {
        register(route: {
            kind: 'exact';
            path: string;
            handler(req: IncomingMessage, res: ServerResponse): Promise<void>;
        }): () => void;
    };
    effect(callback: () => (() => void), label?: string): void;
}
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "browser-panel";
/** Services required by this plugin. */
export declare const inject: string[];
/** Plugin config: tool budgets plus panel frame quality. */
export interface Config {
    /** Per-tool-call budget (ms). */
    toolTimeoutMs?: number;
    /** Upper bound on one snapshot's rendered characters. */
    snapshotMaxChars?: number;
    /** Upper bound on interactive inventory items per snapshot. */
    maxInteractiveItems?: number;
    /** Screencast target frame rate. */
    screencastFps?: number;
    /** Screencast JPEG quality 0-100. */
    screencastQuality?: number;
    /** Close a session's browser after this many ms of tool inactivity; 0 disables. */
    idleTimeoutMs?: number;
    /** Optional vision bridge (OpenAI-compatible VLM); enables `browser_vision`. */
    vision?: VisionOptions;
}
export declare const Config: z<Config>;
/** Register the host half: tools, state/frame routes, and teardown. */
export declare function apply(ctx: HostContext, config: Config): void;
export {};
