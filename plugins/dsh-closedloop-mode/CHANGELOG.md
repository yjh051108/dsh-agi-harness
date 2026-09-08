# Changelog

## 0.7.7（2026-09-09）学习样本可聚合：粗桶键 + 机械过程标签
- **根因实测**：quality-ledger 83 条记录 → **83 个唯一 taskSignature**（重复率 0）→ qualityTrend 要 ≥2 同键、scoreCandidate 要 ≥5 同键，两条消费口**永远拿不到样本**；task-outcomes 74/74 全是 self_checked（0 条人签）→ 学习环有传感器无奖励标签。问题不在贝叶斯算子，在样本被切碎 + 标签为空。
- **learn-key.js**（新）：`bucketKey` 结构粗桶（断言数档×严重度构成×是否改源码×组数档，措辞无关、纯函数）+ `processLabel` 机械过程标签（clean/mixed/dirty/incomplete，值域不含人签词）。
- **接线**：`recordQuality` 落 bucket/features/process；`scoreCandidate` 与 `qualityTrend` 样本键 sig→bucket（旧记录无 bucket 时按 sig 回退，不炸历史账）；`labelSource` 如实标注证据来源（human/mechanical/mixed/none）。
- **bucket-report.mjs**（新）：桶分布读数（记录数/桶数/唯一率/最大桶），历史记录无 features 单列「不可回溯」而不编造。
- 测试：learn-key 12 + learn-bucket-wiring 6；全回归 **551/551 零红**（基线 533 + 18 新例）。
- 诚实位：回溯 8 单重分桶实测 6 桶（唯一率 100%→75%、最大桶 2）——**粗桶是必要条件不是充分条件**：真实任务量少且异质，样本门 ≥5 仍难达成，此读数已写进报告。

## 0.5.0（2026-09-05）引导体系第三旋钮·敢走开完整·导演分工到位
- **防滑抽审**：T1+ 时 decompose 的 self 组每第 3 组转 redteam+auditSampled（autoRelaxed 不叠抽；T0 不抽）——自主升防滑升
- **降档收回扩展**：auditSampled 组降档后回 self（可逆）
- **T2 自动归档**：terminal 归零回执含『已自动归档（导演可回望，无需签收）』——进场档位决定本单规则（与 verify 降级同口径）
- **导演面板行**：归零回执含档位/能力/抽审聚合；**诚实位清单**：未机械验证项（人判判据）恒显示
- 修复：converge 回执误插恢复（patch 错位事故）；normalizeGroup 透传 auditSampled（serialize 家族病第三次，测试网擒获）
- 测试：100-path（5）；全回归 81 绿

## 0.4.9（2026-09-05）上下文税终扫 + 能力印记（人格养成正面侧）
- **描述全清**：cost_set 残留旧描述修复；declare 证据折叠（✓/✗ 标记，mismatch 才展开）——回执长度大降
- **能力印记**：ability-organ（归零特征→ability.jsonl 主体档案，追加不可篡改）+ 摘要正向行（『你已完成 N 单归零…』，无档案零税）
- 接线：terminal_check 归零→recordAbility+回执头部附能力行（下次归零可见）
- 测试：ability-memory（3）；回归 58 绿

## 0.4.8（2026-09-05）引导体系v2：自主档驱动行为（敢走开第一落地）
- **降级映射**：decompose 时 rank.T≥2 且 verify=user → 自动降级 self + autoRelaxed 标记 + 回执注明（回退路径=降档即收回）
- **可逆收回**：rank-organ.recoverRelaxed（降档时 autoRelaxed 组恢复 user+清标记）；terminal_check 降档接线
- 修复：normalizeGroup 白名单透传 autoRelaxed（serialize/deserialize 丢键家族又一次被测试网抓下）
- 测试：behavior-map（3）；全回归 77 绿

