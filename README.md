# dsh-agi-harness

给聪明模型一副「可托付的身体」：责任、可信度与学习能力的外部化。

模型强在单次生成，但训练只优化「这一次答得好」——诚实（说到做到）、索取（缺料主动要）、经验沉淀与唤醒（学过的记下、下次会用）是训练改不出来的，只能靠外部制度养成。本仓库是一套 DSH 插件组合，把这三样变成机器可执行的责任结构。

## 组件

| 目录 | 内容 |
|---|---|
| `plugins/dsh-closedloop-mode` | 核心闭环插件：预测先行→实现→盘上实测对账→吻合才闭合；写闸、来源纪律、判分器棘轮、审计硬验、真人帧签收、信誉账本、教训台账 |
| `plugins/dsh-engram-relay` | 记忆器官：跨会话记忆图谱 + 灵枢知识校准器（经验沉淀与唤醒） |
| `plugins/dsh-browser-panel` | 浏览器工具插件（可选：已有类似工具可跳过） |
| `preset/closedloop-full` | 标准预设：开环即注入成长人格与任务模式引导 |

## 核心思想

- 智能是模型的，责任是 harness 的——harness 是唯一能回答「什么算完成、什么算真、失败意味着什么」的器官；
- 闸是最小决策单元：条件 + 可学参数 + 证据 + 决策函数 + 不可学约束；
- 三层权重（会话/项目/harness）实时更新、Wilson 下界防污染、模型指纹绑定；
- 信誉从第一步参与，模型与信誉可分歧，分歧被验证后收敛；
- 注入是策略不是文案：每次交互要么让当前任务更对，要么让未来同类更强，两者皆无=上下文税，删。

## 内置数据（开箱即用，无初始化）

- 灵枢（数据与运行集均不随包）：引擎为 MIT 开源（CommonTrustProtocol/FuRongJun-1999，见 lingshu/LICENSE-aeis.txt）。快照为纯算法模式——无 .py 运行集、无知识库数据，插件自动降级零报错；启用语义服务的步骤见 plugins/dsh-engram-relay/README.md
- 语义向量模型：`plugins/dsh-engram-relay/model/`（BAAI bge-small-zh 量化版，Apache-2.0）
- 说明：跨会话记忆库（engrams.jsonl）随用户私有使用、不随包分发——首次运行命令库为空属正常，插件零报错。

## 需求

- DSH（DeepSeek Harness）运行时
- Node.js >= 22
- 语义裁判可选：提供 `DEEPSEEK_API_KEY`（缺省时自动降级为引擎判定，功能不回退）

## 安装

见 [docs/INSTALL.md](docs/INSTALL.md)。

## 测试

```bash
cd plugins/dsh-closedloop-mode && node --test tests/
```

## 更新说明\n\n见 [CHANGELOG.md](CHANGELOG.md)。\n\n## 许可

Apache-2.0（见 LICENSE，全文 verbatim）。

第三方组件：

| 组件 | 来源 | 许可 |
|---|---|---|
| `plugins/dsh-engram-relay/model/bge-small-zh/` | BAAI bge-small-zh-v1.5（量化版） | Apache-2.0 |
| `plugins/dsh-engram-relay` 借鉴灵枢 AEIS 引擎思路 | [CommonTrustProtocol](https://github.com/FuRongJun-1999/CommonTrustProtocol)（FuRongJun-1999，MIT；见 lingshu/LICENSE-aeis.txt）——运行数据不随包分发 | MIT |
| `plugins/dsh-browser-panel` | 本项目自有 | Apache-2.0 |
| `plugins/dsh-engram-relay/lingshu/` | 灵枢知识库（本项目生成数据） | Apache-2.0 |

注：`dsh-engram-relay` 与 `dsh-browser-panel` 的 `license` 字段原为脚手架模板默认的
BSD-3-Clause（非第三方约束），已统一为 Apache-2.0。






