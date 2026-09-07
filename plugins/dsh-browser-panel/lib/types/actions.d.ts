/**
 * Atomic page actions: execute a model-chosen primitive against an element
 * addressed by snapshot index. Indexes are re-issued by every snapshot; a
 * stale index fails with the current snapshot so the model retries from
 * evidence instead of guessing.
 * @module @dsh-external/dsh-browser-panel/actions
 */
import type { Page } from 'playwright-core';
/** Failure carrying the fresh snapshot so callers can retry from evidence. */
export declare class StaleIndexError extends Error {
    readonly snapshotText: string;
    constructor(snapshotText: string);
}
/** Click the element at `index`. */
export declare function click(page: Page, index: number, maxItems: number): Promise<void>;
/**
 * Fill the element at `index` with text. `replace: true` clears first; false
 * appends, which works for both controlled (React/Vue) and plain inputs.
 */
export declare function typeText(page: Page, index: number, text: string, replace: boolean, maxItems: number): Promise<void>;
/** Press a keyboard key on the element at `index` (Enter, Tab, Escape, …). */
export declare function press(page: Page, index: number, key: string, maxItems: number): Promise<void>;
/** Scroll the viewport or bring the element at `index` into view. */
export declare function scroll(page: Page, index: number | undefined, direction: 'up' | 'down' | 'top' | 'bottom' | undefined, maxItems: number): Promise<void>;
/** Wait for the page to settle (network idle plus a short stability pause). */
export declare function waitStable(page: Page): Promise<void>;
