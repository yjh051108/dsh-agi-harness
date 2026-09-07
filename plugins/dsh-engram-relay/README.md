# 风识 FengShi · DSH 统一大脑

> 跨会话记忆图谱（agent 自组织）＋ 灵枢知识校准器（白箱验证）＋ 浅思维自动注入 ＋ 自动补卡/补簇 ＋ 跨端联动（知+忆）。
> 让 DSH 的 agent 拥有「记得住、懂得多、不硬答、当场学、学得快」的外置大脑。
> 百查询出招正确率 ~90%；闲聊/新域零污染（诚实边界）；使用者自己补卡/补簇当场生效。

## 是什么

风识是一个 DSH 插件，把记忆与知识融合为**一张自组织语义图**：

> **一体两器官（r60 定版，详见 AGENTS.md 同名节）**：知识=去情景可共享（学科卡），经验=带情景第一人称（节点/因果/确认制）；融合在接缝不在合并——verify 四态带 `📎 相关记忆`、respond 命中亦回头找经验、双不会共学一环、命名空间互不吞并（**合并是幻觉，互见才是融合**）。

```
统一自适应语义图（agent 建边 · 强化遗忘 · 软簇）
 ├─ 存储层：节点=记忆/概念（蒸馏+agent 织网），跨会话分层 global/project/session
 ├─ 召回层：哈希+纯算法语义匹配（SemanticScorer 三通道，零模型）
 ├─ 浅思维：图上算子（条件/验证/边界）→ 每轮自动注入 3 行
 └─ 深挖层：15 个工具（recall/store/open/link/verify/respond…）渐进披露

灵枢（常驻校准器）：
  · D_norm 验证闸门——记忆敢想，灵枢把关敢不敢说对
  · 诚实边界——不知道就说不知道（不裁决，防过度自信）
  · 自动补卡——agent 求助且无答案（双不会）→ 当场生成知识卡 → 下次即有
```

## 设计原则

- **零 embedding**：语义匹配为纯算法（词汇 n-gram / 共现桥 / 图传播），可解释、可审计；ONNX bge 仅作对比验证（显式配置启用）
- **算法是参谋，agent 是主人**：建边由 agent 决策，算法只给候选建议
- **浅注入，深挖掘**：每轮自动注入 3 行线索，细节由 agent 用工具渐进披露
- **人类式学习**：不会 → 求助 → 查不到 → 当场补卡（当日上限 5 张，防噪声）；弱命中高频 → 自动补词网（俗语→规范词桥接）
- **诚实边界**：证据不足不裁决，图谱外明说，绝不硬答

## 功能清单

| 能力 | 说明 |
|---|---|
| 记忆注入 | 每轮 API 调度自动注入相关记忆入口（记忆+浅思维三行） |
| 浅思维 | 条件（邻域 kind 分布）/ 验证（灵枢校准）/ 边界（教训邻域+边界词） |
| 自动补卡 | agent 求助无答案 → LLM 生成知识卡（空返回时启发式保底）→ 灵枢写入 |
| 自动补簇 | 弱命中查询 ≥3 次 → 从查询提取俗语词自动建簇（零 LLM，相关性质量门）→ 词网自组织 |
| 占位卡治理 | 无答案补卡的占位卡标 pending——不参与出招/验证（防污染），等 LLM 生成真卡 |
| 蒸馏保底 | 回合后 LLM 蒸馏；空返回时启发式直接沉淀（记忆不断流） |
| 自动成族 | 语义图软簇（层次聚类，分辨率可调）——无硬分类 |
| 跨域桥 | agent 跨域对话触发桥边——「融会贯通」的结构化形态 |
| **灵枢自愈**（v0.4.0） | 插件托管灵枢服务：未运行自动拉起 `start_lingshu.py`、崩溃按需重启（10s 冷却）、只 kill 自拉起进程（手动实例尊重）、不可用友好降级 |
| **过时记忆淘汰**（v0.4.0） | 闲置 45 天 + 重要度门槛 → 自动退役（退出召回，search 可见 🗄，open/confirm 复活）；蒸馏同题刷新/旧题接替；同标题只留最新；工具 `engram_retire` 手动处置 |
| **验证缓存**（v0.4.0） | 灵枢验证 LRU（TTL 10min）：同主题重复轮次零 HTTP；error 不缓存（恢复即重试） |
| 工具面 | 15 个工具：recall/store/propose/confirm/reject/open/search/link/update/remove/promote/status/verify/respond/retire |