## 0.4.7（2026-09-05）引导体系第一版（rank 转正：再犯率入档+引导面+起步可见）
- **再犯率入档**：computeC 读 learning-organ 同类再犯（≥2 次类别各扣 5 分，封顶 -20，收紧方向）——学习率成为自主档位信号
- **引导面**：rankLine 升级为引导语（档位+依据+预期，如『你的自主档 T1：依据最近 N 单命中率 xx%——收得稳，板子放得开…』），兼容数字/对象两种调用形态
- **起步可见**：cost_set 回执尾部附档位引导（有 rank 才有，零税）
- 修复：serialize/deserialize 白名单补 lockedPromises（方案A 目标锁持久化）；rankLine 数字兼容（terminal_check 传 cc.C）
- 测试：rank-guide（3）+ rank-wiring（2）；全回归 74 绿；慢环全链（合同→组→冻结→快环 4 动作→归零）

## 0.4.6（2026-09-05）学习器官（沉淀与唤醒——闭环内部的人格三件套之一）
- **learning-organ 新模块**：错误事件（跨平台预检拒/判据干跑拒/预言失效）→ 追加教训日志（graded-state/learning.jsonl，主体级跨会话，只追加不可篡改）
- **唤醒即引导**：cost_set 回执尾部附教训摘要（最多 3 条；无教训=零税）——每单起步即被提醒“你踩过的坑”
- **再犯即信号**：同类计数（×N + 再犯提醒）——学习率的可观测面（未来引导体系宏观指标）
- 钩子点：tools.js 预检拒/dry-run 拒 + optimal-engine 预言失效；测试 learning-organ.test.mjs 4 例
- 实测：head/grep 两次同类拒绝 → 台账两条 → 摘要显示「cmd-crossplatform×2（再犯提醒）」

## 0.4.5（2026-09-05）语义错配案底三补丁（R3/R4/R5 四次现场驱动；用户拍板「完善必要问题，计数不做」）
- **补 · probe_record 携 stderr 尾**：execSync 失败只抓 stdout——R3 路径猜错现场 stdout 空、病因（ENOENT）全在没抓的 stderr，模型对着空台账猜了半天。现 stderr 尾 400 字并入 output 落台账（`[stderr] ` 前缀可辨），引用核对面同步受益
- **补 · 彻底静默失败当场提示**：exit≠0 且 stdout/stderr 皆空=命令大概率没跑起来（路径/引号/编码）——回执直接给定位路径「先 pwsh 直跑复现，别对着空台账猜」（引号地狱案底现场教学）
- **补 · cost_set dry-run 纪律行（引导词面）**：挂 measure 断言时回执带一行四坑清单——①路径实测勿猜仓根（R3）②计数=split，includes 是布尔（R3 口径错位主发现）③标题正则容插入语（R4/R5 两次同型）④ESM import 要 file:///（R4）——只在挂 measure 时出现，无 measure=静默（零仪式税），不每步复读
- **撤销 · 人工介入计数面**：humanTouches/terminal 报告行按用户指令整面撤除（「先完善必要问题」）——方针终局指标保留为文档判据（HANDOFF §0），机械计数等形态定了再说
- 测试 133/133（+p12 三面 e2e 含反向零仪式税位）；行为验收四 PASS（dsh-实测归档/closedloop-04-dogfood-r6/try-patches.mjs）
- **发布状态**：src 面完成即停（用户拍板）——线上保持 0.4.4（用户在测真实任务），lib 未重建、未换装未重载；升级时机=用户 0.4.4 实测结束后 build+卸旧注新

## 0.4.4（2026-09-05）数值对 raw-token 等值（dogfood R4 假吻合活案例直修：版串「v0.1.0」被误伤）
- R4 案底：read 预测值「v0.1.0」含数字→判数值预测，agreed「实测 v0.1.0 ≠ 预测 v0.1.0」因字母开头过不了前导数字提取→假吻合（本会话第 3 个伪造测量案的 live 形态，#39/#40 为历史案底）
- **修 · 数值对提取从「前导数字段」放宽为「全 raw token」**：等值判定=raw token 严格等值 或 前导数字段等值（单位后缀「15 行」vs「15」向后兼容）；占位词陷阱保留——raw 等值但全对无数字=假吻合（「完成=完成」不算数值实证）；数字段不等=不一致（re-linearize 材料，措辞携 raw 值）
- 向后兼容面：存量数值对测试（77.5 复算闭合/无 ≠ 拒/15≠14 拒）全数不修改通过；新增五面回归（版串等值闭/占位词拒/段不等拒/纯数字段不等拒/数字非前导 raw 等值闭）
- 测试 132/132（+1 五面）
- 回退点：tag `v0.4.3`（6b7b9c2）；`v0.4.2`（5834a2f）；`pre-0.4`（0.3.3+S1）

