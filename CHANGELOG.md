# 更新说明

## v0.3.16 — 变异审计纳保 rank-organ + pricing-organ（守护目标 8 → 10）

### 变更
- **`rank-organ.js` 与 `pricing-organ.js` 纳入变异审计**：65 个变异全部杀死（1.0）。7 条幸存变异逐条处置：
  - `gBandOf` 区间端点（`>=` 与 `<=` 都不能松；`G_BANDS` 下界变异）——用 1/2/3/5/6/10/11/99 八点边界断言。
  - `SEV_W.catastrophic` 4→5——用已知输入的 C 值钉死（0.7·Wilson(1/1)+0.2·(4/4)+0.1·1 = 44）。
  - `slips` 计数的 `.length+1`——三条回炉（含一条 external）断言 slips=1。
  - 空会话 `dV` 的 `vSeries.length+1`（会让 `1-undefined=NaN`）——断言 dV=0.001 且有限。
  - `savePricing` 的 `return true→false` 经机械核验判**等价**（唯一调用点是裸语句，返回值无人使用）→ `equivalents.json`。

### 验证
- 新增 `rank-pricing-guard.test.mjs` 4 条；全量 **445/445**；变异审计 **65/65 杀死**、等价 9；棘轮**十模块**均 1.0；账本快检 `目标 10 文件 · 变异 65 · 杀死 65 · 幸存 0` 退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.15 — 回炉归因结构化（cause）

### 变更
- **`optimal_rollback` 新增 `cause` 枚举**（`model` / `external` / `process-death` / `deliberate`，缺省 `model`）。此前「这次回炉算不算模型的判断失误」是靠**正则反解模型自己写的 reason 自由文本**（`rank-organ` 的 `/external|外部|用户改口|process-death|off/i`、`pricing-organ` 的 `/process-death|external|外部|用户/i` + `DELIBERATE`）——措辞一变判定就翻。现下游优先看结构化 `cause`：`rank` 只排除 `external`/`process-death`，`pricing` 只把 `model` 计入返工。
- **枚举外的值一律归 `model`**（默认计入——宁可算在模型头上，不靠措辞洗白）；`rolledBack` 条目落 `cause` 可审计。
- **存量兼容**：无 `cause` 的旧账本仍走原正则口径，判定不变。
- **探针键大小写修复**：`channelIdentity` 把 ref 归一为小写，而 `probe_record` 的 key 允许大写字母——旧实现 `hasOwnProperty(probes, ref)` 对 `MyProbe` 这类键必失败，导致 `dv.evidenced` 假阴性。新增 `probeKeyFor` 大小写不敏感查找。

### 验证
- 新增 `rollback-cause.test.mjs` 5 条（结构化落账/枚举外归 model/rank 结构化优先 + 旧账本兼容/定价只计 model/探针键大小写）。
- 全量 **441/441**；变异审计 50/50 杀死、等价 8；棘轮八模块 1.0；账本快检退出 0；弱断言报告 175 条断言 6 条弱；构建 36 文件；热重载 `active → active`。

## v0.3.14 — 弱断言扫描器（弱杀检测的第一块地基）

### 新增
- **`scripts/lib/assert-scan.mjs`（确定性分类纯函数）**：`classifyExpression` 把断言实参分三档——**strong**（含比较/逻辑/取反/量词：`===` `!==` `<` `>` `&&` `||` `!x` `.includes(` `.length` `.some(` …）/ **weak**（裸标识或成员链，只证明「真值」不证明值）/ **unknown**（函数调用等静态判不了）。`extractAssertArgs` 用括号配平抽取实参（字符串内的括号不干扰）。
- **`scripts/weak-assert-scan.mjs`（报告，退出码恒 0）**：逐文件 weak/total + ratio 降序最差清单 + 样例。npm 入口 `audit:weak`；另加 `audit:ledger`。

### 首次实测读数
- 66 个测试文件 · **断言 175 条 · 弱断言 6 条（3.4%）**——绝大多数断言带比较或量词；6 条里 3 条是本扫描器自身测试里的合成样例，1 条是 `assert.ok(f.ok)` 这类布尔契约断言。

