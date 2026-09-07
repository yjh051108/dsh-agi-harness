/**
 * Package-owned invariant companion for `@dsh-external/dsh-browser-panel`.
 * @module @dsh-external/dsh-browser-panel/invariant
 */
/** Minimal invariants service contract (subset of the host service). */
interface InvariantsContext {
    invariants: {
        register(packageName: string, installer: () => void): () => void;
    };
}
/** Cordis companion plugin name. */
export declare const name = "browser-panel-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: InvariantsContext) => (() => void);
export {};
