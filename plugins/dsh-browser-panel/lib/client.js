window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-browser-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
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
		/** No hard inject: sessions is fetched optionally so the fiber activates even
		* before the runtime provides it; polling retries until it appears. */
		const inject = [];
		const PANEL_ROUTE = typeof window !== "undefined" && window.location && window.location.protocol === "https:" ? `https://${window.location.host}/browser-panel` : "/browser-panel";
		const PANEL_STREAM_PATH = "/browser-panel/stream";
		const POLL_MS = 500;
		const css = `
#root{margin-right:var(--dsh-browser-panel-width,0px);transition:margin-right var(--ds-transition-duration-slow,200ms) var(--ds-ease-in-out,ease)}
body[data-dsh-browser-dragging] #root{transition:none}
#dsh-browser-panel{position:fixed;top:0;right:0;bottom:0;width:var(--dsh-browser-panel-width,0px);min-width:280px;max-width:720px;z-index:1000;overflow:hidden;display:grid;grid-template-rows:44px auto minmax(0,1fr) auto 30px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#171719);border-left:1px solid var(--dsw-alias-border-l2,#0000001a)}
#dsh-browser-panel[hidden]{display:none}
.bp-resizer{position:absolute;z-index:2;inset:0 auto 0 -5px;width:12px;cursor:col-resize;touch-action:none}
.bp-resizer::after{content:"";position:absolute;inset:0 auto 0 5px;width:1px;background:transparent}
.bp-resizer:hover::after,.bp-resizer[data-dragging="true"]::after{background:var(--dsw-alias-state-business-primary,#3978ff)}
.bp-head{display:flex;align-items:center;gap:6px;padding:0 10px;border-bottom:1px solid var(--dsw-alias-border-l1,#0000000a)}
.bp-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}
.bp-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-error-primary,#d73535)}
.bp-dot[data-open="true"]{background:var(--dsw-alias-state-success-primary,#168f55)}
.bp-btn{border:0;background:transparent;color:inherit;font-size:14px;cursor:pointer;padding:4px 7px;border-radius:6px}
.bp-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.bp-btn[data-active="true"]{background:var(--dsw-alias-state-business-tertiary,#c9dcff);color:var(--dsw-alias-state-business-primary,#3978ff)}
.bp-tabs{display:flex;gap:4px;overflow-x:auto;padding:4px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#0000000a);scrollbar-width:thin}
.bp-tabs[hidden]{display:none}
.bp-tab{flex:0 0 auto;max-width:160px;display:flex;align-items:center;gap:4px;padding:2px 6px;border-radius:6px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary,#555);border:1px solid transparent;overflow:hidden}
.bp-tab:hover{background:var(--dsw-alias-interactive-bg-hover,#0000000f)}
.bp-tab[data-active="true"]{background:var(--dsw-alias-state-business-tertiary,#c9dcff);color:var(--dsw-alias-state-business-primary,#3978ff)}
.bp-tab .bp-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp-tab .bp-tab-x{flex:none;font-size:10px;padding:0 2px;border-radius:4px}
.bp-tab .bp-tab-x:hover{background:var(--dsw-alias-state-error-tertiary,#ffd9d9);color:var(--dsw-alias-state-error-primary,#d73535)}
.bp-stage{position:relative;min-height:0;overflow:hidden;display:grid;place-items:center;background:#f2f3f5;cursor:default}
.bp-stage[data-picking="true"]{cursor:crosshair}
.bp-frame{position:relative;max-width:100%;max-height:100%}
.bp-frame img{max-width:100%;max-height:100%;object-fit:contain;display:block;pointer-events:none}
.bp-overlay{position:absolute;border:2px solid #3978ff;background:#3978ff22;pointer-events:none;display:none}
.bp-empty{color:var(--dsw-alias-label-tertiary,#777);font-size:12px;text-align:center;padding:16px}
.bp-card{border-top:1px solid var(--dsw-alias-border-l1,#0000000a);padding:10px 12px;display:grid;gap:8px;max-height:200px;overflow:auto}
.bp-card[hidden]{display:none}
.bp-card pre{margin:0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f7f7f8);font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.bp-card-actions{display:flex;gap:8px}
.bp-add{border:0;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;background:var(--dsw-alias-state-business-primary,#3978ff);color:#fff}
.bp-add:hover{filter:brightness(1.1)}
.bp-drop{border:0;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;background:var(--dsw-alias-interactive-bg-hover,#0000000f);color:inherit}
.bp-foot{display:flex;align-items:center;gap:6px;padding:0 12px;font-size:11px;color:var(--dsw-alias-label-secondary,#555);border-top:1px solid var(--dsw-alias-border-l1,#0000000a);overflow:hidden}
.bp-url{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp-hint{color:var(--dsw-alias-label-tertiary,#777)}
/* sidebar-tab 模式（better-sidebar 强兼）：填充宿主容器，非 fixed dock */
#dsh-browser-panel[data-mode="tab"]{position:absolute;inset:0;width:100%;min-width:0;max-width:none;height:100%;border-left:0}
#dsh-browser-panel[data-mode="tab"] .bp-resizer{display:none}
`;
		/** Map a pick result's viewport rect onto the displayed frame rect. */
		function mapRect(picked, frame) {
			const stage = frame.parentElement;
			const scale = Math.min(stage.clientWidth / picked.viewport.width, stage.clientHeight / picked.viewport.height);
			const offsetX = (stage.clientWidth - picked.viewport.width * scale) / 2;
			const offsetY = (stage.clientHeight - picked.viewport.height * scale) / 2;
			return {
				left: offsetX + picked.rect.x * scale,
				top: offsetY + picked.rect.y * scale,
				width: picked.rect.width * scale,
				height: picked.rect.height * scale
			};
		}
		/** Insert text into the WebUI composer (React-controlled textarea safe). */
		function insertIntoComposer(text) {
			const textarea = document.querySelector("textarea:not([aria-hidden=\"true\"])");
			if (textarea === null) return false;
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
			if (setter === void 0) return false;
			const prefix = textarea.value === "" ? "" : `${textarea.value}\n\n`;
			setter.call(textarea, `${prefix}${text}`);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			textarea.focus();
			return true;
		}
		/** Build the panel DOM subtree. */
		function buildPanel(ctx, mode) {
			const widthKey = "dsh.browser-panel.width";
			const defaultWidth = 420;
			const storedWidth = Number.parseInt(localStorage.getItem(widthKey) ?? "", 10);
			const panelWidth = Number.isFinite(storedWidth) ? Math.min(720, Math.max(280, storedWidth)) : defaultWidth;
			const root = document.createElement("div");
			root.id = "dsh-browser-panel";
			root.dataset.mode = mode;
			let currentWidth = panelWidth;
			const setPanelVisible = (visible) => {
				root.hidden = !visible;
				document.documentElement.style.setProperty("--dsh-browser-panel-width", `${visible ? currentWidth : 0}px`);
			};
			if (mode !== "tab") setPanelVisible(false);
			const resizer = document.createElement("div");
			resizer.className = "bp-resizer";
			resizer.setAttribute("role", "separator");
			resizer.setAttribute("aria-label", "调整浏览器面板宽度");
			let startX = 0;
			let startWidth = panelWidth;
			const pointerMove = (event) => {
				const width = Math.min(720, Math.max(280, startWidth + startX - event.clientX));
				document.documentElement.style.setProperty("--dsh-browser-panel-width", `${width}px`);
			};
			const pointerUp = (event) => {
				resizer.dataset.dragging = "false";
				document.body.dataset.dshBrowserDragging = "false";
				resizer.releasePointerCapture?.(event.pointerId);
				const width = Math.min(720, Math.max(280, startWidth + startX - event.clientX));
				currentWidth = width;
				localStorage.setItem(widthKey, String(width));
				window.removeEventListener("pointermove", pointerMove);
				window.removeEventListener("pointerup", pointerUp);
			};
			resizer.onpointerdown = (event) => {
				startX = event.clientX;
				startWidth = Number.parseInt(document.documentElement.style.getPropertyValue("--dsh-browser-panel-width") || String(panelWidth), 10);
				resizer.dataset.dragging = "true";
				document.body.dataset.dshBrowserDragging = "true";
				resizer.setPointerCapture?.(event.pointerId);
				window.addEventListener("pointermove", pointerMove);
				window.addEventListener("pointerup", pointerUp);
			};
			resizer.ondblclick = () => {
				currentWidth = defaultWidth;
				document.documentElement.style.setProperty("--dsh-browser-panel-width", `${defaultWidth}px`);
				localStorage.setItem(widthKey, String(defaultWidth));
			};
			const head = document.createElement("div");
			head.className = "bp-head";
			const dot = document.createElement("span");
			dot.className = "bp-dot";
			dot.dataset.open = "false";
			const title = document.createElement("span");
			title.className = "bp-title";
			title.textContent = "Browser";
			const sessionOf = () => {
				return ctx.get("sessions")?.list?.current;
			};
			const tabAction = (action) => {
				const sessionId = sessionOf();
				if (sessionId === void 0) return;
				fetch(`${PANEL_ROUTE}/tab?session=${encodeURIComponent(sessionId)}&action=${action}`, { cache: "no-store" }).catch(() => {});
			};
			const newTabBtn = document.createElement("button");
			newTabBtn.className = "bp-btn";
			newTabBtn.textContent = "➕";
			newTabBtn.title = "新建标签";
			newTabBtn.addEventListener("click", () => tabAction("new"));
			const refreshBtn = document.createElement("button");
			refreshBtn.className = "bp-btn";
			refreshBtn.textContent = "🔄";
			refreshBtn.title = "刷新当前页";
			refreshBtn.addEventListener("click", () => tabAction("refresh"));
			const closeTabBtn = document.createElement("button");
			closeTabBtn.className = "bp-btn";
			closeTabBtn.textContent = "🗑";
			closeTabBtn.title = "关闭当前标签";
			closeTabBtn.addEventListener("click", () => tabAction("close"));
			const pickBtn = document.createElement("button");
			pickBtn.className = "bp-btn";
			pickBtn.textContent = "🎯";
			pickBtn.title = "框选元素提取 CSS（前端开发模式）";
			const close = document.createElement("button");
			close.className = "bp-btn bp-close";
			close.textContent = "✕";
			close.title = "Hide browser panel";
			close.addEventListener("click", () => {
				setPanelVisible(false);
			});
			const openCloseBtn = document.createElement("button");
			openCloseBtn.className = "bp-btn bp-open-close";
			openCloseBtn.textContent = "▶";
			openCloseBtn.title = "打开浏览器";
			openCloseBtn.addEventListener("click", () => {
				const sessionId = sessionOf();
				if (sessionId === void 0) return;
				const open = openCloseBtn.dataset.open === "true";
				fetch(`${PANEL_ROUTE}/${open ? "close" : "open"}?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" }).catch(() => {});
			});
			head.append(dot, title, openCloseBtn, newTabBtn, refreshBtn, closeTabBtn, pickBtn, close);
			const tabStrip = document.createElement("div");
			tabStrip.className = "bp-tabs";
			tabStrip.hidden = true;
			const renderTabs = (tabs) => {
				tabStrip.replaceChildren();
				for (const tab of tabs) {
					const item = document.createElement("div");
					item.className = "bp-tab";
					item.dataset.active = String(tab.active);
					const label = document.createElement("span");
					label.className = "bp-tab-label";
					const host = (() => {
						try {
							return new URL(tab.url).host;
						} catch {
							return tab.url;
						}
					})();
					label.textContent = host === "" ? "new tab" : host;
					label.title = tab.url;
					const x = document.createElement("span");
					x.className = "bp-tab-x";
					x.textContent = "×";
					x.title = "关闭标签";
					x.addEventListener("click", (event) => {
						event.stopPropagation();
						const sessionId = sessionOf();
						if (sessionId === void 0) return;
						fetch(`${PANEL_ROUTE}/tab?session=${encodeURIComponent(sessionId)}&action=close&index=${tab.index}`, { cache: "no-store" }).catch(() => {});
					});
					item.append(label, x);
					item.addEventListener("click", () => {
						if (tab.active) return;
						const sessionId = sessionOf();
						if (sessionId === void 0) return;
						fetch(`${PANEL_ROUTE}/tab?session=${encodeURIComponent(sessionId)}&action=switch&index=${tab.index}`, { cache: "no-store" }).catch(() => {});
					});
					tabStrip.append(item);
				}
				tabStrip.hidden = tabs.length <= 1;
			};
			const frame = document.createElement("div");
			frame.className = "bp-frame";
			const image = document.createElement("img");
			image.alt = "Live browser view";
			const overlay = document.createElement("div");
			overlay.className = "bp-overlay";
			frame.append(image, overlay);
			const empty = document.createElement("div");
			empty.className = "bp-empty";
			empty.textContent = "浏览器未打开 —— 让模型调用 browser_open 启动";
			const stage = document.createElement("div");
			stage.className = "bp-stage";
			stage.append(frame, empty);
			const card = document.createElement("div");
			card.className = "bp-card";
			card.hidden = true;
			const cardCode = document.createElement("pre");
			const actions = document.createElement("div");
			actions.className = "bp-card-actions";
			const addBtn = document.createElement("button");
			addBtn.className = "bp-add";
			addBtn.textContent = "➕ 添加到对话";
			const dropBtn = document.createElement("button");
			dropBtn.className = "bp-drop";
			dropBtn.textContent = "清除";
			dropBtn.addEventListener("click", () => {
				card.hidden = true;
				exitPick();
			});
			actions.append(addBtn, dropBtn);
			card.append(cardCode, actions);
			const foot = document.createElement("div");
			foot.className = "bp-foot";
			const urlLine = document.createElement("span");
			urlLine.className = "bp-url";
			const hint = document.createElement("span");
			hint.className = "bp-hint";
			hint.textContent = "🎯 框选元素";
			foot.append(urlLine, hint);
			root.append(resizer, head, tabStrip, stage, card, foot);
			let picking = false;
			let lastPick = null;
			const exitPick = () => {
				picking = false;
				stage.dataset.picking = "false";
				pickBtn.dataset.active = "false";
				overlay.style.display = "none";
				lastPick = null;
			};
			const coordsOf = (event) => {
				const rect = frame.getBoundingClientRect();
				if (rect.width === 0 || rect.height === 0) return null;
				return {
					x: (event.clientX - rect.left) / rect.width,
					y: (event.clientY - rect.top) / rect.height
				};
			};
			stage.addEventListener("mousemove", (event) => {
				if (!picking) return;
				const sessionId = sessionOf();
				const coords = coordsOf(event);
				if (sessionId === void 0 || coords === null) return;
				fetch(`${PANEL_ROUTE}/pick?session=${encodeURIComponent(sessionId)}&x=${coords.x}&y=${coords.y}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((picked) => {
					if (picked === null || !picking) {
						overlay.style.display = "none";
						return;
					}
					const mapped = mapRect(picked, frame);
					overlay.style.display = "block";
					overlay.style.left = `${mapped.left}px`;
					overlay.style.top = `${mapped.top}px`;
					overlay.style.width = `${mapped.width}px`;
					overlay.style.height = `${mapped.height}px`;
				}).catch(() => {});
			});
			stage.addEventListener("click", (event) => {
				if (!picking) return;
				const sessionId = sessionOf();
				const coords = coordsOf(event);
				if (sessionId === void 0 || coords === null) return;
				fetch(`${PANEL_ROUTE}/css?session=${encodeURIComponent(sessionId)}&x=${coords.x}&y=${coords.y}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => {
					if (result === null) return;
					lastPick = result;
					cardCode.textContent = result.block;
					card.hidden = false;
					addBtn.dataset.ready = "true";
				}).catch(() => {});
			});
			pickBtn.addEventListener("click", () => {
				if (picking) {
					exitPick();
					return;
				}
				picking = true;
				stage.dataset.picking = "true";
				pickBtn.dataset.active = "true";
			});
			addBtn.addEventListener("click", () => {
				if (lastPick === null) return;
				if (insertIntoComposer(`\`\`\`css\n${lastPick.block}\n\`\`\``)) {
					addBtn.textContent = "✅ 已添加";
					setTimeout(() => {
						addBtn.textContent = "➕ 添加到对话";
					}, 1500);
				}
			});
			return {
				root,
				image,
				dot,
				urlLine,
				empty,
				stage,
				frame,
				overlay,
				pickBtn,
				card,
				cardCode,
				addBtn,
				tabStrip,
				openCloseBtn,
				renderTabs,
				setPanelVisible
			};
		}
		/** Poll the frame cache for one session; no-op while the panel is hidden. */
		function startPolling(ctx, panel) {
			let stopped = false;
			let lastSession;
			const tick = async () => {
				if (stopped) return;
				const sessionId = ctx.get("sessions")?.list?.current;
				if (sessionId === void 0 || panel.root.hidden) {
					panel.image.hidden = true;
					panel.empty.hidden = false;
					panel.dot.dataset.open = "false";
					panel.openCloseBtn.dataset.open = "false";
					panel.openCloseBtn.textContent = "▶";
					panel.openCloseBtn.title = "打开浏览器";
					panel.urlLine.textContent = "";
					panel.tabStrip.hidden = true;
					setTimeout(tick, POLL_MS);
					return;
				}
				if (sessionId !== lastSession) {
					lastSession = sessionId;
					panel.setPanelVisible(true);
				}
				try {
					const frameResponse = await fetch(`${PANEL_STREAM_PATH}?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
					if (frameResponse.ok) {
						const blob = await frameResponse.blob();
						panel.image.src = URL.createObjectURL(blob);
						panel.image.hidden = false;
						panel.empty.hidden = true;
						panel.dot.dataset.open = "true";
					} else {
						panel.image.hidden = true;
						panel.empty.hidden = false;
						panel.dot.dataset.open = "false";
					}
					const state = await (await fetch(`${PANEL_ROUTE}?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" })).json();
					panel.urlLine.textContent = state.open ? state.title ?? state.url ?? "" : "browser closed";
					panel.openCloseBtn.dataset.open = String(state.open);
					panel.openCloseBtn.textContent = state.open ? "⏹" : "▶";
					panel.openCloseBtn.title = state.open ? "关闭浏览器" : "打开浏览器";
					panel.renderTabs(state.tabs ?? []);
				} catch {
					panel.dot.dataset.open = "false";
				}
				setTimeout(tick, POLL_MS);
			};
			tick();
			return () => {
				stopped = true;
			};
		}
		/** Mount the panel: sidebar tab when better-sidebar is present, else the classic dock. */
		function apply(ctx) {
			const style = document.createElement("style");
			style.textContent = css;
			document.head.append(style);
			const betterSidebar = ctx.get("betterSidebar");
			let panelRef = null;
			let stopPoll = null;
			let mounted = false;
			if (betterSidebar?.registerTab) betterSidebar.registerTab({
				id: "browser:web",
				title: "浏览器",
				icon: (size) => react.default.createElement("span", { style: { fontSize: size } }, "🌐"),
				single: true,
				component: (props) => {
					const sessionId = props.scope?.sessionId ?? "";
					const autoOpened = react.default.useRef(false);
					react.default.useEffect(() => {
						if (props.visible && !autoOpened.current && sessionId !== "") {
							autoOpened.current = true;
							fetch(`${PANEL_ROUTE}/open?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" }).catch(() => {});
						}
					}, [props.visible]);
					return react.default.createElement("div", {
						style: {
							width: "100%",
							height: "100%",
							minHeight: 0,
							position: "relative"
						},
						ref: (el) => {
							if (el && !mounted) {
								const panel = buildPanel(ctx, "tab");
								panelRef = panel;
								el.appendChild(panel.root);
								stopPoll = startPolling(ctx, panel);
								mounted = true;
							} else if (!el && mounted) {
								stopPoll?.();
								stopPoll = null;
								panelRef?.root.remove();
								panelRef = null;
								mounted = false;
							}
						}
					});
				}
			});
			else {
				const panel = buildPanel(ctx, "dock");
				document.body.append(panel.root);
				stopPoll = startPolling(ctx, panel);
				mounted = true;
			}
			const stopSessions = ctx.get("sessions")?.list?.subscribe(() => {}) ?? (() => {});
			ctx.effect(() => {
				return () => {
					stopPoll?.();
					stopSessions();
					style.remove();
				};
			}, "browser-panel.client");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map