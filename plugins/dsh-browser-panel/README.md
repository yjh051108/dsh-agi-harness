# dsh-browser-panel — WebUI 内嵌完整浏览器视图

[English](README.en.md) | **中文**

> DeepSeek Harness 内测生态 · 仅限 dsh-external 组织内测成员使用
> ⚠️ 严禁公开、外发、镜像或分发到任何非授权位置；仓库必须保持 PRIVATE

## 🌟 北极星（North Star）

**在 DSH WebUI 内部，模型与用户共享一个真实、可见、可操控的浏览器。**

类似 Codex 桌面的内置浏览器体验：WebUI 的面板里是一个完整的有头浏览器，
模型在对话中实时操控它（打开页面、点击、填表、滚动、导航），用户在面板里
**看到每一步真实发生**——不是截图回放，是活着的页面。模型操作时用户看得见，
用户操作时模型看得懂，双向可见。

## 为什么现在做（Why now）

- **生态空白**：dsh-external 组织 164 个仓库中，没有任何 WebUI 内嵌浏览器视图插件。
  最近的邻居：`dsh-browser`（Chrome 侧边栏扩展，不在 WebUI 内）、`dsh-web-terminal`
  （WebUI 内嵌面板但内容是终端）、`dsh-tool-browser` / `ego-browser`（纯工具无画面）。
- **拼图已齐，只差组合**：
  - 面板机制：`dsh-web-terminal` 已打通 client slot 挂载（零核心改动）
  - 浏览器后端：Playwright 有头 Chromium / CDP（`dsh-tool-browser` 验证过）
  - 非多模态操控协议：`dsh-browser` 的编号快照方案可借鉴
  - 可选视觉增强：`dsh-vision` 的 VLM 桥（画面可选择性进模型）
- **非多模态是核心约束**：DeepSeek 模型无视觉输入，操控必须走
  "语义快照 + 编号引用 + 原子动作"协议；画面只给人看，不进模型上下文。

## 核心形态

- **面板**：WebUI 右侧/底部 dock，client UI 插件 + slot 挂载，零核心改动
- **浏览器**：Playwright 有头 Chromium，CDP 流式画面/截图帧推进面板
- **操控工具**：`browser_snapshot`（编号可访问性快照，delta 增量）/ `browser_click` /
  `browser_type` / `browser_press` / `browser_scroll` / `browser_navigate` / `browser_wait` / `browser_eval`
- **会话融合**：工具调用行渲染在对话流中，面板与对话状态同步；截图仅人类可见
- **登录态**：浏览器持久化 profile，跨会话保留登录态（可选）

## 里程碑

- **M0（当前）**：仓库 + 北极星 README 占位，登记 hub 索引
- **M1**：最小闭环——有头浏览器启动 + `snapshot`/`click`/`navigate` 工具（无面板）
- **M2**：WebUI 面板可视化——流式画面 + 工具行联动 + 面板控制
- **M3**：深度融合——会话绑定、多标签、登录态持久、VLM 可选增强、E2E 测试

## 生态惯例

- 独立仓库，只含插件本身；零 SDK 依赖（服务接口自声明，运行时由宿主 Harness 提供）
- 已打 `marisa-plugin` topic（Marisa 面板 + hub plugins.json 自动收录）
- 遵循 dsh-external 内测保密规则；仓库必须保持 PRIVATE

## 状态

**M1 + M2 已实现**（2026-08-09）：

- ✅ host 侧：每会话独立 Playwright Chromium + 12 个 `browser_*` 工具（快照/点击/输入/按键/滚动/导航/等待/eval/前进后退刷新/开关）
- ✅ 非多模态协议：编号交互清单快照（role/name/state/value 掩码/可见性）+ 索引寻址 + 失败恢复（过期索引返回新快照）
- ✅ CDP screencast 帧流：JPEG 帧缓存经 HTTP 供面板轮询
- ✅ client 侧：WebUI 右侧侧栏面板（grid 第 2 列挂载，零核心改动），实时画面 + URL/标题状态栏
- ✅ 真实 Chromium e2e 测试通过（快照→点击→输入闭环）

**M3 已实现**（2026-08-10 / 08-11）：

- ✅ 快照 delta 增量：`browser_snapshot` 支持 `delta=true`，仅输出 URL/标题变化 + 按 XPath 键控的新增/移除/变更元素（每会话缓存；首次调用回退全量）
- ✅ 登录态持久 profile：每会话 `~/.dsh/browser-panel/profiles/<sessionId>` 持久化用户目录，cookies/site storage 跨 dsh 重启保留
- ✅ 多标签：`browser_new_tab` / `browser_tabs` / `browser_switch` / `browser_close_tab` 工具 + 面板 tab 工具栏（新建/刷新/关闭），CDP session 按 page 缓存
- ✅ 面板画面跟随 active tab：tab 切换时 pump 重建当前页 screencast 订阅（丢弃上一页残留帧去重），并强制截图兜底——headless 下 CDP screencast 只服务前台 target，切 tab 后可能停流，截图保证面板始终显示当前标签页
- ✅ 真实 Chromium e2e：快照→点击→输入、多标签增删切换、tab 切换帧流跟随，全部通过

**剩余待办（M3 之后）**：面板开关联动、VLM 可选增强。

**最终形态增量（2026-08-11，M4）**：

- ✅ 页面可观测性：`browser_console`（页面 console/error 日志，可清空）、`browser_dialogs` / `browser_dialog_respond`（alert/confirm/prompt 挂起对话框决策）、`browser_wait_selector`（CSS 选择器等待出现/消失/可见）、`browser_downloads`（页面下载文件清单 + 本地路径）
- ✅ 面板完整交互：tab 列表条（标题/URL，点击切换、× 关闭）、打开/关闭浏览器入口按钮、面板开关与浏览器状态联动
- ✅ 资源治理：`idleTimeoutMs` 配置空闲回收（超时自动关闭浏览器释放资源）
- ✅ VLM 可选桥：`vision` 配置（OpenAI 兼容端点）启用 `browser_vision` 工具——截图进模型的可选逃生口，默认关闭保持纯文本协议

## 安装（官方 0811 bundle 格式）

```sh
# 本地开发（link）
dsh plugin --profile web add .

# 云端仓（git 源码；需 prepare + allowBuilds 授权）
dsh plugin --profile web add github:dsh-external/dsh-browser-panel

# npm 私有 registry（预构建）
dsh plugin --profile web add @dsh-external/dsh-browser-panel
```

包根声明 `dsh.bundle`（`cordis.patch.yml`），安装后自动纳入 `dsh.profile.bundles` 层栈；`remove` 一键卸载并回收层栈。旧 `.dsh-plugin/` repository-plugin 格式（0811 废弃）已迁移为包根 bundle。
