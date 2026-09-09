# SPEC-replace v0.2 — 从流水线到控制循环（彻底替换蓝图）

> 2026-09-03 · 拍板：**B 彻底替换 + 先范式后面板**。v0.1.0 是"契约移植"（grade 流水线 + optimal 外衣，
> 组收官/终验六项仍是"检验补救税"的结构性残留）；v0.2 把**状态机本身换成滚动最优控制**：
> 最优律由终端代价 backward 推导，逐块闭合滚动前进，全链只剩**一个**验证点（终端归零校验）。
> 诚实边界同前：借 LQR/MPC 结构律，不声称数学等价。

## 1. 状态机替换（旧→新，逐阶段）

| v0.1（grade 流水线残留） | v0.2（控制循环） | 语义本质 |
|---|---|---|
| brainstorm 选择题 | **cost-calibrate 代价标定** | 终端代价 Q_N=北极星+验收断言集，每断言带**权重+来源**（定理2/4：定义权在用户、无来源=不得进评）；非目标确认制（AI 不得单方写 nonGoals） |
| l1-edit / l2-edit / 两级锁 | **decompose 状态空间分解** | 块=控制周期（近场滚动，只锚下一闭合点）；锁=**冻结 + backward 价值传播**：产出每块 vIn→vOut 档期望链（valueChainText 从提示升格为契约链，链不连续=declare 时校对） |
| review 看规格单 | **derivation-review 推导评审** | 看推导严密：权重来源、档链覆盖终端断言、law 前置——不是"清单齐不齐" |
| develop+打卡制 | **rolling loop 滚动控制** | 每块 declare→act→converge→**闭合即滚动下一块**（focus=栈顶，无独立打卡动作）；ΔV 不降/discrepancy → re-linearize（既有） |
| 组收官"逐条核对" | **subspace terminal check（机械）** | 组内块全 closed → 自动核对该组断言子集清零（数据比对，不是仪式复诵）；红队组仍过 cost_audit 门 |
| final"终验六项" | **terminal zero-check（全链唯一验证点）** | 实测残差=declared 终点档；六项中"一致性/覆盖性"并入机械核对，"终端体验"保留为用户一票否决项（体验判据不可机械化的诚实位） |

## 2. 工具集（10→9，重写语义）

| 工具 | 处置 | 说明 |
|---|---|---|
| commit_star | 改 **cost_set** | +每验收断言权重（档位：minor/major/catastrophic——开放题见 §6c）+来源；nonGoals 仅可经用户选择题落盘（确认制） |
| edit_plan | 改 **decompose** | 层级（大类组）降级为**阅读视图非门控**（树或平铺见 §6a）；do/verify 字段保留 |
| lock_stage | 改 **freeze** | 成功=冻结+backward 档链落盘（回执含链：块1 far→near, 块2 near→…） |
| mark_task | **删除** | converge 即闭合即推进（现状已自动 mark，v0.2 去中间名分） |
| redteam_verdict | 改 **cost_audit** | 审代价函数/权重是否自造、语义是否收缩（不审"产物对不对"）；redteam 块未审不得 converge |
| revise_do | 保留 | 执行形态修订=控制手段选择，语义不变 |
| optimal_declare/converge/rollback/stack | **核心件不动** | v0.1.0 已落地（契约+ΔV+双通道+反漂移签名） |
| （新）**terminal_check** | 新增 | final 态触发：读 cost 断言集×实测证据通道→零/非零报告 |

## 3. 语系改造（结构位，非装饰）
禁用词表（注入/回执永不出现）：测试通过·验收·打卡·收官·组级核对·终验六项。
替换：推导闭合·代价归零·滚动推进·子空间核对·终端校验。
（"验收模式"选项题→**代价标定题**；correct/experience/research 保留=验收重心即 Q 权重形状。）

## 4. 面板（新范式重推，接续已拍板需求）
- **hover 进度面板主体=V 账本**：档链 far→near→at 阶梯（closed 步轨迹+dip 挂账+剩余代价读数=距终端档）；计划树降为可展开细节（v0.1 设计稿素材降级复用，主体重画）
- 参数页四组维持（v0.1.0 params mockup 可用）；新增 cost 权重默认模板位
- 进度数据源 `/graded-mode/api/panel` 改聚合 V 账本优先

## 5. 迁移与兼容
- mode-state 阶段键沿用（off/…/develop/final 字符串不动，语义注释全换），旧会话文件不热迁（sid 隔离天然安全）
- 测试改造：tools.test 的 mark_task 断言 → converge 自动推进断言（大部分已覆盖，删冗余）；新增档链连续性单测
- CHANGELOG 0.2.0：破项标注（mark_task 删除=breaking，v0.1.x 会话不受影响）

## 6. 开放分歧点（低置信项，开工前需拍板）
- **a 树形去留**：控制循环严格只需平铺块序列+依赖边；两级树是阅读便利。倾向：保留为视图、撤门控（L1 锁并入一次 freeze）——影响 decompose/freeze 形状。
- **b 档链粒度**：vIn→vOut 按块（密、串值风险高）vs 按组（疏、块级 ΔV 仍按块报）？倾向：块级申报+组级核对。
- **c 权重形状**：断言权重用档位（minor/major/catastrophic）还是数值（1-9）？倾向：档位（防"自造 0.02"数值迷信复发）。
- **d 组核对触发**：自动（组内全 closed 即跑）vs 手动 terminal_check 调用？倾向：自动+回执注入。

## 7. 执行序（拍板后）
`/分级 off` 结束本轮 → 新任务 `/分级 按 SPEC-replace v0.2 改造 dsh-optimal-mode 状态机与工具集` →
新脑暴（代价标定题+非目标确认制）→ 计划树重开（面板组并入末段）→ 逐块闭合滚动。
素材：v0.1.0 已落地件（引擎/闸/参数地基半成品/两张 mockup 之一）全部继承。

## 8. 落地状态（2026-09-04，v0.2.0 发布时注记）
- §1-§4 **全部落地**：状态机=控制环五段；工具 10 件（mark_task 删/三选一 mode 废/旧参数拒收）；禁词表 7 条裁判制（src 全扫零命中）；面板主体 V 账本（/panel 端点+档链阶梯+openStep 活体行）
- §5 落地：盘档 v2 键+旧键只读兼容一周期；测试改造完成（converge 自动推进断言+档链连续性单测，96/96）；CHANGELOG 0.2.0 breaking 段
- §6 开放分歧点**按倾向落定**：a 树形保留为视图（L1 锁并入一次 freeze）；b 块级申报+组维度核对（vChain 机械档链=全局期望锚）；c 权重用档位 minor/major/catastrophic；d 组核对自动触发+回执注入
- **自驭真跑验证**（§7 末段接续）：v0.2 由插件自身驱动跑通 P 场端到端（新会话 cost_set 8 断言→3 块闭合→terminal_check 归零），真跑反馈 6 处当场修——详见 docs/REPLACE-DELIVERY.md 证据索引
- 遗留（非本 SPEC 范围）：模型层参数接线（面板 modelState 现为诚实占位+paramsSource 显示行）→ 后续参数块；新会话徽标人眼目验移交用户侧（独立浏览器无 GUI 凭据，#11 re-linearize 已声明不可达通道）