## 0.4.3（2026-09-05）口径对齐辅助（dogfood R3 主发现 F-R3-2 直修：测量函数口径与预测量错位）
- R3 案底：probe 真跑了，但脚本用 includes() 布尔测「出现次数」——预测「3 处」被测成「存在=1」，A==B 失配。来源纪律闸验「值∈output」但验不了口径（错键的裸数字恰在 output 里）——口径对齐是模型责任位，机械面能做的是**让正确键值在决策点可见**
- **辅助① · probe_record 回执列可解析 key=value**：实跑 output 中全部 `key=数字` token 列出（≤8）+「裸数字易抄错键」提示——存在性位与计数位同形时（=1 vs =3），引全键是唯一不认错的路径；无 token=静默（零仪式税）
- **辅助② · declare 引 probe: 时回执现场出示台账证据**：引用值+台账 output 尾 200 字+「值的键≠预测量键=测量口径错配——修探针或改先验」——引用时刻即核对时刻，防上下文漂移后抄错键/错位值；key 语义与引擎闸同一真相（probe: 后 trim 全串）
- 闸语义不动（纯展示辅助，零新增直拒——「闸只增不减」管直拒，辅助管可见性）
- 测试 131/131（+2：s8 可解析值清单 / s9 现场证据出示）
- 回退点：tag `v0.4.2`（5834a2f）；`pre-0.4`（0.3.3+S1）

## 0.4.2（2026-09-05）来源纪律（dogfood R1 分型数据驱动：18 条 re-linearize 中预言失效 13/72%）
- **新 · 预测 source 三形式闸（declare 直拒+教语法，定理4 扩展）**：自由文本 source=隐式先验冒充标准——分型案底共同形式（先验估算/未先实测/源读不全/机制外推）。三形式：`read:<path>#L<n>` 读锚点（引擎机械核验文件在位+行存在且非空，≤2MB 文件行级核验——「源读不全」案底直修：引了不存在的行=直拒）/ `probe:<key>` 探针台账（预测值含数字则该数字必须出现于实跑 output——「伪造测量」案底直修：探针没跑=台账无 key，数字编造=值不在 output）/ `prior:<文本>` 显式先验（诚实先验计数展示入回执「来源：read×N probe×M prior×K（⚠显式先验×K）」，不静默当标准）
- **新 · probe_record 工具（十三名，TOOL_NAMES 13/13 合同随动）**：先实测后预测——实跑 cmd（≤20s，node 解析与 measureReads 共用 resolveNodeCmd 单一真相）落会话探针台账（output 尾 1000 字+exit，<sid>.probes.json 按会话隔离）；declare 时引擎只读复验（exec 在工具面、纯函数面不变）
- **迁移 · 测试面来源语法**：全仓测试预测项 source 迁三形式（prior: 前缀批量迁移脚本存 dsh-实测归档/closedloop-04-dogfood-r3/migrate-test-sources.mjs）——断言项 source（Q_N 合同面）不动，定理4 空源闸先于来源闸触发（顺序=先判存在再判形式）
- 闸位：来源闸叠加于定理4 之后、measure 通道闸之前（闸只增不减合规）；模型签名含 source 串 → 旧自由文本签名与 prior: 签名不同源（重 declare 语义自洽，非误杀）
- 测试 129/129（+7：prediction-source.test s1-s7——read 锚点四形态 / probe 台账三形态 / prior 计数 / 自由文本教语法 / probe_record e2e 先实测后预测全链 / key 形状闸；wiring p0 十三名合同）
- 回退点：tag `pre-0.4`（0.3.3+S1）；0.4.1 三修=0701e98/6b93c1a/ef8a992