## 装配（与本地一致）

### 1. 克隆与构建

```bash
git clone https://github.com/yjh051108/dsh-engram-relay.git fengshi
cd fengshi
npm install --legacy-peer-deps   # 依赖精确锁定（package-lock.json 已入库）
npm run build            # 构建 lib/（tsc host + tsdown client）
```

### 2. 装配到 DSH

```bash
# 方式 A：热装（免重启，开发用）
# 用 DSH 注入器 dev_inject_plugin 指向本仓库目录

# 方式 B：正常装配（重启生效，生产用）
dsh plugin --profile web add .
```

### 3. 启动灵枢云（校准器服务，127.0.0.1:18766）

```bash
python lingshu/start_lingshu.py    # 自愈 watchdog：崩溃 1s 自动重启
```

> v0.4.0 起可省略此步：插件（`lingshuAutoStart=true`）会在首次 verify/respond
> 时自动拉起服务；`npm run verify` 同样自动拉起（用完即停）。

### 4. 配置（cordis.patch.yml 或 schema 默认值）

```yaml
config:
  lingshuVerifyUrl: 'http://127.0.0.1:18766'   # 灵枢校准器（默认开启）
  lingshuAutoStart: true                        # v0.4.0 融合自愈：未运行自动拉起
  lingshuPython: ''                             # 灵枢服务的 Python（空 = 沿用 pythonPath）
  retireEnabled: true                           # v0.4.0 过时记忆淘汰开关
  retireAfterDays: 45                           # 闲置超过此天数 → 自动退役（可复活）
  retireMaxImportance: 1                        # 仅重要度 ≤ 此值可自动退役（0 = 关）
  embedModel: ''                                # 空 = 纯算法语义匹配（默认）
  distillEveryTurns: 2                          # 回合蒸馏频率
  injectBudgetTokens: 200                       # 注入预算（token）
```

## 验证（装配后 30 秒确认）

```bash
npm run verify    # 运行自检：服务健康（未运行自动拉起）+ 卡库 + 记忆库 + 浅思维冒烟
```

新会话里问：
- 「铁门放外面久了为什么生锈」→ 记忆/知识命中
- 「量子纠缠能不能超光速通信」→ 浅思维验证行（?图谱外 或 ✓锚定）
- 任意灵枢无卡的问题连续求助 → 自动补卡（~15s 生效）
- 过时记忆治理：闲置记忆自动退役（`engram_status` 看 retiredCount）/
  手动处置 `engram_retire` / 误伤复活 `engram_open` 或 `engram_confirm`

## 与本地一致的说明

发布包包含：插件完整源码 + 灵枢运行集（`lingshu/`）+ 卡库种子 + 装配脚本（git clone 后需 `npm run build` 产出 lib/）。
本地与大家装配的差异仅剩：DSH 版本与 node_modules 解析（README 与 INSTALL 已覆盖）。

## 架构文档

- `docs/unified-brain.md`：统一大脑架构（图网络+浅算子+校准器）
- `docs/unified-routing.md`：零 embedding 统一路由设计（含文献：WordNet 扩展 / PRF 共现 / SPLADE）
- `docs/INSTALL-new-machine.md`：换机装配指南

## 许可证

BSD-3-Clause（工程代码）。协议概念（智能论/信息差）权利归协议方。