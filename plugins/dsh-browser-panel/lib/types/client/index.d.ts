/**
 * WebUI client half of the browser panel: a right-side dock that shows the
 * per-session browser's live JPEG frames (human-visible only) plus URL/title
 * state, and a pick mode for front-end work — click a spot on the live view,
 * extract the element's CSS, and add it to the composer in one click.
 * The model never sees these images; control stays on the text-only tools.
 *
 * Zero-config strong-compat with dsh-better-sidebar: when its `betterSidebar`
 * service is present at apply time, the panel registers itself as a sidebar
 * tab (lazy-mounted on open) instead of the fixed right dock. No changes to
 * better-sidebar are needed — its official registerTab protocol is consumed
 * as-is. Without the service the panel keeps the classic dock.
 * @module @dsh-external/dsh-browser-panel/client
 */
/** Minimal client session list contract (subset of the client `sessions` service). */
interface SessionList {
    current: string | undefined;
    subscribe(listener: () => void): () => void;
}
interface ClientContext {
    get(name: string): unknown;
    sessions?: {
        list: SessionList;
    };
    effect(callback: () => (() => void), label?: string): void;
}
/** No hard inject: sessions is fetched optionally so the fiber activates even
 * before the runtime provides it; polling retries until it appears. */
export declare const inject: string[];
/** Mount the panel: sidebar tab when better-sidebar is present, else the classic dock. */
export declare function apply(ctx: ClientContext): void;
export {};
