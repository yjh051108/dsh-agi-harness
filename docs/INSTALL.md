# 安装

## 方式 A：运行时注入（开发）

用 DSH 的 super-injector 注入各插件包目录：

```
dev_inject_plugin <本仓库>/plugins/dsh-closedloop-mode
dev_inject_plugin <本仓库>/plugins/dsh-engram-relay
dev_inject_plugin <本仓库>/plugins/dsh-browser-panel   # 可选
```

预设安装：将 `preset/closedloop-full/` 复制到 `~/.dsh/.agent-presets/closedloop-full`。

## 方式 B：随 profile 装配

将插件目录加入 profile 的 bundles（或使用 `dsh plugin add` 指向本地目录），
预设为默认：`agent-presets.default = closedloop-full`。

## 启用开关

- `autoStart: true`（默认）：真人首条消息自动进入任务模式；
- `writeGate: true`（默认）：未声明当前动作时写盘被拒，侦察/测量全程自由；
- 语义裁判：设置 `DEEPSEEK_API_KEY`（缺省自动降级为机械判定）。

## 验证

`dev_plugin_status` 看到三个插件均 `[active]` 即成功。

## 预设作用域（可选开关）

默认 `presetScope: "all"`——插件对所有会话全局生效（现状）。
若希望**仅在配套预设（closedloop-full）下生效**、不影响其他预设，在插件配置处传：

```json
{ "presetScope": "presets", "presets": ["closedloop-full"] }
```

- 作用域外的会话：零注入、零接管、写闸静默（插件对该会话完全隐身）；
- 显式 `/optimal: 任务` 命令不受作用域限制（用户主动=尊重）；
- 未携带 preset 字段的会话按"不匹配"处理（fail-closed）。

## 装配前提（实测踩坑，来自 issue #7）

1. **pnpm 11 会因未声明的依赖构建脚本以非 0 退出**（`ERR_PNPM_IGNORED_BUILDS`）——`dsh plugin` 只在 pnpm 退出码 0 时才做 `dsh.profile.bundles` 对账，表现为「依赖装了、插件没进 bundles、也没生效」。在 profile 的 `pnpm-workspace.yaml` 显式声明：

   ```yaml
   allowBuilds:
     onnxruntime-node: false
     protobufjs: false
     sharp: false
   ```

2. **路径不要含空格**：`dsh plugin` 转发 pnpm 时用 `spawnSync("pnpm", args, { shell: true })`，含空格路径会被 cmd 拆参数。用无空格 junction 指向仓库目录。

3. **依赖由谁提供**：方式 B（bundle 装配 / `dsh plugin add <本地目录>`，link 模式）**不安装插件自身的 `dependencies`**。`dsh-browser-panel` 的 `playwright-core` / `ws` / `schemastery` 必须能由宿主 profile 解析到，否则报 `Cannot find package 'playwright-core'`。

4. **预设默认**（可选）：方式 B 若要开箱即用闭环，需自行设 `agent-presets.default = closedloop-full`——给出的命令里不含这一步。

## 已测版本矩阵

| DSH | 入口 | 结果 |
|---|---|---|
| `0.1.2-rc.1` | `dsh web` | 三插件 active；`/browser-panel` 路由 200、未知路径 404 |
| `0.1.2-rc.1` | DSH Desktop 2.0.5 | 三插件 active（`webServer` 服务名一致） |
| `0.1.3-alpha.2` | 源码启动 `pnpm dsh --profile web` | 三插件 active |

HTTP 服务名基线：`@deepseek-ai/dsh-host-webserver` 发布的服务是 **`webServer`**（`0.1.0-rc.8` / `0.1.1-rc.2` / `0.1.2-rc.1` / `0.1.3-alpha.2` 一致；`httpServer` 从未被任何官方包提供）。
