/**
 * Front-end-dev picking: locate an element under a normalized viewport
 * coordinate and extract a stable CSS selector plus the key computed styles,
 * so the panel can offer "add this element's CSS to the conversation".
 * Coordinates are normalized (0..1 fractions of the viewport) so the client
 * never needs to know the frame or viewport pixel sizes.
 * @module @dsh-external/dsh-browser-panel/pick
 */
/** Run inside the page: locate element at normalized coordinates and describe it. */
const PICK_SCRIPT = ({ xRatio, yRatio }) => {
    const x = Math.round(xRatio * window.innerWidth);
    const y = Math.round(yRatio * window.innerHeight);
    const element = document.elementFromPoint(x, y);
    if (element === null)
        return null;
    const rect = element.getBoundingClientRect();
    const selector = (() => {
        if (element.id !== '')
            return `#${CSS.escape(element.id)}`;
        const tag = element.tagName.toLowerCase();
        const classes = [...element.classList].slice(0, 5).map(c => `.${CSS.escape(c)}`).join('');
        if (classes !== '')
            return `${tag}${classes}`;
        // Fall back to a compact nth-of-type path (bounded depth).
        const parts = [];
        let node = element;
        let depth = 0;
        while (node !== null && node !== document.documentElement && depth < 4) {
            const parent = node.parentElement;
            const current = node;
            const position = parent === null ? 1 : [...parent.children].filter(c => c.tagName === current.tagName).indexOf(current) + 1;
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`);
            node = parent;
            depth += 1;
        }
        return parts.join(' > ');
    })();
    return {
        tag: element.tagName.toLowerCase(),
        id: element.id === '' ? undefined : element.id,
        classes: [...element.classList].slice(0, 5),
        selector,
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
    };
};
/** Run inside the page: locate the element and extract its key styles. */
const CSS_SCRIPT = ({ xRatio, yRatio }) => {
    const STYLE_KEYS = [
        'display', 'position', 'width', 'height', 'margin', 'padding',
        'color', 'background-color', 'font-size', 'font-weight', 'font-family',
        'line-height', 'text-align', 'border', 'border-radius', 'box-shadow',
        'flex', 'flex-direction', 'gap', 'justify-content', 'align-items',
        'overflow', 'z-index', 'opacity', 'cursor', 'transition', 'transform',
    ];
    const x = Math.round(xRatio * window.innerWidth);
    const y = Math.round(yRatio * window.innerHeight);
    const element = document.elementFromPoint(x, y);
    if (element === null)
        return null;
    const rect = element.getBoundingClientRect();
    const selector = (() => {
        if (element.id !== '')
            return `#${CSS.escape(element.id)}`;
        const tag = element.tagName.toLowerCase();
        const classes = [...element.classList].slice(0, 5).map(c => `.${CSS.escape(c)}`).join('');
        if (classes !== '')
            return `${tag}${classes}`;
        const parts = [];
        let node = element;
        let depth = 0;
        while (node !== null && node !== document.documentElement && depth < 4) {
            const parent = node.parentElement;
            const current = node;
            const position = parent === null ? 1 : [...parent.children].filter(c => c.tagName === current.tagName).indexOf(current) + 1;
            parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`);
            node = parent;
            depth += 1;
        }
        return parts.join(' > ');
    })();
    const computed = getComputedStyle(element);
    const styles = {};
    for (const key of STYLE_KEYS) {
        const value = computed.getPropertyValue(key);
        if (value !== '' && value !== 'none' && value !== 'auto' && value !== '0px' && value !== 'normal') {
            styles[key] = value;
        }
    }
    return {
        tag: element.tagName.toLowerCase(),
        id: element.id === '' ? undefined : element.id,
        classes: [...element.classList].slice(0, 5),
        selector,
        text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        styles,
    };
};
/**
 * Describe the element at normalized viewport coordinates.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export async function pickElement(page, xRatio, yRatio) {
    return await page.evaluate(PICK_SCRIPT, { xRatio, yRatio });
}
/**
 * Extract the element's stable selector and key computed styles.
 * @param page - the active Playwright page.
 * @param xRatio - 0..1 fraction of viewport width.
 * @param yRatio - 0..1 fraction of viewport height.
 */
export async function extractCss(page, xRatio, yRatio) {
    return await page.evaluate(CSS_SCRIPT, { xRatio, yRatio });
}
/** Render an extraction as a copy-paste-friendly CSS block. */
export function renderCssBlock(extraction) {
    const lines = [`/* ${extraction.tag}${extraction.id !== undefined ? `#${extraction.id}` : ''} — ${extraction.text || 'no text'} */`, `${extraction.selector} {`];
    for (const [key, value] of Object.entries(extraction.styles)) {
        lines.push(`  ${key}: ${value};`);
    }
    lines.push('}');
    return lines.join('\n');
}
