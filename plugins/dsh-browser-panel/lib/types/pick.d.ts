/**
 * Front-end-dev picking: locate an element under a normalized viewport
 * coordinate and extract a stable CSS selector plus the key computed styles,
 * so the panel can offer "add this element's CSS to the conversation".
 * Coordinates are normalized (0..1 fractions of the viewport) so the client
 * never needs to know the frame or viewport pixel sizes.
 * @module @dsh-external/dsh-browser-panel/pick
 */
import type { Page } from 'playwright-core';
/** Element info returned for panel highlighting. */
export interface PickedElement {
    readonly tag: string;
    readonly id?: string;
    readonly classes: readonly string[];
    readonly selector: string;
    readonly text: string;
    /** Viewport-space bounding rect (for the panel overlay). */
    readonly rect: {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
    };
    readonly viewport: {
        readonly width: number;
        readonly height: number;
    };
}
/** CSS extraction result: selector plus the computed styles that matter for front-end work. */
export interface CssExtraction extends PickedElement {
    readonly styles: Readonly<Record<string, string>>;
}
/**
 * Describe the element at normalized viewport coordinates.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export declare function pickElement(page: Page, xRatio: number, yRatio: number): Promise<PickedElement | null>;
/**
 * Extract the element's stable selector and key computed styles.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export declare function extractCss(page: Page, xRatio: number, yRatio: number): Promise<CssExtraction | null>;
/** Render an extraction as a copy-paste-friendly CSS block. */
export declare function renderCssBlock(extraction: CssExtraction): string;
