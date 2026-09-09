# TEST-DISPOSITION — v0.3 测面处置台账（生成器：gen-disposition.mjs，禁手填）

- 旧五件用例真数：**97**（40+20+14+19+3）——逐用例归类如下；废件留底 tests/_legacy/（.bak 后缀不入发现面）。
- 五闸+a2 映射（accept2 面内可数）：

| 闸 | 新位测例 |
|---|---|
| 定理4 无源=无效 | optimal.test「declare：无源预测声明期直拒」+ tools-v3 t2 + contract-merge p2② + tools-v3 t2(cost_set 缺源) |
| 定理5 双通道≥2 | optimal.test「缺双通道=拒」「通道同源=拒」+ contract-merge p2②/p3 |
| 定理6 签名反漂移 | optimal.test「rollback 记签名；同签名重 declare 直拒；改来源放行」 |
| 终检归零 | mode-state-v3 p5 + tools-v3 t7（throw 位+报告落盘） |
| 第5闸 无测量不放权 | contract-merge p3（heavy 引导三要素+拒照旧+light 对照） |
| a2 开发段可逆 | wiring p1（意图纯函数）+ p2（rolling 段修改→解锁账存）+ index scanIntent 全段接线 |

- 三源对账：A=活文件 test( 声明现数 **65**（9 文件：audit-dispatch×4、contract-merge×5、inject-text-v3×3、lingua-forbid×3、mode-state-v3×8、optimal×20、propose-text×6、tools-v3×9、wiring×7）；B=套件尾行 pass 数（npm test 现跑）；C=package.json 清单与 tests/ 活文件互列 **相等 ✓**。

## 逐用例归类（97 条）

| 旧件 | 用例 | 处置 | 去向/理由 |
|---|---|---|---|
| mode-state | onReviewRejected 智能回滚：默认回 l2-edit（ | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | loadConceptLimit：无覆盖文件读全局/有覆盖覆盖优先/ | 直迁(并作) | mode-state-v3 p8 设置读取 |
| mode-state | initMode 全开未锁,stage=off | 直迁(补覆) | mode-state-v3 p7 存活件 |
| mode-state | trigger（v0.2）: off → brainstorm（代价 | 直迁(补覆) | mode-state-v3 p7 存活件 |
| mode-state | onCommitStar：from-brainstorm/off→l | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | normalizeCost：任意形态容错 + 旧 star 形状继承 | 形变 | mode-state-v3 p7（字符串条目=旧盘档继承标记） |
| mode-state | deactivate 回零 | 直迁(补覆) | mode-state-v3 p7 存活件 |
| mode-state | onEditL1: 树只有组头（组规格字段入树） | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onEditL2 保留组规格（prev 回填,组名一致） | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | assertL1Items: 空/重复/缺 spec/缺 accep | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onLockL1: l1Locked + 切 l2-edit | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | assertL2Groups: 缺大类/改名/新增/重复/缺规格/O | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onEditL2: 完整树入 plan（概念保留） | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onLockL2: 双锁 + review | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onReviewApproved → develop | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | onReviewRejected(toL1) → 全解锁回 l1-e | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | currentFocus: 第一个未完成 / 全完成返回 null | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | groupDone / allDone | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | treeText: 组头行 + 缩进子行 + 3.1 规格摘要（纯展 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| mode-state | onMark L2: 标定 in_progress 单线聚焦（同组复 | 随旧路废 | 对象件不存在于 v0.3 码面（_legacy 留底可稽） |
| mode-state | onMark: 未知标题/L1 未全完被拒,L1 全完可标 | 随旧路废 | 对象件不存在于 v0.3 码面（_legacy 留底可稽） |
| mode-state | onMark 纯函数：不修改原 state | 随旧路废 | 对象件不存在于 v0.3 码面（_legacy 留底可稽） |
| mode-state | serialize/deserialize 往返（热重载恢复） | 形变 | mode-state-v3 p1 round-trip（含 terminalReport 存活面） |
| mode-state | auditBody：注入前缀聚合 / 指纹稳定 / redteam  | 形变 | index.auditStat + tools-v3 t7 断言 |
| mode-state | normalizeItem（v0.2）：未声明 do/verify= | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | deserializeState 非法输入回 initMode | 形变 | mode-state-v3 p1 round-trip（含 terminalReport 存活面） |
| mode-state | vChain：normalize 容错 + 连续性三态 + dip  | 随旧路废 | 块级档链=轨迹合同，定理 7 废除对象；链式量新位=surface.lastBand（wiring p3） |
| mode-state | advanceOnClosed：闭合即推进（focus 滚动 + 全 | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | settleGroups：组全闭合→对抗审门+子空间核对→自动落账 | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | 旧盘档只读映射：star/mode 键 → cost 继承，mode | 形变 | mode-state-v3 p3 真档迁移等式 |
| mode-state | serialize∘deserialize 往返含 vChain/c | 形变 | mode-state-v3 p1 round-trip（含 terminalReport 存活面） |
| mode-state | 文件级把关：mode-state.js 无三选一残留（/\\bmod | 形变 | mode-state-v3 p2 写面 grep + lingua 全套 |
| mode-state | STAGE_SEMANTICS：六键全映射 | 形变 | mode-state-v3「STAGES 五态且迁移映射完整」 |
| mode-state | subspaceCheck：绿态（全 completed+全 clo | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | subspaceCheck：串值态（completed 但无 clo | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | subspaceCheck：未清零态（块未 completed） | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | subspaceCheck：dip 挂账未清=不过 | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| mode-state | terminalCheck：非终态 throw（唯一 throw 位 | 形变 | mode-state-v3 p5（v3 签名）+ tools-v3 t7（throw 位+报告落盘） |
| mode-state | terminalCheck：非零=报告不阻断（remaining/n | 形变 | mode-state-v3 p5（v3 签名）+ tools-v3 t7（throw 位+报告落盘） |
| mode-state | terminalCheck：归零态（全 completed+全 cl | 形变 | mode-state-v3 p5（v3 签名）+ tools-v3 t7（throw 位+报告落盘） |
| tools | definition 形状：decompose/freeze 参数与 | 形变 | wiring p0 键集 + tools-v3 t5/t6/t9 |
| tools | decompose：未激活拒/未定稿拒/一次提交树完整（组含块） | 形变 | tools-v3 t5（组级门） |
| tools | freeze 后 decompose 被拒（冻结即锁，解锁唯一入口= | 随旧路废 | 对象件不存在于 v0.3 码面（_legacy 留底可稽） |
| tools | decompose 结构门：组无块=拒；块缺 do/verify=拒 | 形变 | tools-v3 t5（组级门） |
| tools | freeze → review：回执含档链（末块 at）+完整规格评 | 随旧路废 | freeze 不再产轨迹档链（定理 7）；v3 面=weightsFace 评审单（tools-v3 t6） |
| tools | freeze 多块链（N=2）：链含全部块、逐块承接、末块 at（判 | 随旧路废 | freeze 不再产轨迹档链（定理 7）；v3 面=weightsFace 评审单（tools-v3 t6） |
| tools | freeze（review 重入）→ 幂等保持 review，树与链 | 随旧路废 | freeze 不再产轨迹档链（定理 7）；v3 面=weightsFace 评审单（tools-v3 t6） |
| tools | cost_set 自主激活：off → 定稿即激活 l1-edit； | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | cost_set 门控1：assertions 空=拒（无断言=无代 | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | cost_set 门控2：缺 severity 档=拒（指明 ass | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | cost_set 门控3：缺 source 来源=拒（定理4：无源= | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | cost_set 门控4：nonGoals 无确认位=拒；确认落盘 | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | cost_set 门控5：合规落盘含档位分布+旧参数显式拒+deve | 直迁 | tools-v3 t1-t4（激活/三门/nonGoals/旧参数/锁只读） |
| tools | freeze 复检：规格不全被拒且状态不污染（先复检后写入） | 形变 | tools-v3 t5（组级门） |
| tools | cost_audit：非 adversarial 拒 / rejec | 形变 | audit_record 引文硬验（audit-dispatch p2 + wiring p4）；自演同闸（cost_audit 别名） |
| tools | revise_do：开发期改形态登记轨迹；枚举无效拒；verify  | 直迁 | tools-v3 t8（组级） |
| tools | 对抗审链：未过审不推进 / 过审自动推进 / 无闭合推导先过审仍不推 | 形变 | wiring p4/p5（redteam 落账门双向） |
| tools | 工具集唯一真相：TOOL_NAMES=10 名（mark_task  | 随旧路废 | 块级序列/items 状态面废除；组级等价=onGroupsEdit+trySettleGroups（wiring p5）+decompose 门（tools-v3 t5） |
| tools | 6 工具定义形状：name/parameters 必填枚举齐全（v0 | 随旧路废 | 对象件不存在于 v0.3 码面（_legacy 留底可稽） |
| tools | advanceAndClose：阶段门+单线聚焦（declare i | 随旧路废(等价新位) | recordClosed+trySettleGroups（wiring p2/p5）；打点位保持零复活（wiring p0 无 mark_task） |
| inject-text | 六态入口件齐（与 STAGE_SEMANTICS 对应） | 形变 | mode-state-v3「STAGES 五态且迁移映射完整」 |
| inject-text | costCalibrateGuide：选择题+档位题+确认制+闭环兜 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | decomposeGuide：单块门禁+容量带+不变式衔接+deco | 随旧路废(等价新位) | recordClosed+trySettleGroups（wiring p2/p5）；打点位保持零复活（wiring p0 无 mark_task） |
| inject-text | cycleFocus：判定标准前置 + 预言家岗位 + 基线 + 闭 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | cycleFocus/cycleLast/cycleGroupOpe | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | convergeLaw：统一基线（三要素+dip+定理6，无三选一分 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | cycleGateNote/verifyHint：分档与提示 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | formSection/skill 卡：委派与编排的盘档标准纪律 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | settleGuide/settleNote：组全闭合→四档落账指路 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | specSheet：cost 断言档位分布 + 阅读树（v0.2 键 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | rollingKickoff/northStar 系：入场宣言+长版 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | starAnchor/starPurpose：目的锚定一行+取源 c | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | rejectAck/offReceipt/terminalGuide | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| inject-text | doSummary/verifySummary：选项一句话摘要 | 随旧路废 | 讲课件撤销（定理 7/教育=违规事件）；offReceipt/VERSION 薄面=inject-text-v3 三例 |
| optimal | declare：缺 law=拒（消灭调试的结构位）；缺双通道=拒；d | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | declare：无源预测声明期直拒（v0.3 定理4 硬化位——v0 | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | declare 正常：open 落盘,回执含契约计数（v0.3 需  | 形变(#21) | v3 段门+closed 面断言（本文件内已形变） |
| optimal | converge：缺 dv=拒（ΔV 不报=未验证） | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge：ΔV 不降（far→far）=拒并提示 re-li | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge：通道同源（标识重复）=拒（定理5 同源不计） | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge：数值预测无「≠」复算=拒（防自我认证假锚） | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge：discrepancies 非空 → invali | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge 三要素全过 → closed + vLedger  | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | rollback 记签名；同签名重 declare 直拒；改来源放行 | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | dip：预声明步 V 不降可闭合但挂 pendingDip；连续 d | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | dip 清偿：后续改善步闭合后 pendingDip 清除 | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | 打点位已从导出面消失（tools 无 markTaskDefinit | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | converge 自动落账（v0.3 形变）：closed 入盘档已 | 形变(#21) | v3 段门+closed 面断言（本文件内已形变） |
| optimal | rollback reason<8 字拒绝；closed 锚点不可撤 | 形变(#21) | v3 段门+closed 面断言（本文件内已形变） |
| optimal | 旧 .predict.json 自动迁移为 .optimal.jso | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | valueChainText：空=[]；3 小类=远档初值 | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | costBand 边界四点（0→at/1→near/2→near/3 | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | vLadderOf：closed 序列+dip 挂账计数（open  | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| optimal | stackText 与 vLadderOf 同源（时间线含挂账注记） | 原样保留 | 引擎四闸测（直调 declareStep/convergeStep，无段门依赖） |
| lingua-forbid | FORBIDDEN 表=7 条（唯一来源，实现侧不得另立表） | 原样保留 | 本文件在套件内（三例全活） |
| lingua-forbid | 裁判自测：含禁词的合成输入必报命中（防永远绿的假闸） | 原样保留 | 本文件在套件内（三例全活） |
| lingua-forbid | src/**.js 全目录禁词零命中（拦截即暴露残留，销词不销表） | 原样保留 | 本文件在套件内（三例全活） |