### 边界（设计，不是 bug）
- **只报告，不扣分、不接硬门**：静态判定会误伤（`assert.ok(x)` 有时正是正确的契约断言），所以它进观测面，不进判分口径。

### 验证
- 新增 `assert-scan.test.mjs` 4 条；全量 **436/436**；变异审计 50/50 杀死、等价 8；棘轮八模块 1.0；账本快检退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.13 — 变异归因结构化（killedBy + attribution）

### 变更
- **每条变异落账带 `killedBy`**：审计本来就逐个跑映射测试、手里有「哪个测试文件红了」的数组，此前只拼进一句 `note` 字符串就丢掉了。现同时落结构化字段——「凭什么算杀死」可逐条追。
- **`summary.attribution` + `singleKiller`**：目标文件 × 测试文件的杀死计数矩阵，外加**单杀者清单**（只被一个测试文件杀死的变异）。实测 50 条里 **35 条是单杀者**——即大多数变异的守护只有一道，这正是弱杀检测要盯的地方。
- **统计口径抽成纯函数 `scripts/lib/ledger-stats.mjs`**：`countedOf` / `killRateOf` / `attributionOf` / `summarizeLedger`。审计脚本顶层有副作用（建沙箱、跑测试）不可单测，抽出来后账本口径首次有了单元测试。
- 账本快检 `check-mutation-ledger.mjs` 打印归因尾与单杀者前 6 条。

### 验证
- 新增 `ledger-stats.test.mjs` 4 条（口径/杀死率/归因只算被杀者/单杀者清单）。
- 全量 **432/432**；变异审计 **50/50 杀死**、等价 8；棘轮八模块 1.0；账本快检退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.12 — 变异审计纳保 gate-core + run-cmd（守护目标 6 → 8）

### 变更
- **`gate-core.js` 与 `run-cmd.js` 纳入变异审计**：50 个变异全部杀死（1.0）。5 条幸存变异逐条处置：
  - `wilsonLB` 公式系数变异 → 用**独立实现**核对数值（5/10 的 95% 下界 ≈0.2366 外部基准）。
  - `wilsonLB` 的 `!n || n <= 0` 的 `||→&&` → 负样本数必须返回 0（变异会算出 1.35）。
  - `recordGateEffect` 未知闸 id 严格返回 `null`（不是 `undefined`）。
  - `tokenize` 的 `started` 初值 `false→true` → 前导空白不得产出空 token。
  - `n <= 0 → n < 0` 经机械核验判为**等价**（`!n` 已短路 n=0，三种输入下结果一致），入 `equivalents.json`。

### 验证
- 新增 `gate-core-guard.test.mjs` 3 条；`run-cmd-tokenize.test.mjs` 补前导空白断言。
- 全量 **428/428**；变异审计 **50/50 杀死**、等价 8；棘轮**八模块**均 1.0；账本快检 `目标 8 文件 · 变异 50 · 杀死 50 · 幸存 0` 退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.11 — YAML 标量解析 + argv 单遍分词器

### 修复
- **模型指纹的引号污染**：`getModelFingerprint()` 用 `([^#\r\n]+)` 取 YAML 标量——`model: "deepseek-chat"` 会把**引号带进指纹**（同一模型被算成两个模型，分账错位）。现由 `yamlScalar()` 统一处理：去行尾注释（引号内的 `#` 不切）、成对引号剥离（含 `\"` 与 `''` 转义）。
- **内联流映射读不到**：`agent-default-model: {provider: deepseek, model: deepseek-chat}` 此前完全取不到指纹（旧实现只认缩进块形态），现支持。
- **argv 分词两处缺陷**（`run-cmd.js`，零壳协议的**执行入口**）：旧正则 `/"([^"]+)"|'([^']+)'|(\S+)/g` ①`+` 要求非空 → 空引号参数 `""` 退化成带引号 token；②双引号内转义引号 `"a\"b"` 被截断成两截。现改单遍字符扫描：引号仅在 **token 起点**生效（Windows 路径里的撇号 `C:\it's\x.mjs` 保持单 token——旧行为不破），双引号内只认 `\"` 与 `\\`（其余反斜杠是字面量，路径不被吃掉），空引号产出空串 token。