## 0.4.1（2026-09-05）dogfood R1 三修（全自动体验单实测摩擦驱动，零用户确认）
- **修 · F1 autoConfirm 直认优先（用户实喊「怎么还在让我确认」的回归修复）**：0.3.2 把确认改为强制先弹窗、autoConfirm 降为「弹窗被取消后的回退」——autoConfirm=true 时授权被弹窗截胡（实测：R1 单 freeze 弹 UI，用户手动取消才落回退）。现 settings.autoConfirm=true → freeze 本调用内直接确认开快环（scanLog 留痕 head=freeze-direct），不弹窗；off=弹窗主权原样保留（p8 双面回归）。readAutoConfirm 单一真相移 mode-state.js（index 与 tools 共用零拷贝）
- **修 · F2 测量读数失败诊断携脚本 stdout 尾行**：V 读数诊断此前只带截断的「Command failed: <命令前 60 字>」——模型看到命令而非病因，不可行动。现诊断附脚本最后一行非空输出（FAIL 原因，80 字上限）（p9）
- **新 · F5 audit_record 审后 V 重锚（vAfterAudit）**：redteam 审计 verdict 翻转审类断言读数（z 0→1），不重测则 V 曲线冻结在审前值——R1 实测终态 V=0 未落锚，曲线讲「卡死在 4」的假话（后续 P3 证伪实验的 V 曲线数据源失真）。现 audit_record 落盘后重测，vAfterAudit 条件展开落档（round-trip 严格等值防键漂移，p10）；v=闭合时刻值不可变=历史；阻尼/面板 V 序列取每动作最终态（vAfterAudit ?? v，d13：v 全同但最终态震荡 → D 行不被 v 序列的平台语义遮蔽）
- 数据（本轮体验单产出）：主会话 18 条 re-linearize 归因史四分类——预言失效 13（72%）/ 前提变更 3 / 协议摩擦 1 / 闸门设计 1：回滚率主体是模型预测失败而非协议格式税 → v0.4.x 优化主攻方向=预测来源质量（见 D:\dsh\dsh-实测归档\closedloop-04-dogfood-r1\）
- 测试 121/121（+4：p8 F1 双面 / p9 F2 / p10 F5 全链 e2e / d13 最终态序列）

## 0.4.0（2026-09-05）v0.4 转正版（S2 阻尼外环接注入面 + 工具注册 12/12 + 版本切 0.4）
- **接 · 阻尼外环上注入面（P2-1「代码全在，只差 index.js 接线」闭合）**：V 序列=盘档 closed[].v 机械直读（模型无口头空间）；rolling 段信号触发（平台 I/震荡 D/高 V P）→ 至多多注一行短句；无信号=静默（零仪式税）；幂等键=信号组合本身（face-spam 案底纪律：键=状态读数非步数）；触发留痕 console 一行。IOU 借据账本尚未入盘档 → iouSurge 静默=诚实位（无信号不装）
- **修 · measure_propose 注册漂移**：TOOL_NAMES=12（S1 合同，wiring.test p0 断言）而 defs 数组漏挂 measureProposeDefinition → 每次启动 drift warn；现 12/12，棘轮工具（判分器单向阀）真正常驻
- **切 · VERSION 0.3.3 → 0.4.0**（inject-text.js 唯一真相；/optimal 回执与 off 回执随动）
- 闸不动：ΔV 序带×数值对×双通道三要素原样——band 三档降级纯显示 / V 曲线进面板 = P2 余项（S2-2/3），下步单独走
- 回退点：tag `pre-0.4`（0.3.3+S1 全量快照，用户拍板「当前0.3先git一遍方便回退」）
- 测试 117/117（v0.4-damping +5 接线面回归：无 V 静默 / I 信号+键稳定 / D 信号 / P 信号 / 单调静默）

