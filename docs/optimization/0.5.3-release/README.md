# 0.5.3 发布验证（2026-10-10）

本版修复实际检验长期不落图、阶段知识只在结案保存、重复安排独立评估的问题，并把计划进度接入 DSH 原生 todo。工程验收与产品收益分开报告；本次不宣称长测收益达标。

## 接口与迁移

- `Frame.ontology` 增加 `entities`。概念、关系、实体和假设断言可以同次提交；内核先在投影草稿中校验，校验通过才写文件。
- `ontologyFeedback`：实际检验前检查引用存在及断言有效；在独立核验满足门槛后保存阶段事实；同一假设后续反证生成持久待复核原因。假设来源开放，不设假设数量下限。
- `nativeTodoProgress`：通过原生 `todo/write` 同步计划。已交付映射 completed，当前开放步骤映射 in_progress，阻塞/放弃映射 pending，作废步骤不显示；新轮次清空后自动恢复。todo 不成为第二套完成依据。
- 两个配置均在 ClearAI 预设开启；单独直接挂内核默认关闭，以兼容既有调用方。保留原生 goal、探索和本体视图，删除旧计划芯片。
- 继续使用 STATE_VERSION 21、现有事实事件和文件格式；不改写历史账本。

## 验证

全套本机工程回归：native Node tests 37、内核 639、宿主 38、客户端 169、领域语言 251、本体 101、真值表 19、状态机 41、文档 15、注释 7、边界 19、组合 16、提示词 20、E2E 不变量 41、宿主不变量 27、对照 39、可读性 37、预算 28。全绿，宿主和客户端无跳过。包一致性 46 项通过，39 个文件。正式候选经过本机 DSH 原生安装，未修改日常安装。

真实运行固定 DSH 0.2.0-rc.2 / Node 24.18.1，主代理及独立评估者使用 abhome / deepseek-flash / medium。原始材料是公开合成的三条读数；无需外部真值。完整方法在 `tools/native-headless/ontology-probe.mjs`，摘要与包摘要见 [native-probe.json](native-probe.json)。

| 阶段 | 时间 | 累计处理 token（含缓存输入） | 结果 |
| --- | ---: | ---: | --- |
| 空图积累 | 98.435 秒 | 449,039 | 5 概念、4 关系、2 实体、1 条独立核验阶段事实 |
| 中断后新会话 | 21.617 秒 | 143,887 | 从文件恢复本体、实体和事实，Frame 引用成功 |

两场均在预先登记的机制检查点主动取消；`user_cancelled` 是该工程用例的预期结束方式，不能算任务完成。所有模型调用用量可核对，无 missing/pending。

隔离真实界面已检查：原生 todo 显示一项完成、一项进行中，原生 goal 保留，旧 2/2 跳转芯片消失。截图来自内部 RC4 渲染真实 RC3 记录；正式版仅更新版本和说明，其运行时代码与 RC4 相同。

## 复现

```sh
npm ci
node tools/build-package.mjs
node tools/native-headless/setup.mjs /tmp/clearai-053-home release-053
DSH_HOME=/tmp/clearai-053-home DSH_PROFILE=release-053 npm test
node tools/verify-package.mjs
node tools/native-headless/ontology-probe.mjs /tmp/clearai-053-home release-053 /tmp/clearai-053-probe
```

setup 使用本机官方 DSH 安装及既有 abhome 配置，独立 profile；每次 probe 需新输出目录，旧证据不覆盖。发布流水线另验 Linux 全套、干净安装、包与 registry 逐文件一致；分支 CI 另含 Windows Node24 审计回归。

## 未完成的产品验证

该用例核验机制，不是复杂长任务对照；不能用单个简单样本的 token 变化证明成本收益。序列质量、实验节省和成本验收继续沿用独立预注册及冻结候选，历史失败结果保留。
