// Loader-entry compatibility shim: the loader stack resolves bare package
// names to <pkgdir>/index.js; the real entry remains lib/index.js.
export * from "./lib/index.js";
