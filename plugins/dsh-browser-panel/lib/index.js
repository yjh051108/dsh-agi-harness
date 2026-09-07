import z from "schemastery";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { chromium } from "playwright-core";
//#region lib/types/browser.js
/**
* Per-session headed-browser lifecycle: one persistent Playwright Chromium
* context per owner session, created lazily on first use and destroyed with
* its owner. The browser runs headless with a CDP screencast feed for the
* panel; "headed" refers to the live visible page in the WebUI, not an OS
* window.
*
* Login persistence: when a profile directory is configured, the context is
* launched persistent (user data dir under `~/.dsh/browser-panel/profiles/`),
* so cookies and site storage survive dsh restarts for the same session.
*
* Tabs: the session owns a tab list; exactly one tab is active at a time and
* the CDP screencast always feeds the active tab.
* @module @dsh-external/dsh-browser-panel/browser
*/
/** One owned browser instance. Not thread-safe; owner serializes calls. */
var BrowserSession = class BrowserSession {
	browser;
	context;
	cdpByPage = /* @__PURE__ */ new Map();
	pages = [];
	activeIndex = 0;
	tabListeners = /* @__PURE__ */ new Set();
	consoleBuffer = [];
	dialogs = /* @__PURE__ */ new Map();
	downloads = [];
	dialogSeq = 0;
	downloadSeq = 0;
	lastActive = 0;
	/**
	* Subscribe to tab changes (open/new/switch/close). Used by the screencast
	* pump to re-attach CDP frames to the newly active tab.
	* @param listener - called synchronously after a tab transition.
	* @returns unsubscribe function.
	*/
	onTabChange(listener) {
		this.tabListeners.add(listener);
		return () => {
			this.tabListeners.delete(listener);
		};
	}
	notifyTabChange() {
		for (const listener of this.tabListeners) listener();
	}
	/** Mark this session as recently used (called on every tool touch). */
	touch() {
		this.lastActive = Date.now();
	}
	/** Milliseconds since the last tool touch; 0 if never touched. */
	idleMs() {
		if (this.lastActive === 0) return 0;
		return Date.now() - this.lastActive;
	}
	/** Whether an underlying browser is currently alive. */
	get isOpen() {
		return this.browser !== void 0 && this.browser.isConnected();
	}
	/** The active tab, when open. */
	get page() {
		return this.pages[this.activeIndex];
	}
	/** Current active-tab URL, when a page exists. */
	get url() {
		return this.page?.url();
	}
	/** Current active-tab title, when a page exists and is readable. */
	async title() {
		if (this.page === void 0) return void 0;
		return await this.page.title().catch(() => "");
	}
	/** Ordered tab list for the panel and the `browser_tabs` tool. */
	get tabs() {
		return this.pages.map((page, index) => ({
			index,
			url: page.url(),
			active: index === this.activeIndex
		}));
	}
	/** Recent console messages across all tabs (most recent first). */
	get consoleLog() {
		return this.consoleBuffer;
	}
	/** Pending page dialogs awaiting a model decision. */
	get pendingDialogs() {
		return [...this.dialogs.entries()].map(([id, dialog]) => ({
			id,
			type: dialog.type(),
			message: dialog.message(),
			ts: Date.now()
		}));
	}
	/** Downloads captured from pages (most recent first). */
	get downloadList() {
		return [...this.downloads].reverse();
	}
	/** Clear the captured console buffer. */
	clearConsole() {
		this.consoleBuffer.length = 0;
	}
	/** Respond to a pending dialog: accept with optional text, or dismiss. */
	async respondDialog(id, accept, text) {
		const dialog = this.dialogs.get(id);
		if (dialog === void 0) throw new Error(`dialog ${id} not pending`);
		this.dialogs.delete(id);
		if (accept) await dialog.accept(text).catch(() => {});
		else await dialog.dismiss().catch(() => {});
	}
	/**
	* Launch the browser and open a fresh page. Idempotent. When `profileDir`
	* is set, the context is persistent (cookies/site storage survive restarts).
	* @param profileDir - absolute directory for the persistent user data, or
	* undefined for an ephemeral context.
	*/
	async open(profileDir) {
		if (this.isOpen) return;
		const noProxyArgs = ["--proxy-server=direct://"];
		const cleanEnv = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (/^(http|https|all|no)_proxy$/i.test(key)) continue;
			if (value !== void 0) cleanEnv[key] = value;
		}
		if (profileDir !== void 0) {
			await mkdir(profileDir, { recursive: true });
			this.context = await chromium.launchPersistentContext(profileDir, {
				headless: true,
				viewport: {
					width: 1280,
					height: 800
				},
				args: noProxyArgs,
				env: cleanEnv
			});
			this.browser = this.context.browser() ?? void 0;
			this.pages = this.context.pages();
			this.activeIndex = 0;
		} else {
			this.browser = await chromium.launch({
				headless: true,
				args: noProxyArgs,
				env: cleanEnv
			});
			this.context = await this.browser.newContext({
				viewport: {
					width: 1280,
					height: 800
				},
				acceptDownloads: true
			});
			this.pages = [await this.context.newPage()];
			this.activeIndex = 0;
		}
		for (const page of this.pages) this.wirePage(page);
		this.notifyTabChange();
	}
	/**
	* Navigate the active page to an absolute http(s) URL and wait for load.
	* @param url - absolute http(s) URL.
	*/
	async navigate(url) {
		await this.ensurePage();
		await this.page.goto(url, {
			waitUntil: "load",
			timeout: 3e4
		});
	}
	/** Open a new tab and activate it. */
	async newTab() {
		await this.ensureContext();
		const page = await this.context.newPage();
		this.wirePage(page);
		this.pages.push(page);
		this.activeIndex = this.pages.length - 1;
		await page.bringToFront().catch(() => {});
		this.notifyTabChange();
	}
	/**
	* Activate the tab at `index`. Brings the underlying page to the front so
	* Chromium keeps rendering/compositing it (headless screencast only emits
	* frames for the foreground target).
	* @param index - 0-based tab index.
	*/
	async switchTab(index) {
		if (index < 0 || index >= this.pages.length) throw new Error(`tab index ${index} out of range (${this.pages.length} tabs)`);
		this.activeIndex = index;
		await this.page?.bringToFront().catch(() => {});
		this.notifyTabChange();
	}
	/** Close the tab at `index`; keeps at least one tab. */
	async closeTab(index) {
		if (this.pages.length <= 1) throw new Error("cannot close the last tab");
		if (index < 0 || index >= this.pages.length) throw new Error(`tab index ${index} out of range (${this.pages.length} tabs)`);
		const closing = this.pages[index];
		this.cdpByPage.delete(closing);
		await closing.close().catch(() => {});
		this.pages.splice(index, 1);
		if (this.activeIndex >= this.pages.length) this.activeIndex = this.pages.length - 1;
		this.notifyTabChange();
	}
	/**
	* The CDP session for `page`, created on first use and cached per page.
	* Each tab keeps its own session so screencast subscriptions stay alive
	* across tab switches (stopping and restarting screencasts across pages is
	* unreliable in headless Chromium).
	*/
	async cdpSessionFor(page) {
		const cached = this.cdpByPage.get(page);
		if (cached !== void 0) return cached;
		await this.ensureContext();
		const cdp = await this.context.newCDPSession(page);
		this.cdpByPage.set(page, cdp);
		return cdp;
	}
	/** Close the browser and drop all state. Idempotent. */
	async close() {
		const closingBrowser = this.browser;
		const closingContext = this.context;
		this.cdpByPage.clear();
		this.pages = [];
		this.activeIndex = 0;
		this.browser = void 0;
		this.context = void 0;
		this.dialogs.clear();
		if (closingBrowser !== void 0) await closingBrowser.close().catch(() => {});
		else if (closingContext !== void 0) await closingContext.close().catch(() => {});
	}
	async ensureContext() {
		if (this.context === void 0) await this.open();
	}
	async ensurePage() {
		await this.ensureContext();
		if (this.page === void 0) throw new Error("browser page unavailable");
	}
	/** Cap the console buffer to keep memory bounded. */
	static CONSOLE_CAP = 200;
	/** Attach page event listeners (console / dialogs / downloads) once per tab. */
	wirePage(page) {
		page.on("console", (message) => {
			const text = message.text();
			if (text === "") return;
			const type = message.type();
			const entry = {
				type: type === "error" || type === "info" || type === "debug" ? type : type === "warning" ? "warn" : "log",
				text: text.slice(0, 1e3),
				url: page.url(),
				ts: Date.now()
			};
			this.consoleBuffer.push(entry);
			if (this.consoleBuffer.length > BrowserSession.CONSOLE_CAP) this.consoleBuffer.splice(0, this.consoleBuffer.length - BrowserSession.CONSOLE_CAP);
		});
		page.on("dialog", (dialog) => {
			this.dialogs.set(++this.dialogSeq, dialog);
		});
		page.on("download", (download) => {
			const id = ++this.downloadSeq;
			const filename = download.suggestedFilename();
			download.path().then((path) => {
				this.downloads.push({
					id,
					filename,
					path: path ?? void 0,
					ts: Date.now()
				});
			}).catch(() => {
				this.downloads.push({
					id,
					filename,
					ts: Date.now()
				});
			});
		});
	}
};
/** Default persistent profile root shared across sessions. */
const PROFILE_ROOT = join(homedir(), ".dsh", "browser-panel", "profiles");
//#endregion
//#region lib/types/snapshot.js
/**
* Non-multimodal page observation: serialize the page's interactive elements
* into a numbered, text-only inventory the model reads directly. Screenshots
* never enter model context; the snapshot IS the model's eyes.
* @module @dsh-external/dsh-browser-panel/snapshot
*/
/** Element inventory script run inside the page. */
const COLLECT_SCRIPT = () => {
	const SELECTORS = [
		"a[href]",
		"button",
		"input",
		"select",
		"textarea",
		"[role=\"button\"]",
		"[role=\"link\"]",
		"[role=\"checkbox\"]",
		"[role=\"radio\"]",
		"[role=\"combobox\"]",
		"[role=\"tab\"]",
		"[role=\"menuitem\"]",
		"[role=\"switch\"]",
		"[contenteditable=\"true\"]"
	].join(",");
	const NAME_CAP = 80;
	const elements = [...document.querySelectorAll(SELECTORS)];
	const seen = /* @__PURE__ */ new Set();
	const unique = elements.filter((element) => {
		if (seen.has(element)) return false;
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
				position = [...parent.children].filter((child) => child.tagName === current.tagName).indexOf(current) + 1;
			}
			parts.unshift(`${tag}[${position}]`);
			node = parent;
		}
		return `/${root.tagName.toLowerCase()}[1]/${parts.join("/")}`;
	};
	const visible = (element) => {
		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	};
	const roleFor = (element) => {
		const explicit = element.getAttribute("role");
		if (explicit !== null) return explicit;
		const tag = element.tagName.toLowerCase();
		if (tag === "a") return "link";
		if (tag === "button") return "button";
		if (tag === "input") {
			const type = element.type;
			if (type === "checkbox") return "checkbox";
			if (type === "radio") return "radio";
			return "input";
		}
		if (tag === "select") return "select";
		if (tag === "textarea") return "textarea";
		return "generic";
	};
	const nameFor = (element) => {
		const aria = element.getAttribute("aria-label");
		if (aria !== null && aria.trim() !== "") return aria.trim().slice(0, NAME_CAP);
		const title = element.getAttribute("title");
		if (title !== null && title.trim() !== "") return title.trim().slice(0, NAME_CAP);
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			const placeholder = element.placeholder;
			if (placeholder !== "") return placeholder.slice(0, NAME_CAP);
		}
		const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
		if (text !== "") return text.slice(0, NAME_CAP);
		return element.tagName.toLowerCase();
	};
	const stateFor = (element) => {
		if (element instanceof HTMLInputElement) {
			if (element.disabled) return "disabled";
			if (element.type === "checkbox" || element.type === "radio") return element.checked ? "checked" : "unchecked";
		}
		if (element.hasAttribute("disabled")) return "disabled";
		if (element.hasAttribute("aria-selected")) return element.getAttribute("aria-selected") === "true" ? "selected" : void 0;
		if (element.hasAttribute("aria-checked")) return element.getAttribute("aria-checked") === "true" ? "checked" : void 0;
	};
	const valueFor = (element) => {
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			const value = element.value;
			if (value === "") return void 0;
			if (element instanceof HTMLInputElement && element.type === "password") return "••••";
			return value.slice(0, NAME_CAP);
		}
		if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent?.trim().slice(0, NAME_CAP);
	};
	return unique.map((element) => ({
		role: roleFor(element),
		name: nameFor(element),
		tag: element.tagName.toLowerCase(),
		state: stateFor(element),
		value: valueFor(element),
		visible: visible(element),
		xpath: xpathFor(element)
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
function diffSnapshot(previous, current) {
	const lines = [];
	if (previous.url !== current.url) lines.push(`URL: ${previous.url} → ${current.url}`);
	if (previous.title !== current.title) lines.push(`Title: ${previous.title || "(none)"} → ${current.title || "(none)"}`);
	const prevByPath = new Map(previous.elements.map((element) => [element.xpath, element]));
	const currByPath = new Map(current.elements.map((element) => [element.xpath, element]));
	for (const element of current.elements) if (!prevByPath.has(element.xpath)) lines.push(`+ [${element.index}] <${element.tag}> ${element.role}: ${element.name}`);
	for (const element of previous.elements) if (!currByPath.has(element.xpath)) lines.push(`- [gone] <${element.tag}> ${element.role}: ${element.name}`);
	for (const [path, prev] of prevByPath) {
		const curr = currByPath.get(path);
		if (curr === void 0) continue;
		const changed = [];
		if (prev.role !== curr.role) changed.push(`role ${prev.role}→${curr.role}`);
		if (prev.name !== curr.name) changed.push(`name "${prev.name}"→"${curr.name}"`);
		if (prev.state !== curr.state) changed.push(`state ${prev.state ?? "none"}→${curr.state ?? "none"}`);
		if (prev.value !== curr.value) changed.push(`value ${prev.value ?? "empty"}→${curr.value ?? "empty"}`);
		if (changed.length > 0) lines.push(`~ [${curr.index}] <${curr.tag}> ${curr.role}: ${changed.join(", ")}`);
	}
	if (lines.length === 0) return "No changes since the last snapshot.";
	return lines.join("\n");
}
/**
* Collect a numbered interactive inventory from the active page.
* @param page - the Playwright page to observe.
* @param maxItems - cap on the number of elements returned (in document order).
* @returns the page snapshot; `truncated` flags a capped inventory.
*/
async function collectSnapshot(page, maxItems) {
	const [url, title, collected] = await Promise.all([
		page.url(),
		page.title().catch(() => ""),
		page.evaluate(COLLECT_SCRIPT)
	]);
	return {
		url,
		title,
		elements: [...collected].sort((a, b) => Number(b.visible) - Number(a.visible)).slice(0, maxItems).map((element, position) => ({
			...element,
			index: position + 1
		})),
		truncated: collected.length > maxItems
	};
}
//#endregion
//#region lib/types/protocol.js
/**
* Wire vocabulary shared by the host half, the model-facing tools, and the
* client panel: snapshot shape, tool result shapes, and panel route constants.
* @module @dsh-external/dsh-browser-panel/protocol
*/
/** Rendered form of a snapshot: header + numbered interactive inventory. */
const renderSnapshot = (snapshot, maxChars) => {
	const lines = [
		`URL: ${snapshot.url}`,
		`Title: ${snapshot.title}`,
		""
	];
	for (const element of snapshot.elements) {
		const state = element.state === void 0 ? "" : ` [${element.state}]`;
		const value = element.value === void 0 ? "" : ` value="${element.value}"`;
		lines.push(`[${element.index}] <${element.tag}> ${element.role}: ${element.name}${state}${value}`);
	}
	if (snapshot.truncated) lines.push(`… (truncated; ${snapshot.elements.length} shown)`);
	const text = lines.join("\n");
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}… (truncated)`;
};
/** HTTP route prefix for panel state polling. */
const PANEL_ROUTE = "/browser-panel";
/** WebSocket upgrade path for the live frame stream. */
const PANEL_STREAM_PATH = "/browser-panel/stream";
//#endregion
//#region lib/types/actions.js
/**
* Atomic page actions: execute a model-chosen primitive against an element
* addressed by snapshot index. Indexes are re-issued by every snapshot; a
* stale index fails with the current snapshot so the model retries from
* evidence instead of guessing.
* @module @dsh-external/dsh-browser-panel/actions
*/
/** Failure carrying the fresh snapshot so callers can retry from evidence. */
var StaleIndexError = class extends Error {
	snapshotText;
	constructor(snapshotText) {
		super(`element index is stale; snapshot re-issued:\n${snapshotText}`);
		this.snapshotText = snapshotText;
		this.name = "StaleIndexError";
	}
};
/** Locate the element backing a snapshot index, or throw {@link StaleIndexError}. */
async function elementByIndex(page, index, maxItems) {
	const snapshot = await collectSnapshot(page, maxItems);
	const target = snapshot.elements.find((element) => element.index === index);
	if (target === void 0) throw new StaleIndexError(renderForRetry(snapshot));
	return {
		xpath: target.xpath,
		name: target.name
	};
}
/** Compact retry hint: URL plus the numbered inventory lines only. */
function renderForRetry(snapshot) {
	const lines = [
		`URL: ${snapshot.url}`,
		`Title: ${snapshot.title}`,
		""
	];
	for (const element of snapshot.elements) lines.push(`[${element.index}] ${element.role}: ${element.name}`);
	return lines.join("\n");
}
/** Click the element at `index`. */
async function click(page, index, maxItems) {
	const { xpath } = await elementByIndex(page, index, maxItems);
	await page.locator(`xpath=${xpath}`).first().click({ timeout: 1e4 });
}
/**
* Fill the element at `index` with text. `replace: true` clears first; false
* appends, which works for both controlled (React/Vue) and plain inputs.
*/
async function typeText(page, index, text, replace, maxItems) {
	const { xpath } = await elementByIndex(page, index, maxItems);
	const locator = page.locator(`xpath=${xpath}`).first();
	if (replace) await locator.fill(text, { timeout: 1e4 });
	else await locator.pressSequentially(text, { delay: 8 });
}
/** Press a keyboard key on the element at `index` (Enter, Tab, Escape, …). */
async function press(page, index, key, maxItems) {
	const { xpath } = await elementByIndex(page, index, maxItems);
	await page.locator(`xpath=${xpath}`).first().press(key, { timeout: 1e4 });
}
/** Scroll the viewport or bring the element at `index` into view. */
async function scroll(page, index, direction, maxItems) {
	if (index !== void 0) {
		const { xpath } = await elementByIndex(page, index, maxItems);
		await page.locator(`xpath=${xpath}`).first().scrollIntoViewIfNeeded({ timeout: 1e4 });
		return;
	}
	const delta = direction === "up" ? -600 : direction === "down" ? 600 : 0;
	await page.evaluate(({ delta, direction }) => {
		if (direction === "top") window.scrollTo(0, 0);
		else if (direction === "bottom") window.scrollTo(0, document.body.scrollHeight);
		else window.scrollBy(0, delta);
	}, {
		delta,
		direction: direction ?? "down"
	});
}
/** Wait for the page to settle (network idle plus a short stability pause). */
async function waitStable(page) {
	await page.waitForLoadState("networkidle", { timeout: 15e3 }).catch(() => {});
	await page.waitForTimeout(300);
}
//#endregion
//#region lib/types/vision.js
/**
* Optional vision bridge: describe a live browser frame through an
* OpenAI-compatible vision-language model (VLM). Purely opt-in — enabled only
* when the plugin config provides a `vision` endpoint. The model remains
* text-only by default; this tool is the explicit escape hatch the North Star
* calls "optional VLM bridge" (screenshots selectively enter model context).
*
* Zero SDK dependency: speaks the standard Chat Completions wire format over
* the built-in `fetch`.
* @module @dsh-external/dsh-browser-panel/vision
*/
/** Render an error as a stable string without leaking credentials. */
function describeError(error) {
	if (error instanceof Error) return error.message;
	return String(error);
}
/**
* Capture the page as JPEG and ask the VLM to describe it.
* @param page - the Playwright page to capture.
* @param options - vision endpoint config.
* @param prompt - instruction for the VLM.
* @returns the model's text response.
*/
async function describeFrame(page, options, prompt) {
	const dataUrl = `data:image/jpeg;base64,${(await page.screenshot({
		type: "jpeg",
		quality: 70
	})).toString("base64")}`;
	let response;
	try {
		response = await fetch(options.endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...options.apiKey === void 0 ? {} : { authorization: `Bearer ${options.apiKey}` }
			},
			body: JSON.stringify({
				model: options.model,
				messages: [{
					role: "user",
					content: [{
						type: "text",
						text: prompt
					}, {
						type: "image_url",
						image_url: { url: dataUrl }
					}]
				}],
				temperature: .2
			}),
			signal: AbortSignal.timeout(3e4)
		});
	} catch (error) {
		throw new Error(`vision request failed: ${describeError(error)}`);
	}
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`vision endpoint returned ${response.status}: ${body.slice(0, 300)}`);
	}
	const content = (await response.json()).choices?.[0]?.message?.content;
	if (typeof content !== "string" || content === "") throw new Error("vision endpoint returned an empty response");
	return content.trim();
}
//#endregion
//#region lib/types/tools.js
/**
* Model-facing browser tools over the per-session headed browser. The whole
* surface is text-only by design (DeepSeek models have no vision):
* `browser_snapshot` renders the page as structured text with a numbered
* interactive inventory, and every other tool addresses elements by that
* inventory's index. Screenshots never enter model context.
*
* The tool contracts below are self-declared minimal interfaces (this plugin
* is a standalone repo with no SDK dependency; the host Harness provides the
* real services at runtime).
* @module @dsh-external/dsh-browser-panel/tools
*/
/** Per-session browser ownership: one BrowserSession per owner session id. */
var BrowserSessionRegistry = class {
	sessions = /* @__PURE__ */ new Map();
	/** The browser owned by `sessionId`, creating it on first use. */
	get(sessionId) {
		let session = this.sessions.get(sessionId);
		if (session === void 0) {
			session = new BrowserSession();
			this.sessions.set(sessionId, session);
		}
		return session;
	}
	/** Number of sessions whose browser is currently open. */
	openCount() {
		let count = 0;
		for (const session of this.sessions.values()) if (session.isOpen) count += 1;
		return count;
	}
	/** Close every session idle longer than `idleMs`; returns how many closed. */
	async closeIdle(idleMs) {
		let closed = 0;
		const candidates = [];
		for (const session of this.sessions.values()) if (session.isOpen && session.idleMs() > idleMs) candidates.push(session);
		await Promise.all(candidates.map(async (session) => {
			await session.close();
			closed += 1;
		}));
		return closed;
	}
	/** Close and forget every owned session. */
	async dispose() {
		const all = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(all.map((session) => session.close()));
	}
};
/** Output contract shared by every browser tool. */
const TEXT_OUTPUT = {
	schema: {
		type: "object",
		additionalProperties: false,
		properties: { text: { type: "string" } },
		required: ["text"]
	},
	render: (_args, value) => [{
		type: "text",
		text: value.text
	}]
};
/** Explicit JSON Schema object root: empty parameter objects get serialized as
* `{ type: null }` by the DeepSeek adapter and rejected (400), so every tool
* declares `type: 'object'` explicitly. */
const OBJECT_SCHEMA = {
	type: "object",
	additionalProperties: false
};
/** Owner session id for one tool execution. */
function ownerSessionId(exec) {
	return exec.agent?.sessionId ?? "default";
}
/** Sanitize a session id into a safe profile directory name. */
function profileDirFor(sessionId) {
	const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return `${PROFILE_ROOT}/${safe}`;
}
/**
* Register the browser tools on `ctx.tools`, all backed by one registry.
* @param ctx - Cordis context with the tools service.
* @param registry - the shared per-session browser registry.
* @param options - resolved tool budgets.
*/
function registerBrowserTools(ctx, registry, options) {
	for (const tool of defineTools(registry, options)) ctx.tools.register(tool);
}
/** Define the full tool set; model-perspective contracts only. */
function defineTools(registry, options) {
	/** Last full snapshot per owner session, for delta mode. */
	const lastSnapshots = /* @__PURE__ */ new Map();
	const sessionFor = async (exec) => {
		const sessionId = ownerSessionId(exec);
		const session = registry.get(sessionId);
		if (!session.isOpen) await session.open(profileDirFor(sessionId));
		session.touch();
		return session;
	};
	const snapshotText = async (session, exec, delta) => {
		const sessionId = ownerSessionId(exec);
		const snapshot = await collectSnapshot(session.page, options.maxInteractiveItems);
		if (delta) {
			const previous = lastSnapshots.get(sessionId);
			lastSnapshots.set(sessionId, snapshot);
			if (previous === void 0) return renderSnapshot(snapshot, options.snapshotMaxChars);
			return diffSnapshot(previous, snapshot);
		}
		lastSnapshots.set(sessionId, snapshot);
		return renderSnapshot(snapshot, options.snapshotMaxChars);
	};
	return [
		{
			name: "browser_open",
			description: "Open the browser for this conversation (idempotent). Returns the current page URL and title, or \"new tab\" state.",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				const session = await sessionFor(exec);
				return { text: session.page === void 0 ? "Browser opened (new tab)." : `Browser ready: ${session.url}` };
			}
		},
		{
			name: "browser_navigate",
			description: "Navigate the browser to an absolute http(s) URL and wait for the page to load.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { url: {
					type: "string",
					description: "Absolute http(s) URL"
				} },
				required: ["url"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				await session.navigate(args.url);
				return { text: `Navigated to ${session.url}` };
			}
		},
		{
			name: "browser_snapshot",
			description: "Read the current page as a numbered interactive inventory (non-multimodal observation). Elements are addressed by [index] in other tools. delta=true returns only what changed since the last snapshot (cheap; first call returns the full inventory). Use after every action that may change the page.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { delta: {
					type: "boolean",
					description: "Only output changes since the last snapshot; defaults to false"
				} }
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				return { text: await snapshotText(session, exec, args.delta === true) };
			}
		},
		{
			name: "browser_click",
			description: "Click the element at [index] from the latest snapshot. Stale indexes return a fresh snapshot; retry from it.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { index: {
					type: "number",
					description: "Element index from the latest snapshot"
				} },
				required: ["index"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				try {
					await click(session.page, args.index, options.maxInteractiveItems);
					await waitStable(session.page);
				} catch (error) {
					return { text: error instanceof Error ? `Click failed: ${error.message}` : "Click failed." };
				}
				return { text: `Clicked [${args.index}].\n${await snapshotText(session, exec, false)}` };
			}
		},
		{
			name: "browser_type",
			description: "Type text into the element at [index]. replace=true clears first; replace=false appends (works for controlled inputs).",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					index: {
						type: "number",
						description: "Element index from the latest snapshot"
					},
					text: {
						type: "string",
						description: "Text to enter"
					},
					replace: {
						type: "boolean",
						description: "Clear before typing; defaults to false"
					}
				},
				required: ["index", "text"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				try {
					await typeText(session.page, args.index, args.text, args.replace === true, options.maxInteractiveItems);
				} catch (error) {
					return { text: error instanceof Error ? `Type failed: ${error.message}` : "Type failed." };
				}
				return { text: `Typed into [${args.index}].\n${await snapshotText(session, exec, false)}` };
			}
		},
		{
			name: "browser_press",
			description: "Press a keyboard key on the element at [index]: Enter, Tab, Escape, ArrowUp, ArrowDown, Backspace, etc.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					index: {
						type: "number",
						description: "Element index from the latest snapshot"
					},
					key: {
						type: "string",
						description: "Key name, e.g. Enter / Tab / Escape / ArrowDown"
					}
				},
				required: ["index", "key"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				try {
					await press(session.page, args.index, args.key, options.maxInteractiveItems);
				} catch (error) {
					return { text: error instanceof Error ? `Press failed: ${error.message}` : "Press failed." };
				}
				return { text: `Pressed ${args.key} on [${args.index}].\n${await snapshotText(session, exec, false)}` };
			}
		},
		{
			name: "browser_scroll",
			description: "Scroll the viewport (direction: up/down/top/bottom) or bring the element at [index] into view.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					index: {
						type: "number",
						description: "Element index to reveal; omit to scroll the viewport"
					},
					direction: {
						type: "string",
						description: "up | down | top | bottom; default down"
					}
				}
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				await scroll(session.page, args.index, args.direction, options.maxInteractiveItems);
				return { text: await snapshotText(session, exec, false) };
			}
		},
		{
			name: "browser_wait",
			description: "Wait for the page to settle (network idle + stability pause). Use before snapshotting after heavy interactions.",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				await waitStable((await sessionFor(exec)).page);
				return { text: "Page settled." };
			}
		},
		{
			name: "browser_eval",
			description: "Run a JavaScript expression in the page and return its JSON value. Advanced; prefer dedicated tools. Result capped at 4000 characters.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { expression: {
					type: "string",
					description: "JavaScript expression; must be JSON-serializable"
				} },
				required: ["expression"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const value = await (await sessionFor(exec)).page.evaluate(args.expression);
				const text = JSON.stringify(value, null, 2);
				return { text: text.length > 4e3 ? `${text.slice(0, 4e3)}… (truncated)` : text };
			}
		},
		...[
			"back",
			"forward",
			"reload"
		].map((action) => ({
			name: `browser_${action}`,
			description: `Navigate ${action} in the browser history${action === "reload" ? " (reload the current page)" : ""}.`,
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				const session = await sessionFor(exec);
				const page = session.page;
				if (action === "back") await page.goBack({
					waitUntil: "load",
					timeout: 3e4
				}).catch(() => null);
				else if (action === "forward") await page.goForward({
					waitUntil: "load",
					timeout: 3e4
				}).catch(() => null);
				else await page.reload({
					waitUntil: "load",
					timeout: 3e4
				});
				await waitStable(page);
				return { text: `${action} done.\n${await snapshotText(session, exec, false)}` };
			}
		})),
		{
			name: "browser_new_tab",
			description: "Open a new tab and activate it (about:blank). Use before navigating to a fresh page.",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				await (await sessionFor(exec)).newTab();
				return { text: "New tab opened." };
			}
		},
		{
			name: "browser_tabs",
			description: "List the open tabs (index, URL, active flag).",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				const lines = (await sessionFor(exec)).tabs.map((tab) => `[${tab.index}] ${tab.active ? "*" : " "} ${tab.url}`);
				return { text: lines.length === 0 ? "No tabs." : lines.join("\n") };
			}
		},
		{
			name: "browser_switch",
			description: "Activate the tab at [index] (0-based, from browser_tabs).",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { index: {
					type: "number",
					description: "Tab index from browser_tabs (0-based)"
				} },
				required: ["index"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				try {
					await session.switchTab(args.index);
				} catch (error) {
					return { text: error instanceof Error ? `Switch failed: ${error.message}` : "Switch failed." };
				}
				return { text: `Switched to tab [${args.index}].\n${await snapshotText(session, exec, false)}` };
			}
		},
		{
			name: "browser_close_tab",
			description: "Close the tab at [index] (0-based). The last tab cannot be closed; use browser_close to end the session.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { index: {
					type: "number",
					description: "Tab index from browser_tabs (0-based)"
				} },
				required: ["index"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				try {
					await session.closeTab(args.index);
				} catch (error) {
					return { text: error instanceof Error ? `Close failed: ${error.message}` : "Close failed." };
				}
				return { text: `Tab [${args.index}] closed.` };
			}
		},
		{
			name: "browser_close",
			description: "Close the browser for this conversation and free its resources. Idempotent.",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				await registry.get(ownerSessionId(exec)).close();
				return { text: "Browser closed." };
			}
		},
		{
			name: "browser_wait_selector",
			description: "Wait until an element matching a CSS selector appears, disappears, or is visible on the current page. Use before snapshotting after navigation or async UI updates.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					selector: {
						type: "string",
						description: "CSS selector to wait for, e.g. \"button[data-testid=\\\"submit\\\"]\""
					},
					state: {
						type: "string",
						description: "attached | detached | visible | hidden; defaults to visible"
					},
					timeoutMs: {
						type: "number",
						description: "Max wait in ms; defaults to 10000"
					}
				},
				required: ["selector"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				const selector = args.selector;
				const state = args.state ?? "visible";
				const timeoutMs = args.timeoutMs ?? 1e4;
				const states = [
					"attached",
					"detached",
					"visible",
					"hidden"
				];
				if (!states.includes(state)) return { text: `Invalid state "${state}"; expected ${states.join(" | ")}.` };
				try {
					await session.page.waitForSelector(selector, {
						state,
						timeout: timeoutMs
					});
					return { text: `Selector "${selector}" ${state}.` };
				} catch (error) {
					return { text: error instanceof Error ? `Wait failed: ${error.message}` : "Wait failed." };
				}
			}
		},
		{
			name: "browser_console",
			description: "Read recent console messages from the current page (errors, warnings, info, debug). Useful for diagnosing page failures. Optionally clear=false to keep the buffer; use clear=true to reset after reading.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					clear: {
						type: "boolean",
						description: "Clear the console buffer after reading; defaults to true"
					},
					limit: {
						type: "number",
						description: "Max messages to return; defaults to 50"
					}
				}
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				const limit = Math.max(1, Math.min(200, args.limit ?? 50));
				const entries = session.consoleLog.slice(-limit).reverse();
				if (entries.length === 0) return { text: "No console messages recorded." };
				const lines = entries.map((entry) => `[${entry.type}] ${entry.url}\n  ${entry.text}`);
				if (args.clear === true) session.clearConsole();
				return { text: lines.join("\n") };
			}
		},
		{
			name: "browser_dialogs",
			description: "List pending page dialogs (alert/confirm/prompt) waiting for a decision. Respond with browser_dialog_respond.",
			parameters: OBJECT_SCHEMA,
			output: TEXT_OUTPUT,
			async execute(_args, exec) {
				const dialogs = (await sessionFor(exec)).pendingDialogs;
				if (dialogs.length === 0) return { text: "No pending dialogs." };
				return { text: dialogs.map((dialog) => `[${dialog.id}] ${dialog.type}: ${dialog.message}`).join("\n") };
			}
		},
		{
			name: "browser_dialog_respond",
			description: "Respond to a pending dialog from browser_dialogs: accept (optionally with text for prompt) or dismiss.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: {
						type: "number",
						description: "Dialog id from browser_dialogs"
					},
					accept: {
						type: "boolean",
						description: "true = accept/OK; false = dismiss/Cancel; defaults to true"
					},
					text: {
						type: "string",
						description: "Text to submit for prompt dialogs"
					}
				},
				required: ["id"]
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				const id = args.id;
				const accept = args.accept !== false;
				try {
					await session.respondDialog(id, accept, args.text);
					return { text: `Dialog [${id}] ${accept ? "accepted" : "dismissed"}.` };
				} catch (error) {
					return { text: error instanceof Error ? `Respond failed: ${error.message}` : "Respond failed." };
				}
			}
		},
		{
			name: "browser_downloads",
			description: "List files downloaded by the current page (most recent first), with local paths when available.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { limit: {
					type: "number",
					description: "Max downloads to list; defaults to 10"
				} }
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				const limit = Math.max(1, Math.min(50, args.limit ?? 10));
				const downloads = session.downloadList.slice(0, limit);
				if (downloads.length === 0) return { text: "No downloads recorded." };
				return { text: downloads.map((item) => `[${item.id}] ${item.filename}${item.path === void 0 ? "" : ` → ${item.path}`}`).join("\n") };
			}
		},
		...options.vision === void 0 ? [] : [{
			name: "browser_vision",
			description: "Ask the configured vision model to describe the current page frame (opt-in bridge; the page screenshot enters the model context for this call only).",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: { prompt: {
					type: "string",
					description: "What to ask about the page; defaults to a general description"
				} }
			},
			output: TEXT_OUTPUT,
			async execute(args, exec) {
				const session = await sessionFor(exec);
				const prompt = args.prompt ?? "Describe what is visible on this web page, including the page purpose and key UI elements.";
				try {
					return { text: await describeFrame(session.page, options.vision, prompt) };
				} catch (error) {
					return { text: error instanceof Error ? `Vision failed: ${error.message}` : "Vision failed." };
				}
			}
		}]
	];
}
//#endregion
//#region lib/types/screencast.js
/**
* CDP screencast pump: streams JPEG frames from the browser's page to a
* per-session frame cache the panel polls over HTTP. Frames are human-visible
* only — they never enter model context.
*
* Headless Chromium only serves screencast frames for the foreground target,
* so exactly one subscription is active at a time: tab switches stop the old
* page's screencast and start the new active page's (via the session's
* per-page CDP session cache). `bringToFront` in the session keeps the newly
* active page compositing so frames flow again.
* @module @dsh-external/dsh-browser-panel/screencast
*/
/** Retains the latest screencast frame per session. */
var FrameCache = class {
	frames = /* @__PURE__ */ new Map();
	/** Store the latest frame for `sessionId`. */
	set(sessionId, jpegBase64) {
		this.frames.set(sessionId, jpegBase64);
	}
	/** The latest frame for `sessionId`, if any. */
	get(sessionId) {
		return this.frames.get(sessionId);
	}
	/** Drop a session's frame when its browser closes. */
	drop(sessionId) {
		this.frames.delete(sessionId);
	}
};
/** One active CDP screencast subscription feeding a {@link FrameCache}. */
var ScreencastPump = class {
	session;
	cache;
	sessionId;
	options;
	cdp;
	handler;
	started = false;
	unlisten;
	restarting = false;
	/** Last frame written to the cache; duplicate CDP frames are skipped. */
	lastFrame;
	/** Frame from the previously active page; dropped after a tab switch. */
	staleFrame;
	/**
	* @param session - the browser session to pump frames from.
	* @param cache - shared frame cache to write into.
	* @param sessionId - cache key for this session.
	* @param options - frame budget.
	*/
	constructor(session, cache, sessionId, options) {
		this.session = session;
		this.cache = cache;
		this.sessionId = sessionId;
		this.options = options;
	}
	/**
	* Begin pumping frames. Idempotent; no-op while already started. Subscribes
	* to session tab changes so the CDP subscription follows the active tab:
	* switching tabs rebuilds the screencast on the newly active page.
	*/
	async start() {
		if (this.started) return;
		this.started = true;
		await this.attach();
		this.unlisten = this.session.onTabChange(() => {
			this.restart().catch(() => {});
		});
	}
	/** Stop pumping frames. Idempotent. */
	async stop() {
		if (!this.started) return;
		this.started = false;
		this.unlisten?.();
		this.unlisten = void 0;
		await this.detach();
	}
	/**
	* Re-create the CDP subscription on the currently active page. The new
	* subscription may emit a stale frame from the previous page before the new
	* target starts compositing; such frames are dropped, and a forced screenshot
	* is taken so the panel always shows the active tab.
	*/
	async restart() {
		if (this.restarting || !this.started) return;
		this.restarting = true;
		try {
			this.staleFrame = this.lastFrame;
			await this.detach();
			await this.attach();
			await this.capture();
		} finally {
			this.restarting = false;
		}
	}
	/** Attach the screencast subscription to the active page. */
	async attach() {
		const page = this.session.page;
		if (page === void 0) return;
		const cdp = await this.session.cdpSessionFor(page);
		this.cdp = cdp;
		const handler = ({ data, sessionId }) => {
			if (data !== this.lastFrame && data !== this.staleFrame) {
				this.lastFrame = data;
				this.staleFrame = void 0;
				this.cache.set(this.sessionId, data);
			}
			cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
		};
		this.handler = handler;
		cdp.on("Page.screencastFrame", handler);
		await cdp.send("Page.enable");
		await cdp.send("Page.startScreencast", {
			format: "jpeg",
			quality: this.options.quality,
			everyNthFrame: this.options.fps >= 4 ? 1 : 2,
			maxWidth: 960,
			maxHeight: 600
		});
	}
	/** Capture one fresh JPEG of the active page into the cache. Best-effort. */
	async capture() {
		const page = this.session.page;
		if (page === void 0) return;
		try {
			const b64 = (await page.screenshot({
				type: "jpeg",
				quality: this.options.quality
			})).toString("base64");
			this.lastFrame = b64;
			this.cache.set(this.sessionId, b64);
		} catch {}
	}
	/** Tear down the current CDP screencast subscription, if any. */
	async detach() {
		const cdp = this.cdp;
		this.cdp = void 0;
		if (cdp !== void 0) {
			const handler = this.handler;
			this.handler = void 0;
			if (handler !== void 0) cdp.off("Page.screencastFrame", handler);
			await cdp.send("Page.stopScreencast").catch(() => {});
		}
	}
};
//#endregion
//#region lib/types/pick.js
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
	if (element === null) return null;
	const rect = element.getBoundingClientRect();
	const selector = (() => {
		if (element.id !== "") return `#${CSS.escape(element.id)}`;
		const tag = element.tagName.toLowerCase();
		const classes = [...element.classList].slice(0, 5).map((c) => `.${CSS.escape(c)}`).join("");
		if (classes !== "") return `${tag}${classes}`;
		const parts = [];
		let node = element;
		let depth = 0;
		while (node !== null && node !== document.documentElement && depth < 4) {
			const parent = node.parentElement;
			const current = node;
			const position = parent === null ? 1 : [...parent.children].filter((c) => c.tagName === current.tagName).indexOf(current) + 1;
			parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`);
			node = parent;
			depth += 1;
		}
		return parts.join(" > ");
	})();
	return {
		tag: element.tagName.toLowerCase(),
		id: element.id === "" ? void 0 : element.id,
		classes: [...element.classList].slice(0, 5),
		selector,
		text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
		rect: {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height
		},
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight
		}
	};
};
/** Run inside the page: locate the element and extract its key styles. */
const CSS_SCRIPT = ({ xRatio, yRatio }) => {
	const STYLE_KEYS = [
		"display",
		"position",
		"width",
		"height",
		"margin",
		"padding",
		"color",
		"background-color",
		"font-size",
		"font-weight",
		"font-family",
		"line-height",
		"text-align",
		"border",
		"border-radius",
		"box-shadow",
		"flex",
		"flex-direction",
		"gap",
		"justify-content",
		"align-items",
		"overflow",
		"z-index",
		"opacity",
		"cursor",
		"transition",
		"transform"
	];
	const x = Math.round(xRatio * window.innerWidth);
	const y = Math.round(yRatio * window.innerHeight);
	const element = document.elementFromPoint(x, y);
	if (element === null) return null;
	const rect = element.getBoundingClientRect();
	const selector = (() => {
		if (element.id !== "") return `#${CSS.escape(element.id)}`;
		const tag = element.tagName.toLowerCase();
		const classes = [...element.classList].slice(0, 5).map((c) => `.${CSS.escape(c)}`).join("");
		if (classes !== "") return `${tag}${classes}`;
		const parts = [];
		let node = element;
		let depth = 0;
		while (node !== null && node !== document.documentElement && depth < 4) {
			const parent = node.parentElement;
			const current = node;
			const position = parent === null ? 1 : [...parent.children].filter((c) => c.tagName === current.tagName).indexOf(current) + 1;
			parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${position})`);
			node = parent;
			depth += 1;
		}
		return parts.join(" > ");
	})();
	const computed = getComputedStyle(element);
	const styles = {};
	for (const key of STYLE_KEYS) {
		const value = computed.getPropertyValue(key);
		if (value !== "" && value !== "none" && value !== "auto" && value !== "0px" && value !== "normal") styles[key] = value;
	}
	return {
		tag: element.tagName.toLowerCase(),
		id: element.id === "" ? void 0 : element.id,
		classes: [...element.classList].slice(0, 5),
		selector,
		text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
		rect: {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height
		},
		viewport: {
			width: window.innerWidth,
			height: window.innerHeight
		},
		styles
	};
};
/**
* Describe the element at normalized viewport coordinates.
* @param page - the active Playwright page.
* @param xRatio - 0..1 fraction of viewport width.
* @param yRatio - 0..1 fraction of viewport height.
*/
async function pickElement(page, xRatio, yRatio) {
	return await page.evaluate(PICK_SCRIPT, {
		xRatio,
		yRatio
	});
}
/**
* Extract the element's stable selector and key computed styles.
* @param page - the active Playwright page.
* @param xRatio - 0..1 fraction of viewport width.
* @param yRatio - 0..1 fraction of viewport height.
*/
async function extractCss(page, xRatio, yRatio) {
	return await page.evaluate(CSS_SCRIPT, {
		xRatio,
		yRatio
	});
}
/** Render an extraction as a copy-paste-friendly CSS block. */
function renderCssBlock(extraction) {
	const lines = [`/* ${extraction.tag}${extraction.id !== void 0 ? `#${extraction.id}` : ""} — ${extraction.text || "no text"} */`, `${extraction.selector} {`];
	for (const [key, value] of Object.entries(extraction.styles)) lines.push(`  ${key}: ${value};`);
	lines.push("}");
	return lines.join("\n");
}
//#endregion
//#region lib/types/index.js
/**
* `@dsh-external/dsh-browser-panel`: WebUI-embedded headed browser for the
* model and the user. The host half owns one Playwright Chromium per owner
* session, registers the text-only `browser_*` tool set (non-multimodal
* control: numbered accessibility-style snapshots, index addressing, atomic
* actions), and serves a per-session JPEG frame cache the client panel polls
* for the live view. Screenshots are human-visible only and never enter model
* context.
*
* Standalone repo convention: no SDK dependency; the minimal service
* interfaces below are supplied by the host Harness at runtime.
* @module @dsh-external/dsh-browser-panel
*/
/** Persistent profile dir for a host-opened session. */
function profileDirForHost(sessionId) {
	const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
	return join(PROFILE_ROOT, safe);
}
/** Cordis plugin name used by loader diagnostics. */
const name = "browser-panel";
/** Services required by this plugin. */
const inject = ["httpServer", "tools"];
const Config = z.object({
	toolTimeoutMs: z.number().default(6e4),
	snapshotMaxChars: z.number().default(12e3),
	maxInteractiveItems: z.number().default(60),
	screencastFps: z.number().default(4),
	screencastQuality: z.number().default(70),
	idleTimeoutMs: z.number().default(0),
	vision: z.object({
		endpoint: z.string(),
		apiKey: z.string(),
		model: z.string()
	})
});
/** Parse the `session` query parameter; empty when absent. */
function sessionParam(url) {
	if (url === void 0) return "";
	const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
	for (const pair of query.split("&")) {
		const [key, value] = pair.split("=");
		if (key === "session") return decodeURIComponent(value ?? "");
	}
	return "";
}
/** Parse a normalized 0..1 coordinate query parameter; NaN when absent. */
function ratioParam(url, key) {
	if (url === void 0) return NaN;
	const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
	for (const pair of query.split("&")) {
		const [name, value] = pair.split("=");
		if (name === key) return Number(decodeURIComponent(value ?? ""));
	}
	return NaN;
}
/** Register the host half: tools, state/frame routes, and teardown. */
function apply(ctx, config) {
	const resolved = config;
	const registry = new BrowserSessionRegistry();
	const cache = new FrameCache();
	const pumps = /* @__PURE__ */ new Map();
	/** Start the frame pump for a session once its browser exists; no-op otherwise. */
	const ensurePump = async (sessionId) => {
		if (pumps.has(sessionId)) return;
		const session = registry.get(sessionId);
		if (!session.isOpen) return;
		const pump = new ScreencastPump(session, cache, sessionId, {
			fps: resolved.screencastFps,
			quality: resolved.screencastQuality
		});
		pumps.set(sessionId, pump);
		await pump.start().catch(() => pumps.delete(sessionId));
	};
	registerBrowserTools(ctx, registry, {
		toolTimeoutMs: resolved.toolTimeoutMs,
		snapshotMaxChars: resolved.snapshotMaxChars,
		maxInteractiveItems: resolved.maxInteractiveItems,
		vision: resolved.vision
	});
	/** 路由注册挂 effect：热重载/卸载时自动注销（否则旧 fiber 路由残留导致 duplicate route）。 */
	const registerRoute = (route) => {
		ctx.effect(() => ctx.httpServer.register(route), "browser-panel:route");
	};
	registerRoute({
		kind: "exact",
		path: PANEL_ROUTE,
		async handler(req, res) {
			const sessionId = sessionParam(req.url);
			const session = registry.get(sessionId);
			const payload = JSON.stringify({
				sessionId,
				open: session.isOpen,
				url: session.url,
				title: session.isOpen ? await session.title() : void 0,
				tabs: session.isOpen ? session.tabs : [],
				dialogs: session.pendingDialogs.length
			});
			res.writeHead(200, { "content-type": "application/json" });
			res.end(payload);
		}
	});
	registerRoute({
		kind: "exact",
		path: PANEL_STREAM_PATH,
		async handler(req, res) {
			const sessionId = sessionParam(req.url);
			await ensurePump(sessionId);
			const frame = cache.get(sessionId);
			if (frame === void 0) {
				res.writeHead(204);
				res.end();
				return;
			}
			res.writeHead(200, {
				"content-type": "image/jpeg",
				"cache-control": "no-store"
			});
			res.end(Buffer.from(frame, "base64"));
		}
	});
	/** Shared handler for pick/css: resolve the session, then run the page script. */
	const coordinateHandler = async (req, res, kind) => {
		const sessionId = sessionParam(req.url);
		const xRatio = ratioParam(req.url, "x");
		const yRatio = ratioParam(req.url, "y");
		if (sessionId === "" || !Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
			res.writeHead(400, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "session, x, and y query parameters are required" }));
			return;
		}
		const session = registry.get(sessionId);
		if (!session.isOpen || session.page === void 0) {
			res.writeHead(409, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "browser not open" }));
			return;
		}
		const result = kind === "pick" ? await pickElement(session.page, xRatio, yRatio) : await extractCss(session.page, xRatio, yRatio);
		if (result === null) {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "no element at coordinates" }));
			return;
		}
		const payload = kind === "css" ? {
			...result,
			block: renderCssBlock(result)
		} : result;
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify(payload));
	};
	registerRoute({
		kind: "exact",
		path: `${PANEL_ROUTE}/tab`,
		async handler(req, res) {
			const sessionId = sessionParam(req.url);
			const rawAction = (() => {
				if (req.url === void 0) return "";
				const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
				for (const pair of query.split("&")) {
					const [key, value] = pair.split("=");
					if (key === "action") return decodeURIComponent(value ?? "");
				}
				return "";
			})();
			if (sessionId === "" || ![
				"new",
				"refresh",
				"close",
				"switch"
			].includes(rawAction)) {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "session and action (new|refresh|close|switch) query parameters are required" }));
				return;
			}
			const session = registry.get(sessionId);
			if (!session.isOpen || session.page === void 0) {
				res.writeHead(409, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "browser not open" }));
				return;
			}
			const rawIndex = Number(ratioParam(req.url, "index"));
			try {
				if (rawAction === "new") await session.newTab();
				else if (rawAction === "refresh") await session.page.reload({
					waitUntil: "load",
					timeout: 3e4
				});
				else if (rawAction === "switch") {
					const index = Number.isFinite(rawIndex) ? Math.round(rawIndex) : session.tabs.findIndex((tab) => tab.active);
					await session.switchTab(index);
				} else {
					const count = session.tabs.length;
					const index = Number.isFinite(rawIndex) ? Math.round(rawIndex) : session.tabs.findIndex((tab) => tab.active);
					if (count > 1) await session.closeTab(index >= 0 && index < count ? index : session.tabs.findIndex((tab) => tab.active));
				}
				session.touch();
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: true,
					tabs: session.tabs
				}));
			} catch (error) {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: error instanceof Error ? error.message : "tab action failed" }));
			}
		}
	});
	registerRoute({
		kind: "exact",
		path: `${PANEL_ROUTE}/pick`,
		handler(req, res) {
			return coordinateHandler(req, res, "pick");
		}
	});
	registerRoute({
		kind: "exact",
		path: `${PANEL_ROUTE}/css`,
		handler(req, res) {
			return coordinateHandler(req, res, "css");
		}
	});
	registerRoute({
		kind: "exact",
		path: `${PANEL_ROUTE}/open`,
		async handler(req, res) {
			const sessionId = sessionParam(req.url);
			if (sessionId === "") {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "session query parameter is required" }));
				return;
			}
			const session = registry.get(sessionId);
			if (!session.isOpen) await session.open(profileDirForHost(sessionId)).catch((error) => {
				res.writeHead(500, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: error instanceof Error ? error.message : "failed to open browser" }));
			});
			session.touch();
			await ensurePump(sessionId);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({
				ok: true,
				open: session.isOpen
			}));
		}
	});
	registerRoute({
		kind: "exact",
		path: `${PANEL_ROUTE}/close`,
		async handler(req, res) {
			const sessionId = sessionParam(req.url);
			const session = registry.get(sessionId);
			const pump = pumps.get(sessionId);
			if (pump !== void 0) {
				await pump.stop();
				pumps.delete(sessionId);
			}
			cache.drop(sessionId);
			await session.close();
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({
				ok: true,
				open: session.isOpen
			}));
		}
	});
	let idleTimer;
	if (resolved.idleTimeoutMs > 0) idleTimer = setInterval(() => {
		registry.closeIdle(resolved.idleTimeoutMs).then((closed) => {
			if (closed > 0) {
				for (const pump of pumps.values()) pump.stop();
				pumps.clear();
			}
		});
	}, Math.min(resolved.idleTimeoutMs, 6e4));
	ctx.effect(() => {
		const cleanup = () => {
			if (idleTimer !== void 0) clearInterval(idleTimer);
			for (const pump of pumps.values()) pump.stop();
			pumps.clear();
			registry.dispose();
		};
		return cleanup;
	}, "browser-panel.dispose");
}
//#endregion
export { Config, apply, inject, name };
