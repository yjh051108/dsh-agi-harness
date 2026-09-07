/**
 * Wire vocabulary shared by the host half, the model-facing tools, and the
 * client panel: snapshot shape, tool result shapes, and panel route constants.
 * @module @dsh-external/dsh-browser-panel/protocol
 */
/** Panel-visible browser state pushed to the client over the frame stream. */
export interface BrowserState {
    readonly sessionId: string;
    readonly open: boolean;
    readonly url?: string;
    readonly title?: string;
}
/** One interactive element inside a page snapshot. */
export interface SnapshotElement {
    /** Stable display index within this snapshot (1-based). */
    readonly index: number;
    /** Semantic role: link | button | input | select | textarea | checkbox | radio | combobox | tab | menuitem | generic. */
    readonly role: string;
    /** Human-readable name (aria-label / title / placeholder / visible text), truncated. */
    readonly name: string;
    /** Element tag name, lowercased. */
    readonly tag: string;
    /** Present for disabled, checked, selected, or indeterminate states. */
    readonly state?: string;
    /** Current value for inputs/textareas; masked to bullets for password fields. */
    readonly value?: string;
    /** Whether the element is currently visible in the layout. */
    readonly visible: boolean;
    /** Absolute XPath used to re-locate the element for actions. */
    readonly xpath: string;
}
/** The full model-visible page observation. */
export interface PageSnapshot {
    readonly url: string;
    readonly title: string;
    /** Interactive elements in document order, numbered 1..N. */
    readonly elements: readonly SnapshotElement[];
    /** True when the element list was capped by maxInteractiveItems. */
    readonly truncated: boolean;
}
/** Rendered form of a snapshot: header + numbered interactive inventory. */
export declare const renderSnapshot: (snapshot: PageSnapshot, maxChars: number) => string;
/** Panel stream message kinds. */
export type PanelMessage = {
    readonly kind: 'state';
    readonly state: BrowserState;
} | {
    readonly kind: 'frame';
    readonly jpegBase64: string;
};
/** HTTP route prefix for panel state polling. */
export declare const PANEL_ROUTE = "/browser-panel";
/** WebSocket upgrade path for the live frame stream. */
export declare const PANEL_STREAM_PATH = "/browser-panel/stream";
