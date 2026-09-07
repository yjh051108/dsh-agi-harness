/**
 * Wire vocabulary shared by the host half, the model-facing tools, and the
 * client panel: snapshot shape, tool result shapes, and panel route constants.
 * @module @dsh-external/dsh-browser-panel/protocol
 */
/** Rendered form of a snapshot: header + numbered interactive inventory. */
export const renderSnapshot = (snapshot, maxChars) => {
    const lines = [`URL: ${snapshot.url}`, `Title: ${snapshot.title}`, ''];
    for (const element of snapshot.elements) {
        const state = element.state === undefined ? '' : ` [${element.state}]`;
        const value = element.value === undefined ? '' : ` value="${element.value}"`;
        lines.push(`[${element.index}] <${element.tag}> ${element.role}: ${element.name}${state}${value}`);
    }
    if (snapshot.truncated)
        lines.push(`… (truncated; ${snapshot.elements.length} shown)`);
    const text = lines.join('\n');
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}… (truncated)`;
};
/** HTTP route prefix for panel state polling. */
export const PANEL_ROUTE = '/browser-panel';
/** WebSocket upgrade path for the live frame stream. */
export const PANEL_STREAM_PATH = '/browser-panel/stream';
