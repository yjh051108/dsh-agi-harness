# v0.2 范式替换交付总结（REPLACE-DELIVERY）

> 交付物：dsh-optimal-mode **0.2.0**（SPEC-replace v0.2 全量落地）。
> 本文四节依次为：证据 / 参数 / 遗留 / 悖论实录。
> 尾行数字=实测输出逐字转录（可重跑复现），非手抄估算。

## 1. 真跑证据索引

**自驭验证**：v0.2 由其自身驱动完成一次端到端真跑（P 场会话）+ 本次交付（主会话），共 14+3 推导步。

| 证据 | 位置 / 读数 |
|---|---|
| P 场盘档 | `~/.dsh/graded-state/4e0ae1fd-5d01-48bb-bdfd-cee5136938b3.optimal.json`（stage=final，vChain 3 段断链 0，3 块全 closed，旧痕 mode/star/mark_task 正则计数 0） |
| P 场取证脚本 | `D:\dsh\gh-triage-work\pfield-evidence.mjs` → 输出 `P-FIELD EVIDENCE PASS ✓` |
| 终端校验原文 | P 场会话内 terminal_check：「✅ 终端归零：断言 8 条所辖闭合链齐（closed 步=3），剩余=0」 |
| 主会话推导栈 | `session-b74630b0-….optimal.json`，14 步全链 V 时间线（optimal_stack 可重现），re-linearize 审计史 6 条在案 |
| openStep 互证 | /panel 活读：P 场全闭后会话=null（正确语义）；主会话进行中=当前 open 步活值（跨通道动态等式成立） |

### 真跑反馈修复（6 处，当场修，无默吞）

脚本源：`D:\dsh\gh-triage-work\pfield-bugs.mjs`（bug1..bug6 逐处含证据锚）。

| # | 现象 | 根因 | 修复 | 活证 |
|---|---|---|---|---|
| bug1 | measure.channels 非数组 → 原生 TypeError | 契约缺形状校验 | 契约文案直拒（「形状错：需字符串数组 ≥2 条…非实现异常」） | `bug6-live.mjs`：畸形→文案、正形→过闸 true |
| bug2 | 同上引擎构造侧崩溃面 | map 前无兜底 | `Array.isArray` 兜底 | 引擎直调无异常 |
| bug3 | terminal_check 报告未落盘（判据要求落盘而实现缺失） | saveState 缺字段 | `terminalReport:{at,…rep}` 写入 | 本块新单测：zero:false→闭合后 zero:true |
| bug4 | terminalReport 序列化丢失 | serializeState 未透传 | 字段透传 | 同上单测 + round-trip |
| bug5 | terminalReport 反序列化丢失 | deserializeState 未透传 | 字段透传 | 同上 |
| bug6 | 观测量自指：P 场块 #1 把 openStep 历史快照字面量钉进预测 | declare 引导缺禁令（open 步数随 declare 自身变化→假失配→invalidated） | convergeLaw 增「观测量自指禁令：跨通道动态等式」条文 | 注入文本含禁令句；P 场重宣后闭合 |

面板侧另补两行：openStep 活体行、模型/版本行（modelState 诚实占位）——真跑期间「运行中看不到当前推导步」的观测缺口。

## 2. 参数终表（工具面硬门 · 现状即终态）

| 工具 | 硬门 |
|---|---|
| cost_set | purpose≥12 字（不得照抄任务原文）；assertions 逐条 {text, severity∈minor/major/catastrophic, source}——缺档缺源=拒（定理4）；nonGoals 仅随 nonGoalsConfirmed:true 落盘（定理1 确认制）；requirements/mode 旧参数显式拒收 |
| decompose | 一次全量提交（整体替换）；组判据≤3；块 concepts 容量带 3-8（容量推导结果，非名词配额） |
| freeze | 单一锁点；按块序机械生成 vChain（rank(k)=k≥3 far / ≥1 near / 0 at，末块必 at）；链不连续=拒锁（生成防线） |
| cost_audit | scope∈group/block+title 精确匹配；reject 必附证据清单；审契约（source 真实/语义收缩/law 前置）不审产物对错 |
| optimal_declare | law≥1 前置（消灭调试态）；measure channels≥2；predictions 无来源=无效；vExpect improve/dip（dip 须 dipPlan，连续 dip 禁止）；confidence=low → 停下交分歧点 |
| optimal_converge | 三要素：ΔV 严格降（beforeBand=上步 vOut 链式）× 数值「key: 实测 ≠ 预测(通道)」异源复算 × channels 标识两两不同；全过=closed=V 账本锚点 |
| optimal_rollback | reason≥8 字=re-linearize 产物（指明哪层推导错）；模型签名= title+sources+invariants+cost-failures，同签名重 declare 直拒（定理6） |
| terminal_check | 全链唯一 throw 位（stage≠final 直拒）；非零=报告交处置不阻断；报告落盘 terminalReport |
| revise_do | 仅开发期改 do；verify 只读——验证承诺不因形态变化打折 |

禁词表（7 条，`tests/lingua-forbid.test.mjs` 唯一真相源）：本文档同受扫描纪律（旧机制以英文标识/中文学名提及，禁词字面 0 出现）。

## 3. 遗留去向

| 项 | 去向 | 现状 |
|---|---|---|
| 模型层参数接线 | 后续「参数块」 | 面板 modelState={model:null, paramsSource:'内置默认…'} 诚实占位；paramsSource 双行显示冗余=**最该改**（接线时一并清） |
| 新会话徽标人眼目验 | 用户侧浏览器 | 独立实例无 GUI 认证凭据（401 空壳）——#11 块 re-linearize 已声明通道不可达，不假称已验 |
| 旧盘档键 star/redteam | 只读兼容一周期后退役 | normalize/settle 读路径在，零新写 |
| `node --test <目录>` 目录模式 | 环境怪癖非代码问题 | node 把 `tests` 当模块路径解析报 Cannot find module；规范命令=package.json 五文件列举式（全绿通道） |
| 本交付文档自身 | v0.2 首份受禁词纪律的交付物 | 见尾行扫描实测=0 |

## 4. 悖论收尾（如实记录）

本次交付（把主会话从 grade 流水线替换为控制环）本身运行在 v0.1「三选一 mode + mark_task」旧机制驱动的会话里——用户拍板原话：「本轮=旧机制的最后一次使用」。栈 #1-#12 的步由 mark_task/mode 世界启动，#13-#14 由 v0.2 控制环闭合（换代发生在 #12「换代上宿主」）：一单交付内两套范式先后为政，旧锚点的 V 账本如实留在栈史（含 6 条 re-linearize 审计）。本块闭合=旧账本最后一锚；此后终端校验（terminal_check）接管归零。教训沉淀：①观测量自指禁令（bug6）入运行时条文；②数字用可数事实不用估量（#2/#3 行数偏差两次回滚的审计史）；③副作用要验证输出而非退出码（GitHub 评论 0 字节静默失败教训，同纪律用于本报告尾行）。

---

**尾行实测（逐字转录，可重跑）：**
- 全套测试：`# tests 96 / # pass 96 / # fail 0`（`node --test tests/mode-state.test.mjs tests/tools.test.mjs tests/inject-text.test.mjs tests/optimal.test.mjs tests/lingua-forbid.test.mjs`）
- 构建：`BUILD OK: 7 files → lib/`
- 工具集：10 件（TOOL_NAMES 断言，tools.test「唯一真相」用例）
- P 场盘档：stage=final · vChain 3 段断链 0 · closed 3/3 · terminal zero=true（pfield-evidence 输出 PASS）
- 主会话栈：14 步（本块闭合时全 closed）
