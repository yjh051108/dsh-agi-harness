window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-engram-relay",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		/**
		* dsh-engram-relay — client entry（图谱 WebUI 已移除）。
		*
		* 2026-08-15：按用户要求移除「图谱」Tab（conversation.view 不再注册）。
		* host 端记忆能力（engram_* 工具、唤醒注入、分层存储）完全保留，
		* 本 client 只负责占位——boot 加载该 entry 但不再渲染任何 UI。
		*/
		/** 插件显示名（诊断用）。 */
		const name = "dsh-engram-relay-client";
		/** 不再依赖 slots/locale：不注册任何 UI。 */
		const inject = [];
		function apply(ctx) {
			ctx.effect(() => () => void 0, "dsh-engram-relay: noop client");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map