### 验证
- 新增 `gate-core-model.test.mjs` 5 条 + `run-cmd-tokenize.test.mjs` 4 条（含「引号不进指纹」「空引号参数」「路径含撇号」三条旧缺陷实证）。
- 全量 **425/425**；变异审计 38/38 杀死、等价 7；棘轮六模块 1.0；账本快检退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.10 — 变异审计纳保 tools.js（守护目标 5 → 6）

### 变更
- **`src/tools.js` 纳入变异审计**（最大的源文件，此前零守护）：38 个变异全部杀死（1.0）。7 条幸存变异逐条补断言杀死：
  - `cut()` 截断边界（恰好 80 字不截断 / 81 字截断 + 省略号）——杀 `slice(0,n)` 与 `x.length` 两处变异。
  - `measureReads` 的断言选取（无 measure 的断言不得混入）与空值契约（无测量返回 `null` 而非 `undefined`）。
  - 工具输出契约（`output.schema.additionalProperties === false`、`render` 返回文本块）。
  - `extractSigns` 的异步帧（`deriveMessages` 是 async——少一个 `await` 就采不到签名）。
- 新增 `tests/tools-mutation-guard.test.mjs` 4 条；映射追加该文件（新测试不进程映射=变异会幸存，v0.3.8 踩过）。

### 验证
- 全量 **416/416**；变异审计 **38/38 杀死**、等价 7；棘轮六模块均 1.0；账本快检 `目标 6 文件 · 变异 38 · 杀死 38 · 幸存 0` 退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.9 — 交付反馈取证 + 探针 token 协议化

### 修复
- **交付反馈取证的大小写/分隔符误拒**：旧实现 `/交付反馈\s*[:：]?\s*(accepted|needed_fix|rejected)\b/i` 在 `i` 旗标下捕获**原文**——真人写「交付反馈 Accepted」时取到 `'Accepted'`，与工具参数 `'accepted'` 不等 → 明明一致却报「结果不一致」。现归一为小写，并支持 `：` / `=` / 多空格分隔。
- **交付反馈取证的含混与否定**：旧实现 first-match-wins，「不是交付反馈 accepted，而是 rejected」会取到 `accepted`（把**错误的质量结果**写进账本）。现取**全部**命中：多个不同结果词 = 含混**拒收**（提示改用信封）；否定式前缀（不/非/没/未/not/no）后的命中不作证据——宁可「缺证据」也不静默取错值。
- **探针 token 提取漏值**：旧正则 `(\d+(?:\.\d+)?)` 不含符号位与指数——`x=-0.5`、`y=1e3` 在台账 token 列表里**根本看不见**（模型照着抄就错）。现支持 `-`/`+` 与 `e`/`E` 指数，并支持 `key: value` 形态（键须以字母/下划线/CJK 开头——避免把时间戳 `12:30` 当 token）。

### 新增
- **交付反馈 JSON 信封**：`{"closedloop":{"delivery":"accepted"}}`——与意图/签收信封同一套扫描（`parseClosedloopEnvelope` 单一真相）。

### 验证
- 新增 `delivery-attest.test.mjs` 5 条 + `probe-tokens.test.mjs` 4 条；全量 **412/412**。
- 变异审计 29/29 杀死、7 条等价；棘轮五模块 1.0；账本快检退出 0；构建 36 文件；热重载 `active → active`。

## v0.3.8 — 真人签收通道协议化（信封 + token 规范化）

### 新增
- **签收 JSON 信封**：`{"closedloop":{"sign":"组A"}}` 或 `{"closedloop":{"sign":["组A","全部"]}}`——与意图信封同一套扫描（`parseClosedloopEnvelope` 单一真相），零散文猜测。形态非法（`sign` 非字符串/字符串数组）= fail-closed（不退回散文猜）。

### 修复
- **包裹形态的假阴性**：旧实现 `签收\s*([^\s，。,.]+)` 不排除全角冒号/书名号/括号——真人写「签收：组A」「签收「组A」」「签收（组A）」时取到的是带标点的 token，与组名逐字比对**必然不中**：真人签了字，`verify=user` 硬门却不开。现改为「信封优先 + 包裹/引号/冒号 token 规范化」（`normalizeSignToken`），组名含空格时用括号形态（`签收「多词 组名」`）。
- **帧判类不放松**：仍只采 `role=user` 且 `source.kind==='user'` 的帧；plugin/assistant 帧里的「签收」一律不收（fail-closed）。

