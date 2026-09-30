# 测试夹具

## `session-9dc1fe2b-closegoal.jsonl`

`test/contrast.test.mjs` 的 A 组在这份夹具上跑。它从一次**真实会话**里切出来,只保留该套件用到的两类事件:

- 5 条 `tool/call`(name = `CloseGoal`)——该会话全部 5 次结案尝试,外加对应的 5 条 `tool/result`
  (判据只用到其中的结果文本与 `meta.mutations` 里的 `audit/*` 事实);
- 7 条 `tool/call`(name = `SetGoal`)——C 组的反事实复算要用 rev3 那 5 条 `cheng_wei` 断言。

**出处**:DSH 会话 `9dc1fe2b-8702-43b7-a4a7-3a226d391f95`(2026-09-29 · 工作区 `/Users/lhc/Projects/chouxiang` · 1635 事件)。
源导出文件 13927567 字节,sha256 前 16 位 `4fc758dfb0955015`。
**唯一的改动**:长结果正文按 4000 字截断(截断处写明原文长度),其余字段逐字保留。

**为什么要进仓库**:原来这套件直接读本机 `.tmp-session/session.v4.jsonl`——那是 gitignore 的临时物,
于是**干净检出(CI、新克隆)上它会直接崩**(2026-09-29 的 v0.3.0 发布流程就是这么红的)。
真会话是这套件的**反例资产**:把它切小、跟着仓库走,这条回归才在 CI 上也活着。
本机有完整导出时,套件优先用完整那份。