## 0.3.3（2026-09-04）maintain 版（用户开发体验反馈直采·验证类任务死锁根除）
- **新 · vExpect='maintain'（第三态）**：保持目标态=合法闭环——闭合条件 before=at 且 measured=at，无回升义务、不挂 dipPending、回 at 清一切旧账（与饱和步同口径）；declare 回执自带语义注记。此前 at 档验证步只有两条邪路：谎报 improve（被拦）或借 dip 编回升故事（本会话现场活证：主会话为过 at→at 闸被迫 rollback+虚构「回升计划」——闸逼人讲故事即闸的失败）
- **修 · 拒绝文教路**：at 档 improve 谎报的 ΔV 拒绝文本现明示 maintain 出路（「验证已达 at 且保持」应 declare vExpect='maintain'）——出路必须在违规现场可见，不靠模型回忆条款
- 边界照守：maintain 在 far/near 档直拒（未达目标谈保持=逃避改善义务）；maintain 步测后掉档直拒（倒退≠保持，走 rollback re-linearize）——诚实报档优于硬凑闭合
- 测试 78/78（新增 maintain 五面回归例：正路闭合/清旧账/非 at 拒/倒退拒/拒绝文教路）

## 0.3.2（2026-09-04）会话实测补丁版（session 06dcbf00 归档分析·三 Bug 全闭环）

- **修 · 数值闸 Bug-A（converge 过严）**：`declare` 含数字预测时，`converge` 的 agreed 若未覆盖该 key（用户尚未填测量结果）→ 原来误杀整体拒绝；修复：先判断 agreed 是否覆盖该 key，无覆盖则跳过（等待测量声明），有覆盖但缺 `≠` 才要求补格式——教学/演示场景不再被闸卡死
- **修 · askUser CALLER_NOT_LIVE 未预判 Bug-B（freeze 弹窗在 subagent 里抛异常）**：`freeze` 在 subagent 里调用时 runtime 抛 `CALLER_NOT_LIVE`——原 catch 吞错回「UI 确认」假成功，模型误以为用户点了确认继续走后续流程；修复：`askUser` 入口预判 `agent.session?.id` 不存在直接回退文本/autoconfirm，不触发 runtime 异常
- **修 · injected 幂等标记误清 Bug-C（onWeightsUnlock 清了注入记录导致 face 重复刷屏）**：解锁（weights→brainstorm）时 `onWeightsUnlock` 执行了 `injected: new Set()`——幂等键全清，下次 rolling 进 face 重复注入；修复：解锁只改 stage 回 brainstorm，注入记录跨解锁保持
- **新 · declare/converge/rollback 链路自演进**：数值预测 key 不匹配场景走「覆盖检查→无覆盖跳过→用户补测量→下次闭合」自然路径，无需 rollback；教学演示不再因闸设计过严被迫回炉
- 77/77 测试全绿（含新增 `v-no-cover` 场景测例）；热重载已生效

## 0.3.1（2026-09-04）体验补课版（用户新会话实测三缺+现场幻影案全闭环·本单由 v0.3 引擎自跑）
- **修 · dip 登记合法性（体验单缺陷①活板门）**：before=at 且 measured≠at 的 dip 登记直拒——不可满足的债务不配登记；报错自带出路（at 档只可收 at→at 饱和步，真倒退走 rollback re-linearize）
- **修 · 回 at 即清（缺陷①建议采纳+②死锁根除）**：improve 步达 at 或饱和步清一切 pendingDip（含旧引擎登记的存量死角）；末组收口三角死锁随之消解——未开 ΔV 旁路（用户裁决维持）
- **修 · 幻影 off 真凶（本会话两次清账悬案告破）**：pre-step 触发扫描全史重扫——命令回显滞留历史，每步重扫到就重执行 off。改为只评最近一条真实用户消息 + off 双确认 10s 窗口 + 执行前状态面自动备份 + armed/executed 留痕日志（含 sid）
- **修 · 确认扫描形状兼容+可查账**：消息 content 字符串形兼容（「继续」不翻转根因之一）；scanLog{len,intent,stage,head} 落盘——扫描看见了什么从猜测变读账
- **新 · autoConfirm 授权通道**：settings.autoConfirm=true 时 weights 自动确认并留痕（scanLog intent=autoConfirm）；授权凭据写死设置文件（用户原话『要能直接跳过确认环节完全自主』）；默认关闭=人工确认主权不变
- **新 · final 自启动正式化**：final+全组 settled 态 cost_set 自主开新单（trigger 语义，旧单 V 账本栈不抹）——t10 单元实演+本单恢复路径活证双凭
- 注入幂等提取 faceDecision 纯函数（可测）+inject 日志含 sid；三回归例入册（体验单序列原样回放）
- 测试 75/75（尾行可重跑）；本单全程 v0.3 引擎自驭，含回炉自证：agreed 邻接格式违规被自家数值闸当场作废重宣