### 验证
- 新增 `user-signs.test.mjs` 6 条（含「签收：G → G」等旧假阴性实证）；`wiring` p5b 既有签收契约零改动通过。
- 全量 403/403；变异审计 29/29 杀死（`intent.js` 映射补入 `user-signs.test.mjs`——新测试不进程映射=变异会幸存）；棘轮五模块 1.0；账本快检退出 0。

## v0.3.7 — 回炉分层协议化（discrepancyCodes）

### 变更
- **回炉归因不再正则反解自己的文案**：`classifyRollbackLayer` 原先用正则匹配 `discrepancies` 的**消息文本**（引擎自己渲染的）来判定「推理层 vs 措辞层」——改一个词就静默翻转归因。现由结构化码判定：`converge` 为每条 discrepancy 同步记码（`no-number` / `declared-mismatch` / `unequal` / `declared` / `prep-gap`），分层只看码表：**全为格式码=措辞层，任一非格式码=推理层**（含模型自报与未知码，保守）。
- **`rolledBack` 落账带 `codes`**：回炉记录可审计到「凭什么这么分层」。
- **存量兼容**：无码的旧栈仍走原正则口径（判定不变），既有 4 条分层测试零改动通过。

### 验证
- 新增 `rollback-layer.test.mjs` 5 条（码直判 / 端到端 unequal / 端到端 no-number / 文案无关 / 无码兼容）。
- 全量 397/397；变异审计 29/29 杀死、7 条等价；棘轮五模块均 1.0；构建 36 文件；热重载 `active → active`。

## v0.3.6 — 变异审计纳保 mode-state.js + 账本快检判据

### 新增
- **`scripts/check-mutation-ledger.mjs`（账本快检，<1s）**：审计本体要跑 34s+，直接当组判据会被判超时。快检只做两件机器能当场核的事——①**新鲜度**：账本 mtime 必须 ≥ 受守护源码/测试/变异算子的最新 mtime（过期账本一律退出 2，不许拿旧账本充绿）；②**零幸存**（等价变异已单列，不计分母）。退出码 0/1/2 = 通过/有幸存/账本过期。

### 变更
- **`mode-state.js` 纳入变异审计**（守护目标 4 → 5 文件）：29 个变异全部杀死（1.0）。两条幸存变异各补一条断言：
  - `readAutoConfirm()` 的 `catch → return true`：设置文件缺失/坏 JSON 时**不得默认放行授权**（这条若存活，等于「读不到配置=自动确认合同」）。
  - `normalizeGroup` 的空 `doHistory` 键集：空数组不添键（防 deepEqual 键集漂移）。
- **测试映射纪律**：映射只收**沙箱自包含**测试——`tools-v3`/`panel-v3`/`v04-wiring` 因 import 插件入口（带宿主外部依赖）在审计沙箱里必红，会把整轮审计卡在基线绿门前，故不入映射（本轮实测踩过一次）。

### 验证
- 全量 392/392；变异审计 29/29 杀死、7 条等价；棘轮五模块均 1.0。
- 快检实测：`目标 5 文件 · 变异 29 · 杀死 29 · 幸存 0 · 等价 7 · 杀死率 1` → 退出 0。

## v0.3.5 — 判据运行时三修 + 变异审计纳保 intent.js

### 修复（三处真实根因，均有实测证据）
- **判据/探针 cwd 落到宿主目录**：本部署 `exec.agent.session.cwd` 为空 → 一切相对路径命令都跑在宿主进程目录（实测 `CWD=C:\Users\Administrator`），v0.8.6「相对路径按会话工作区解析」的承诺未兑现。现补回退链：`session.cwd` → env `DSH_SESSION_CWD`/`DSH_AGENT_CWD` → 从 `DSH_SESSION_JSONL` 目录段解码（`--D-dsh--` → `D:/dsh`）→ 按会话 id 在 `DSH_HOME/sessions/` 下定位 → 宿主 cwd。
- **组判据超时硬编码 20s**：构建/审计类判据（实测 ~34s）必被误判红。改为 `judgeTimeoutMs()`（默认 120s，env `DSH_CLOSEDLOOP_JUDGE_TIMEOUT_MS` 可调，下限 1s 回默认、上限 15min——只放宽不收紧）。
- **`optimal_converge` 的组落账漏传 cwd**：该调用点走默认 `process.cwd()`，与 `terminal_check` 的调用点不一致——相对路径判据在 converge 落账时必红。现统一传 `sessionCwd(exec)`。

