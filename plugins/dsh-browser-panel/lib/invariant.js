//#region lib/types/invariant.js
/**
* Package-owned invariant companion for `@dsh-external/dsh-browser-panel`.
* @module @dsh-external/dsh-browser-panel/invariant
*/
const PACKAGE_NAME = "@dsh-external/dsh-browser-panel";
/** Cordis companion plugin name. */
const name = "browser-panel-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/**
* No runtime invariant: the per-session browser registry and frame cache are
* private to the plugin fiber; the session/agent relationship is asserted by
* the tool registry and the HTTP routes, which publish no separate
* observation stream.
*/
const install = () => {};
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => ctx.invariants.register(PACKAGE_NAME, install);
//#endregion
export { apply, inject, name };
