# 更新说明

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
