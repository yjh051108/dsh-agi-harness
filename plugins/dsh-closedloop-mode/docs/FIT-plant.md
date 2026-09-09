# FIT-plant — v0.2 被控对象拟合（真实会话转录，A/B 基线）

生成脚本: fit-plant.mjs · 数据源: ~/.dsh/sessions 全转录(zstd 多帧解)+栈盘档

- **主会话 v0.1→v0.2 · 14块**: 墙钟 1716min; 每块协议往返 4.1; 每块契约书写 3.9KB; 每块注入 5.5KB; read 回执 445KB; invalidated 0; discrepancies 0
- **P 场 v0.2 纯血 · 3块**: 墙钟 21min; 每块协议往返 5; 每块契约书写 6.4KB; 每块注入 3.9KB; read 回执 40KB; invalidated 0; discrepancies 0

## v0.3 换代冒烟追加行（#20 块，fit-plant v2 口径，2026-09-04）

> 口径注（v1→v2）：inj 分类子含【写闸/闭环】类引导帧（v1 漏计，变更史见 scripts/fit-plant.mjs 头与栈 rolledBack）；
> rolledBack=栈顶层数组现读、discrepancies=step+rolledBack.diffs 合式（v1 读 converge.* 恒 0 缺陷已修）。

- **smoke#1 853e4542（首冒烟·reject 现场）**: 8min; 往返 11; 契约书写 2.2KB(0.7/动作); 注入 2.8KB; read 3.4KB; closed 2; rb 0; disc 0 —— 产出两缺陷证据（假吻合过闸/未来事件预测），fresh 审真 reject 4 issues
- **smoke#2 e3a53c3f（数值闸活证·#A 死锁现场）**: 7min; 往返 19(含探针回炉); 契约书写 2.8KB; 注入 4.3KB; read 4.3KB; closed 3; **rb 2; disc 1**（提取器修复自证非零）—— 错配「实测5≠预测7」被新数值闸拦原文在栈
- **smoke#3 e5e9df00（饱和修复终验·归零 ✓）**: **3min; 往返 10（3.3/动作）; 契约书写 1.2KB（0.4/动作）; 注入 3.3KB/16 帧（均值 206B）; read 0; compaction 0; closed 3/3; stage=final zero=true**
- 对照结论（v0.2 基线→v0.3）：契约书写/动作 **3.9→0.4KB（-89%）**；每动作协议总字节 **≈7.8→1.5KB（-81%，BENCH ≤1.5 达标）**；冒烟短会话 compaction 0/read 0（无失忆重读）；dip-saturated 修复活证（smoke2 死锁路径 smoke3 走通归零）