### 变更
- **`intent.js` 纳入变异审计**（守护目标 3 → 4 文件）：21 个变异全部杀死（1.0），其中 1 条经机械核验判为等价（`parseIntentEnvelope` 的 `return null` 唯一调用点只做真值判断）。为此补 4 条边界测试（无关 JSON 不吞散文回退 / 多段围栏 + 超长正文 / 长度门 200·201 两点）。
- **意图单测自包含化**：单测直接引 `src/intent.js`（原先引插件入口会拖入宿主依赖，使审计沙箱基线必红）；`index.js` 的兼容再导出改由 `wiring.test.mjs` 覆盖。
- **标准棘轮口径统一**：等价变异不再计入分母（与审计 summary 同口径——拿「已证明等价」当「没杀死」是口径错误）。重记后四模块基线均 1.0。

### 验证
- 全量 390/390；变异审计 21/21 杀死、7 条等价（逐条给证）；棘轮四模块 1.0。
- 判据实跑实测：相对路径入口在会话工作区解析成功（`CWD=D:\dsh`、`ENTRY=true`）。

### 注意
- 组判据若用相对路径，需保证该路径在**会话工作区**下存在（本仓库开发环境用 `D:\dsh\scripts\mutation-audit.mjs` 作工作区级入口委托到插件脚本）。

## v0.3.4 — 意图单一真相（堵住弹窗道误 approve）

### 变更
- **意图逻辑收成单一真相 `src/intent.js`**：JSON 信封、散文分句否定感知、弹窗决策同出一处。此前同一语义有两套实现——`index.js` 的文本扫描与 `tools.js` 冻结弹窗的子串匹配——v0.3.3 修了前者，**弹窗（主通道）仍把「暂不确认」判成 approve**（`/确认/.test(label)`）。`index.js` 只做兼容再导出。
- **弹窗决策结构化（去子串匹配）**：`decideFreezeAnswer` 优先级 = ①显式结构化值（`answer.decision`）②选项标签**前缀逐字**（`确认·…` / `反驳·…`，含混双选=null）③补充文字走否定感知扫描。未知标签、空答案一律 **fail-closed 返回 null**——不再猜。
- 选项清单由 `FREEZE_OPTIONS` 单一常量生成（`index.js` 弹窗与 `tools.js` 判定同源），弹窗回执带 `via=` 说明决策来自哪条通道。

### 验证
- 新增 `freeze-decision.test.mjs` 6 条（含「暂不确认→null」「确认修改→null」两条旧漏洞实证）。
- 全量 382/382；`tools-v3` t11、`wiring` p8 等既有回归零失败；构建 36 文件；热重载 `active → active`。

## v0.3.3 — 意图通道协议化（堵误确认漏洞）

### 新增
- **JSON 意图信封**：正文里写 ```json {"closedloop":{"intent":"approve"}} ```（或裸对象 `{"closedloop":"reject"}`）即被识别——只做 `JSON.parse` + 定界符切分，不对散文做词法猜测；信封优先于散文，且不受 200 字长度门限制。
- **`scanIntentFull`**：返回 `{intent, source}`，`source ∈ json / json-invalid / too-long / text / null`，扫描痕迹落 `scanLog.via` 可查（意图从哪来不再靠猜）。

### 修复
- **否定式确认不再误判为 approve**：旧实现是纯子串匹配——「先不要确认」「别确认」「不用继续」「not ok」「don't confirm」都含 approve 子串，会被判成确认；weights 段的 approve 会**直接锁合同**。现按标点分句 + 否定感知（分句内否定词先于确认词 → reject），且英文词边界（`I know` 里的 `no` 不算否定）。
- **信封形态非法 = fail-closed**：看见 `closedloop` 信封但 `intent` 不在枚举内 → 返回 null，不退回散文猜测。