## 0.3.0（2026-09-04）闭环定序版（THEORY-v0.3 定理7 · 策略驻留引擎，轨迹涌现回路 · **breaking**）
- **breaking · 块级轨迹冻结废除**：freeze 语义改为锁**权重+组结构+约束**（单一锁点 weightsLocked），块级序列与 vChain 块档链合同整体移除——动作由快环每步实时提议（cost-to-go 最小者），规划降级为先验，权重才是合同。旧盘档 v2 经 migrateLegacy 只读迁移（零回写；对照组 tag v0.2-baseline=5cea82f 冻结，旧目录全程 git 零改动）
- **breaking · 差分契约 args=diff / engine=merge**：optimal_declare 收 {title,group,predict,channels,可选覆写}，链式量（beforeBand=盘档 lastBand 直读）、Q_N 成本投影、法基行由引擎物化后过**同一道闸**——契约书写 3.9KB/块→**0.4KB/动作（-89%，fit-plant 现跑复现）**，手抄错漏错误类整体消失
- **breaking · 另头审上线（audit_record，工具 10→11）**：redteam 动作闭合后引擎从栈文件**机械切审材**（非全栈复读），fresh 子代理直读盘档审推导链，回执**引文必须为栈文件逐字子串**（parseVerdict 伪造即拒；手动 cost_audit 同形同闸），verdict≤1KB 落账 closed[].audit。活证三态：reject 真拦落账（smoke#1 审出预测建模缺陷 4 issues）/pass 放行（smoke#2 引文×4 全真）/饱和归零（smoke#3 zero=true）
- **breaking · 第5闸「无测量不放权」**：merge 后 channels<2 → 准入=重流程（完整仪式+引导三要素），双通道闸不豁免——引导=补通道或降提议态，无绕闸第三位
- **修复 · 开发段可逆（a2）**：确认/修改翻转扫描覆盖 weights+rolling 全段（v0.2 只接 review 段——本单实证缺陷：develop 段用户改口只能 off 重开）；onWeightsUnlock 单口解锁，已闭账分毫不动（wiring p2 测例锁死）
- **修复 · 数值对硬校验（冒烟#1 活证两洞，当场修）**：agreed 从「格式含≠」升为「实测 <A> ≠ 预测 <B> 数字对且 A==B」——「实测13≠预测14」错配与「尚未发生」占位强制转不吻合当场作废；smoke#2 故意错配被拦原文在栈（rolledBack diffs 活证）
- **修复 · 底档 dip 饱和（smoke#2 死锁活证→smoke#3 复验）**：末动作落 at 档时 improve 必拦、dip 回升义务不可满足的死锁——after=at 的 dip 判 dip-saturated 不挂账并清同档旧账；terminalCheck 饱和口径同步（dipPlan 谎报 improve 照拦，闸只增不减）
- 教育=违规事件：讲课件自周期注入全撤（inject-text 薄面=off 回执+版本双导出，测例锁键集），常驻面=stateFace 纯函数（真档实测 740B；冒烟注入均值 206B/帧 vs v0.2 开局 2-3KB）；条款住进拒绝文本（本会话 declare 漏 law 被直拒=现场活证）
- 量尺转正 scripts/fit-plant.mjs：discrepancies/rolledBack 提取按盘实况修正（前版恒 0 缺陷入回滚史）；死会话逐值/活会话单调/篡改自测三制式；inj 口径 v1→v2 变更史在脚本头（两代并存可稽）
- 面板/端点追 v3 键面：panelBody 纯函数与端点同源（v:3·residual·groupsBrief·audit·无 costRemaining，真会话 curl 活证 HTTP200/无档 404），client v3 主读+旧键回退+降级不白屏守卫；**localhost GET 穿认证**（旧「curl 通道不可达」结论修正）
- 换代窗口纪律两轮活证：卸2挂3冒烟挂回，真账形状零污染（v0.3 写面隔离 .closedloop.json，主 .json v0.2 形状全程 intact）
- 测试 71/71（十文件规范命令尾行）；五闸+第5闸+a2→测例映射表 docs/TEST-DISPOSITION.md（旧 97 例逐用例处置）；冒烟读数对照表 docs/FIT-plant.md v0.3 追加段
- 未执行如实标注：**A/B 五域对照=用户撤销未执行**（预测表「未经对照验证」开放项，见 docs/CLOSEDLOOP-DELIVERY.md 遗留）；模型层参数接线=未做（面板 modelState 诚实占位）；declare 底档 dip 警示文案未同步饱和规则（误导性残留，v0.3.1）

