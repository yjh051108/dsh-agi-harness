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
