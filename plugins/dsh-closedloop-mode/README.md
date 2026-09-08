# dsh-closedloop-mode（0.6.26 · 最优律闭环协议插件）

把 agent 的"一次生成再逐步修"开环，换成"**预测先行 → 实现 → 盘上实测对账**"的闭环（LQR 单步最优映射——搬结构不搬公式）。
一句话：开工前先声明"做完怎么知道它是对的"（最优律契约），实现后实跑对照——全吻合=自动闭合打卡；不吻合=预测作废回滚重推导，**不存在"调试"状态**。

> 版本真相链 = `src/inject-text.js` / README 标题 / HANDOFF / package.json（v0.6.23 起四处由 bump-version 工具同步）；CHANGELOG 明确链外（作者惯例，止于 0.5.0 段落，0.6.x 叙述见 HANDOFF §0.6 系列）。
> 接手文档：`D:\dsh\HANDOFF-CLOSEDLOOP.md`（§0.6.25 现状+盘点快照为准）；哲学与验收：`D:\dsh\HANDOFF-CLOSEDLOOP-100.md`。

## 开单路径（三条，任一激活）

1. **autoStart**（r67 完全体，现行）：profile patch 层 `autoStart: true`——真人首条消息自动入环；
2. `/optimal <任务>`（命令兼容保留；off 双确认 / status）；
3. **模型自主**：直接 `cost_set(目的宣言)`（信息不足会被拒——拒绝文本即条款）。

## 快环协议（核心循环）

```
cost_set（合同：purpose + 断言组，measure 可选但必须能跑）
  → decompose（组切分：cmd:/人判: 判据形态闸 + dry-run 预检同执行器）
  → freeze（锁定入执行）
  → optimal_declare（差分契约：预测值必须带来源——read:<path>#L<n> / probe:<key> / prior:<文本>）
  → 实现（模型干活）
  → optimal_converge（对账：「实测 <A> ≠ 预测 <B>(通道)」数字对，A==B 才认）
  → 全吻合=组闭合；任何不吻合=optimal_rollback（错层归因留档）
  → 组收官 → terminal_check（V=Σw(1−z) 归零才算完）
```

红线：无测量不放权（来源纪律三形式）；棘轮只紧不松；伪造测量被闸当场抓（栈案底即教具）。

## 工具（14，单源 TOOL_NAMES 在 src/index.js）

| 工具 | 作用 |
|---|---|
| `cost_set` | 开单定稿（挂合同同时实跑 measure：已绿无 rationale=拒、报错=拒——判别力闸） |
| `decompose` | 组切分（判据形态闸 + dry-run 三态：green/red/broken） |
| `freeze` | 锁定计划入执行 |
| `measure_propose` | 判据提案（measure-spec 宿主侧） |
| `probe_record` | 探针台账：先实测后预测（≤20s 实跑落 <sid>.probes.json，declare 时机械复验） |
| `optimal_declare` | 快环声明（差分契约，预测值带来源） |
| `optimal_converge` | 对账收敛（数字对+双通道） |
| `optimal_rollback` | 回滚（错层归因 re-linearize 案底文化） |
| `optimal_stack` | 栈视图 |
| `revise_do` | 形态修订（do 可改+登记轨迹；verify 只读） |
| `audit_record` | 审计记录（另头审 verdict 落账） |
| `cost_audit` | 成本审计 |
| `audit_dispatch` | 另头审派发（fresh 子代理；无活代理=降级派发卡，不谎报） |
| `terminal_check` | 终验（V 归零+自动归档回执） |

## 器官（src/ 模块）

`mode-state`（盘档状态机）· `optimal-engine`（快环栈+四闸）· `contract-merge`（差分物化）·
`v04-core/grader/damping`（基数 V/判分器棘轮/事件触发阻尼——无信号=静默）·
`learning-organ`（教训沉淀/唤醒/再犯点名，learning.jsonl 只追加）· `rank-organ`（信誉档位：Wilson+滞回+装完成直降）·
`ability-organ`（能力印记 ability.jsonl）· `pricing-organ`（影子成本账本/分层切换）·
`quota-organ`（协作式注意力配额）· `near-field`（近场变焦）·
`audit-dispatch/rotation`（另头审）· `persona.js`（启动人格单源，每单注入一次）· `propose-text`/`inject-text`（状态面/薄注入面）。

知↔忆互见：engram_verify/respond 全态带 📎 相关记忆（一体两器官，见 `01-memory/dsh-engram-relay/AGENTS.md`）。

## 面板

徽章常驻+会话感知（无单=灰不可点；取数失败=灰显重试不消失）；面板只看当前会话进度（/panel v3+/state v3）；V 阶梯柱状图已删（2026-09-04 用户拍板）；GUI 调参入口已移除（参数非 GUI）。

## 装配（super-injector 注入，非官方 bundle 路径）

```bash
# 注入器环境内：
dev_inject_plugin D:\dsh\dsh-closedloop-mode
dev_reload_package dsh-closedloop-mode   # 改 src 后热换代（免重启）
# autoStart 开关在 profile patch 层（C:\Users\Eldwen\.dsh\profiles\web\cordis.patch.yml → dsh-closedloop-mode.config.autoStart）
```

junction → `@dsh-external/dsh-closedloop-mode`；重启自动恢复（注入清单 `~/.dsh/super-injector/registry.json`）。

## 开发与测试

- 三连（每次改 src）：`node scripts/build.mjs`（src→lib）→ `node --test "tests/*.test.mjs"` → `dev_reload_package dsh-closedloop-mode`
- 机检：`node D:\dsh\harness-master-design\check-production.mjs`（23 把尺全家，红=有债）
- 量尺：`node scripts/v04-metrics.mjs session-<sid>`（四指标）/ `v04-noise-floor.mjs`
- 测试基线：246 项（作者环境全绿；**已知环境敏感**：d3 在 cmd 中文/GBK 系统上报错文本乱码使 not-recognized 正则失明→1 红，非行为回归，详见 HANDOFF 盘点快照）
- 血泪坑清单（node 全路径/DSH_HOME=Eldwen/静默 catch/serialize 白名单/schema 形态等）：HANDOFF-CLOSEDLOOP §4

## 许可

Apache-2.0（见 LICENSE）；公开分支 `D:\dsh\rs-handoff`（closedloop-handoff 分支，SANE 消毒；**main 合并按钮在用户手里**）。
