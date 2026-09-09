# CLOSEDLOOP-DELIVERY — v0.3 全线交付总结

> 交付物：dsh-closedloop-mode **0.3.0**（THEORY-v0.3 定理7：策略驻留引擎、轨迹涌现回路）。
> 本文四段：证据索引 · 冒烟读数表 · 未执行/遗留 · 悖论收口。尾行数字全部实测可重跑（命令随行）。

## 1. 证据索引（V 账本全链，本会话 #15-#25）

| 证据 | 位置 / 复现 |
|---|---|
| 全链栈账 | `~/.dsh/graded-state/session-b74630b0-….optimal.json`：#1-#14（v0.1→v0.2 旧单）+ #15-#25（v0.3 单），含全部 rollback/re-linearize 审计史（#20 量尺口径变更、换代冒烟探针回炉等） |
| 双目录并存 | `D:\dsh\dsh-optimal-mode`（v0.2 对照组，tag `v0.2-baseline`=首 commit `5cea82f` 58 files，全程 `git status` 零行——见 §3 复跑）；`D:\dsh\dsh-closedloop-mode`（v0.3，本单所有改动仅在此） |
| 盘档 v3 | `mode-state.js` 写面零轨迹键（`vChain/l1Locked/l2Locked/reviewPending/plan` 输出面 grep=0），旧 v2 档经 `migrateLegacy` 只读迁移零回写（源盘档 sha256 跑前后不变，测例锁死） |
| 差分契约 | `contract-merge.js`：args=diff/engine=merge，物化件交 v0.2 `declareStep` **同一道闸**（等价三硬断测例：正例同 ok / 无源反例同错误文本 / 双物化签名全等=确定性）；差分体积比 diff/手写=**0.158 ≤ 0.5** 实测 |
| 最小状态面 | `propose-text.js` stateFace：真主会话档迁移面 **740B ≤ 1333B 预算**（FIT-plant 3.9KB×⅓）；四元齐全（残差/Q_N摘要/已闭集/cost-to-go 指令）；讲课词残留（岗位/北极星/预言家/convergeLaw）grep=0；纯函数无时钟 |
| 另头审 | `audit-dispatch.js` auditBrief（机械切片非全栈）+ parseVerdict（引文=栈文件逐字子串硬验）+ recordAuditVerdict（落账 rounds）；活体三态见 §2 |

## 2. 冒烟读数表（fit-plant v2 口径，命令：`node scripts/fit-plant.mjs <sid>` 可重跑）

| 冒烟 | sid | 墙钟 | 往返 | 契约书写 | 注入KB/帧 | read | closed | 结局 |
|---|---|---|---|---|---|---|---|---|
| #1 首冒烟（reject 现场） | 853e4542 | 8min | 11 | 2.2KB | 2.8/12帧 | 3.4KB | 2 | fresh 审真 **reject**（4 issues：抓到「未来事件当预测」+「假吻合过闸」两缺陷）→ audit_record 落账 → 落账门拒开 → terminal 正确拦截 |
| #2 闸活证（死锁现场） | e3a53c3f | 7min | 19 | 2.8KB | 4.3/20帧 | 4.3KB | 3 | **数值硬闸活证**：故意错配「实测5≠预测7」被 invalidated 原文在栈；修复前 at 档 dip **死锁** terminal zero=false |
| #3 修复终验（归零） | e5e9df00 | **3min** | **10** | **1.2KB** | 3.3/16帧 | **0** | **3/3** | at 档 dip-saturated 收官 → **terminal zero=true**（盘档直读 stage=final·dipPending=false） |

- 数值闸两洞（#1 发现→当场修→#2 活证拦截→68→71 测例锁死）与 dip 死锁（#2 发现→#A 修复→#3 复验归零）= **冒烟在真实上宿主链里抓出并闭环修复**，非纸面。
- 换代窗口两轮（#20 冒烟、#22 面板 curl 各卸挂一次）：主会话真账 `.json/.optimal.json` sha256 全程与留底逐字节等（runtime 通道零协议调用），盘档权威跨代存活复证。

## 3. 未执行 / 遗留（如实标注，非缺陷）

- **A/B 五域对照：未执行**（用户撤销原话『算了不需要ab测试了』经标定确认入 nonGoals）。BENCH-ab.md 协议+预登记预测表存档不删；若重开按其 §4 执行。§2 冒烟读数是 v0.3 **单侧**，不构成两版对照。
- **模型层参数接线：未做**——面板 `modelState={model:null, paramsSource:'内置默认…'}` 诚实占位；paramsSource 双行冗余=后续「参数块」首改项（用户 ideal-state 裁定，非本单判据）。
- **轻任务顺路验证：未做**（定档器已裁 nonGoal；差分契约使轻任务每步驻留顺路变便宜，但无实测背书，不声称）。
- **declare 底档 dip 警示文案未同步**（smoke#3 发现：饱和步仍打「回升义务挂账」误导行，实际未挂）——v0.3.1 文案修，语义无碍（dipPending 布尔为准）。
- **sid 不在部分工具回执面**（smoke 需从盘档反查自身 sid）——非阻塞，后续可在回执加 sidShort。

## 4. 悖论收口（第三度）

v0.3 的「废除轨迹冻结」这一单，本身仍由 v0.2 的**轨迹冻结**流程驱动（块级序列+档链是 v0.2 引擎给本单生成的）——即：用旧范式的锁，交付了打破该锁的新范式。栈账可证：#15-#25 走的仍是 v0.2 的 declare/converge 块级契约，而它产出的 v0.3 引擎运行时无块级序列（smoke 三会话盘档为证：只有组结构+实时动作）。这条自指的账如实留在 V 账本；#20 量尺转正的 rolledBack 史（含口径 v1→v2 变更）是同类「用旧尺量新事」的诚实留痕。教训：范式替换的最后一单必由旧范式驱动——预推导了「废除轨迹」这件事，却没预推导「这一单本身走不走轨迹」，属定理7 的收尾自指盲区，留档。

---
**尾行实测（逐字可重跑）：**
- 测试：`# tests 71 / # pass 71 / # fail 0`（`npm test`=十文件列举式 node --test）
- 工具面：TOOL_NAMES **11** 含 audit_record=true；src 8 件 / tests 10 件（node 现读 index.js+fs 枚举）
- 冒烟核心归零：e5e9df00 terminal `zero=true`（`node scripts/fit-plant.mjs e5e9df00-…` 可复跑，见 §2 行3）
- 对照组零改动：`git -C D:\dsh\dsh-optimal-mode status --porcelain` 行数 **0**
- 差分体积比 0.158 · stateFace 740B/预算1333B · 契约书写降 89%（3.9→0.4KB/动作）· 注入帧均值 206B
