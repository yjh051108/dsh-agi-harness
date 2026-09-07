/**
 * Optional vision bridge: describe a live browser frame through an
 * OpenAI-compatible vision-language model (VLM). Purely opt-in — enabled only
 * when the plugin config provides a `vision` endpoint. The model remains
 * text-only by default; this tool is the explicit escape hatch the North Star
 * calls "optional VLM bridge" (screenshots selectively enter model context).
 *
 * Zero SDK dependency: speaks the standard Chat Completions wire format over
 * the built-in `fetch`.
 * @module @dsh-external/dsh-browser-panel/vision
 */
import type { Page } from 'playwright-core';
/** Vision endpoint config. */
export interface VisionOptions {
    /** Base URL of an OpenAI-compatible chat completions endpoint. */
    readonly endpoint: string;
    /** Bearer token; optional for local endpoints. */
    readonly apiKey?: string;
    /** Model name, e.g. "glm-4v-flash". */
    readonly model: string;
}
/**
 * Capture the page as JPEG and ask the VLM to describe it.
 * @param page - the Playwright page to capture.
 * @param options - vision endpoint config.
 * @param prompt - instruction for the VLM.
 * @returns the model's text response.
 */
export declare function describeFrame(page: Page, options: VisionOptions, prompt: string): Promise<string>;
