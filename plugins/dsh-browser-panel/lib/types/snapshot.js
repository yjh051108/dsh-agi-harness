/**
 * Non-multimodal page observation: serialize the page's interactive elements
 * into a numbered, text-only inventory the model reads directly. Screenshots
 * never enter model context; the snapshot IS the model's eyes.
 * @module @dsh-external/dsh-browser-panel/snapshot
 */
/** Element inventory script run inside the page. */
const COLLECT_SCRIPT = () => {
    const SELECTORS = [
        'a[href]', 'button', 'input', 'select', 'textarea',
        '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
        '[role="combobox"]', '[role="tab"]', '[role="menuitem"]', '[role="switch"]',
        '[contenteditable="true"]',
    ].join(',');
    const NAME_CAP = 80;
    const elements = [...document.querySelectorAll(SELECTORS)];
    const seen = new Set();
    const unique = elements.filter(element => {
        if (seen.has(element))
            return false;
        seen.add(element);
        return true;
    });
    const root = document.documentElement;
    const xpathFor = (element) => {
        const parts = [];
        let node = element;
        while (node !== null && node !== root) {
            const tag = node.tagName.toLowerCase();
            const parent = node.parentElement;
            let position = 1;
            if (parent !== null) {
                const current = node;
                const siblings = [...parent.children].filter(child => child.tagName === current.tagName);
                position = siblings.indexOf(current) + 1;
            }
            parts.unshift(`${tag}[${position}]`);
            node = parent;
        }
        return `/${root.tagName.toLowerCase()}[1]/${parts.join('/')}`;
    };
    const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const roleFor = (element) => {
        const explicit = element.getAttribute('role');
        if (explicit !== null)
            return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === 'a')
            return 'link';
        if (tag === 'button')
            return 'button';
        if (tag === 'input') {
            const type = element.type;
            if (type === 'checkbox')
                return 'checkbox';
            if (type === 'radio')
                return 'radio';
            return 'input';
        }
        if (tag === 'select')
            return 'select';
        if (tag === 'textarea')
            return 'textarea';
        return 'generic';
    };
    const nameFor = (element) => {
        const aria = element.getAttribute('aria-label');
        if (aria !== null && aria.trim() !== '')
            return aria.trim().slice(0, NAME_CAP);
        const title = element.getAttribute('title');
        if (title !== null && title.trim() !== '')
            return title.trim().slice(0, NAME_CAP);
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const placeholder = element.placeholder;
            if (placeholder !== '')
                return placeholder.slice(0, NAME_CAP);
        }
        const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ');
        if (text !== '')
            return text.slice(0, NAME_CAP);
        return element.tagName.toLowerCase();
    };
    const stateFor = (element) => {
        if (element instanceof HTMLInputElement) {
            if (element.disabled)
                return 'disabled';
            if (element.type === 'checkbox' || element.type === 'radio') {
                return element.checked ? 'checked' : 'unchecked';
            }
        }
        if (element.hasAttribute('disabled'))
            return 'disabled';
        if (element.hasAttribute('aria-selected')) {
            return element.getAttribute('aria-selected') === 'true' ? 'selected' : undefined;
        }
        if (element.hasAttribute('aria-checked')) {
            return element.getAttribute('aria-checked') === 'true' ? 'checked' : undefined;
        }
        return undefined;
    };
    const valueFor = (element) => {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const value = element.value;
            if (value === '')
                return undefined;
            if (element instanceof HTMLInputElement && element.type === 'password')
                return '••••';
            return value.slice(0, NAME_CAP);
        }
        if (element instanceof HTMLSelectElement) {
            return element.selectedOptions[0]?.textContent?.trim().slice(0, NAME_CAP);
        }
        return undefined;
    };
    return unique.map(element => ({
        role: roleFor(element),
        name: nameFor(element),
        tag: element.tagName.toLowerCase(),
        state: stateFor(element),
        value: valueFor(element),
        visible: visible(element),
        xpath: xpathFor(element),
    }));
};
/**
 * Render the delta between two snapshots: URL/title changes plus added,
 * removed, and changed elements keyed by XPath. Unchanged elements are
 * omitted, which is what makes delta mode cheap for the model.
 * @param previous - the earlier snapshot.
 * @param current - the newer snapshot.
 * @returns human-readable change lines, or a short "no changes" line.
 */
export function diffSnapshot(previous, current) {
    const lines = [];
    if (previous.url !== current.url)
        lines.push(`URL: ${previous.url} → ${current.url}`);
    if (previous.title !== current.title)
        lines.push(`Title: ${previous.title || '(none)'} → ${current.title || '(none)'}`);
    const prevByPath = new Map(previous.elements.map(element => [element.xpath, element]));
    const currByPath = new Map(current.elements.map(element => [element.xpath, element]));
    for (const element of current.elements) {
        if (!prevByPath.has(element.xpath)) {
            lines.push(`+ [${element.index}] <${element.tag}> ${element.role}: ${element.name}`);
        }
    }
    for (const element of previous.elements) {
        if (!currByPath.has(element.xpath)) {
            lines.push(`- [gone] <${element.tag}> ${element.role}: ${element.name}`);
        }
    }
    for (const [path, prev] of prevByPath) {
        const curr = currByPath.get(path);
        if (curr === undefined)
            continue;
        const changed = [];
        if (prev.role !== curr.role)
            changed.push(`role ${prev.role}→${curr.role}`);
        if (prev.name !== curr.name)
            changed.push(`name "${prev.name}"→"${curr.name}"`);
        if (prev.state !== curr.state)
            changed.push(`state ${prev.state ?? 'none'}→${curr.state ?? 'none'}`);
        if (prev.value !== curr.value)
            changed.push(`value ${prev.value ?? 'empty'}→${curr.value ?? 'empty'}`);
        if (changed.length > 0) {
            lines.push(`~ [${curr.index}] <${curr.tag}> ${curr.role}: ${changed.join(', ')}`);
        }
    }
    if (lines.length === 0)
        return 'No changes since the last snapshot.';
    return lines.join('\n');
}
/**
 * Collect a numbered interactive inventory from the active page.
 * @param page - the Playwright page to observe.
 * @param maxItems - cap on the number of elements returned (in document order).
 * @returns the page snapshot; `truncated` flags a capped inventory.
 */
export async function collectSnapshot(page, maxItems) {
    const [url, title, collected] = await Promise.all([
        page.url(),
        page.title().catch(() => ''),
        page.evaluate(COLLECT_SCRIPT),
    ]);
    const visibleFirst = [...collected].sort((a, b) => Number(b.visible) - Number(a.visible));
    const elements = visibleFirst.slice(0, maxItems).map((element, position) => ({
        ...element,
        index: position + 1,
    }));
    return {
        url,
        title,
        elements,
        truncated: collected.length > maxItems,
    };
}
