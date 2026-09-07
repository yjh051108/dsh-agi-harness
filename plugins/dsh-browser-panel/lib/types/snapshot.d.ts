/**
 * Non-multimodal page observation: serialize the page's interactive elements
 * into a numbered, text-only inventory the model reads directly. Screenshots
 * never enter model context; the snapshot IS the model's eyes.
 * @module @dsh-external/dsh-browser-panel/snapshot
 */
import type { Page } from 'playwright-core';
import type { PageSnapshot } from './protocol.ts';
/**
 * Render the delta between two snapshots: URL/title changes plus added,
 * removed, and changed elements keyed by XPath. Unchanged elements are
 * omitted, which is what makes delta mode cheap for the model.
 * @param previous - the earlier snapshot.
 * @param current - the newer snapshot.
 * @returns human-readable change lines, or a short "no changes" line.
 */
export declare function diffSnapshot(previous: PageSnapshot, current: PageSnapshot): string;
/**
 * Collect a numbered interactive inventory from the active page.
 * @param page - the Playwright page to observe.
 * @param maxItems - cap on the number of elements returned (in document order).
 * @returns the page snapshot; `truncated` flags a capped inventory.
 */
export declare function collectSnapshot(page: Page, maxItems: number): Promise<PageSnapshot>;