### 边界（设计，不是 bug）
- 同一分句内既含「确认」又含「修改」仍按既有契约 **reject 优先**（安全方向：reject 只解锁，不锁合同）。
- 散文回退保留——信封是可选通道，不要求人手写 JSON。

### 验证
- 新增 `intent-protocol.test.mjs` 7 条；全量 376/376；wiring 回归 17/17（a2 契约零失败）。
- 变异审计（opsVersion=v2）杀死率 14/14 = 1.0。

## v0.3.2 — 工具 API JSON 协议化（去正则脆弱性）

### 新增
- **source 对象形态**：`predict[].source` 除字符串 `read:path#L12` / `probe:key` / `prior:文本` / `engram:标题` 外，接受结构化对象 `{kind:"probe",key}` / `{kind:"read",path,line}` / `{kind:"prior",text}` / `{kind:"engram",title}`——键值含分隔符时不再靠正则重解，非法形态显式拒绝（`来源形态非法：…`）。

### 变更
- **对账走结构化路径（零正则）**：`optimal_converge` 的 `agreedPairs` 保留结构化副本并优先判定，渲染串仅供回执阅读。旧实现把结构化入参渲染成字符串再用正则反解——键名出现在他行文本时会误取他行实测值（`agreed-structured.test.mjs` as1/as2 为实证）。
- **数值按数值比，不按字符串比**：`valueEq` 新增数值等价层——`1` 与 `1.0`、`01` 与 `1`、`3.50` 与 `3.5` 判等；数字提取补符号位与指数，`-1` 不再被降级层吞成 `1`；版本串护栏保留（`v0.4.5` ≠ `v0.4.4`）。不引入浮点容差。

### 验证
- 全量测试 369/369（新增 `value-eq.test.mjs` 5 条 + `agreed-structured.test.mjs` 4 条）。
- 变异审计（opsVersion=v2）：杀死率 14/14 = 1.0，等价变异 6 条（逐条给证），标准棘轮无下降。
- 热重载实测：`before [active] → after [active]`，秒级返回。

## v0.3.0 — 预设作用域（逐预设开关）

### 新增
- **预设作用域开关**：可指定闭环插件在哪些预设下生效，其余预设完全隐身（零注入 / 零接管 / 写闸静默）。
- **设置页卡片**：设置 → 插件 → 插件配置 → 「闭环 · 预设作用域」，外观与官方卡片一致（折叠式，点开见清单）。
- **逐预设 checkbox，拨即生效免重启**：无保存按钮；默认全部启用。
- **预设自动发现**：用户预设（`~/.dsh/.agent-presets/`）+ DSH 内置预设（`cordis / minimal / ptc / standard`）合并去重；`(无预设)` 会话单独可控。
- 配置亦可走文件层：`DSH_HOME/closedloop-scope.json` 或 profile 插件 config 的 `disabled: string[]`；HTTP 读写口 `GET|POST /graded-mode/api/scope`。

### 修复
- **热重载卡死**：插件曾以惰性方式依赖宿主 settings 服务，导致新 fiber 挂未决依赖、reload 无界等待不返回。改为硬依赖 + 同步注册，重载恢复秒级。

### 边界（不是 bug，是设计）
- 显式 `/optimal:` 命令**不受作用域限制**——用户主动即尊重。
- 作用域外的会话工具仍在列表中，但无盘档状态，调用即被状态闸拒——无副作用。
- 未携带预设字段的会话归入 `(无预设)` 项（fail-closed，可单独关闭）。

### 验证
- 实测三态：关错预设 → 写闸仍拦；关对预设 → 写闸静默放行；复位 → 拦截恢复。
- 预设清单实测 6 → 10（内置四项补全）。
- 全量测试 348/348；生产机检全绿。

## v0.2.x
- v0.2.2 Apache-2.0 全文补正；灵枢 AEIS 上游署名（MIT）。
- v0.2.1 灵枢知识库与嵌入模型随包（后调整为数据不随包、仅留署名）。
- v0.2.0 验证类 vExpect 明文与回归锁；CI 模板。

## v0.1.0
- 首版：闭环协议插件 + 记忆器官 + 浏览器工具 + 标准预设。