## 0.2.0（2026-09-04）范式替换版（SPEC-replace v0.2 · 控制循环即状态机 · **breaking**）
- **范式彻底替换（非移植）**：状态机=控制环本身——代价标定→分解→冻结（档链机械生成）→滚动闭合→终端归零校验；v0.1 的"契约移植"废案
- **breaking · mark_task 删除**：旧机制终结——闭合唯一通道=optimal_converge 三要素（ΔV 序带严格降 × 数值「实测≠预测(通道)」异源复算 × channels≥2 标识两两不同），closed=V 账本锚点自动落账推进
- **breaking · 三选一 mode 废除**：correct/experience/research 三选一 mode 题取消（判定重心由代价档位承载）；cost_set 的 mode/requirements 旧参数显式拒收
- **breaking · 工具集换血为 10 件**（TOOL_NAMES 唯一真相，注册漂移 warn）：decompose / freeze / cost_set / cost_audit / revise_do / optimal_declare / optimal_converge / optimal_rollback / optimal_stack / terminal_check
- **代价定稿硬门（cost_set）**：断言逐条 severity(minor/major/catastrophic)+source——无来源=断言无效（定理4）；nonGoals 仅随用户选择题确认落盘（定理1 确认制，AI 直写=拒）；失败态权重→∞=防错选标准
- **代价对抗审（cost_audit）**：scope=group/block 冷视角找茬（source 真实性/语义收缩/law 前置），reject 必附证据清单，打回修复须再审；红队块过审才滚动
- **vChain 全局档链**：freeze 按块序机械生成 vIn→vOut（far/near/at，末块必 at）；链不连续=拒锁（生成防线）；块级 dv=局部档与全局期望并存不对表（三档粒度下中段平台属固有）
- **terminal_check 唯一 throw 位**：非 final 态直拒；全链唯一归零验证点，非零=报告交处置不阻断；**报告落盘 terminalReport 字段**（真跑坑③修复：判据要求落盘而实现缺失）
- **观测量自指禁令入 convergeLaw**（真跑教训固化）：凡引用盘档/栈演进量的预测必须写成跨通道动态等式，禁钉历史快照字面量（declare 自身即推入新 open 步）
- **形状契约直拒**（真跑坑①②修复）：measure.channels 非数组→契约文案回执+引擎兜底，原生 TypeError 消除
- **面板主体=V 账本**：/panel 只读端点（vLadderOf 与 stackText 同源）；档链阶梯全量节点+dip 挂账+剩余代价读数+openStep 活体行；计划树降为可展开细节
- **禁词表裁判制**：7 条禁词以 tests/lingua-forbid.test.mjs 为唯一真相源，src/**.js 全扫零命中强制（交付文档同受扫）
- 盘档 v2：stage/task/cost{assertions,nonGoals…}/plan/vChain/l1Locked/injected/terminalReport；旧 star/redteam 键只读兼容一周期；mode 键零读者零作者清除
- 自驭真跑验证：本版本由插件自身驱动完成全程（P 场会话 cost_set 8 断言→3 块闭合→terminal_check 归零），真跑反馈 6 处当场修，无默吞
- 测试 96/96（五文件规范命令实测尾行）

## 0.1.0（2026-09-03）最优律驱动版（SPEC-optimal v0.1-approved · LQR 结构律落地）
- **predict→optimal**：四工具换契约——optimal_declare 新增 cost 权重（Q/R 物化,失败态→∞=防错选标准）、law 偏差策略（≥1 条,消灭"调试"态结构位）、measure 双通道（≥2 独立标识,定理5）、vExpect ΔV 序带预期（improve|dip,dip 须回升计划）
- **converge 三要素硬闸**：ΔV cost-to-go 序带（far/near/at）严格下降 × 数值「实测≠预测(通道)」非同源复算 × 双通道一致；closed=V 账本锚点自动打卡
- **rollback=re-linearize + 反漂移签名**：来源/权重/不变式至少一易,同签名重 declare 引擎直拒（定理6）；连续 dip 禁止,回升义务挂账核销
- **无降级通道（拍板 D）**：mark_task 删除 offline derivation 兜底——无 optimal 工具=不得打卡
- 写闸前移：revise_do 栈顶 open 硬拒；pre-step ④ 栈提醒（open/invalidated 幂等键）；lock_stage L2 回执附 backward 价值链（拍板 E：accept 计数初档）
- 状态文件 .predict.json→.optimal.json（load 自动迁移）；目录/包/插件名统一 dsh-optimal-mode（拍板 F：新目录演进,原 dsh-graded-predict 保留回滚）；API 路径 /graded-mode/* 保留（client 契约）
- 诚实边界：借用 LQR 结构律,不声称数学等价；文献（Kalman1960/Bryson-Ho/Anderson-Moore/Mayne2000）正式引用前按先审校纪律复核


## 0.0.1-rc1（2026-09-02）Release Candidate
- 注入淤积根治：focus 幂等键去 status（状态抖动不再重注同名引导）；执行端续轮 followup→steer + 同 turn 60ms 引导合并（消除 next-turn 堆积）
- 面板稳定：会话感知三级回退（URL/历史解析 ?sid=/盘 mtime）+防错显示；**设置面板闪退修复**（effect 一次挂载+回调 ref 化）
- 概念上限动态化：loadConceptLimit 读路径对齐设置 API（此前写读不一致致设置失效）——phaseL2/焦点注入/schema 描述全随设置（实测 8 全链断言）
- 面板视觉：已完成组默认折叠+组进度徽标+完成态侧条
- 测试 62/62；`0.0.1-exp` 为前一实验版（历史保留）

## 0.0.1-exp（2026-09-02）体验实验版
- 脑暴出题制：ask_user_question 选择题对齐（多轮歧义结清）+必选模式题（用户点选，经 commit_star(mode) 落盘）
- 时序修复：大小类引导走 next-step（同轮即时，无过期）；锁定回执=完整规格单；审核唯一确认请求；『修改』回滚开口（reject-ack）
- 小类粒度模式 item.mode（缺省继承会话；scanMode 只认用户=防漂移）
- 北极星锚定替代"开工前自问"；委派允许情景改写（验收锚=盘档规格）+委派通道自主决策（后台/阻塞）
- commit_star 修订保留阶段（修复回退 bug）；focus 模式标注修复；开源脱敏（发布面路径占位/os.homedir 回退/硬编码净化+红队两轮复核）

## 3.1.0（2026-09-01）规格化重设计
- 脑暴链→commit_star 定稿；规格化两级计划（spec/accept/do/verify 必填门控）
- 注入规格前置三段式+委派/编排/红队/双轨 skill 卡；组收官逐条核对+verify 注入
- 状态磁盘单轨（热重载零中断）；审计端点；超级面板（三层树/量化/北极星/红队灯）

## 3.0.0（2026-09-01）正式版
- 两级任务协议：大类→锁定→小类→锁定→树状审核→打卡制开发→组收官→终验
- 三模式包（correct/experience/research）；先注后键单注；当下态回执
