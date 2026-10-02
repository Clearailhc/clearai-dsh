# 模拟宿主:用真模型验收,不起 DSH

真内核装进一个最小宿主壳。模型由外部子代理扮演,经命令行调用 ClearAI 的工具。独立评估者由另一个只读子代理扮演。判分用长测同一个判官。

## 一场怎么跑

```bash
# 1. 起模拟宿主(常驻,端口写进 <运行目录>/port)
node tools/sim/server.mjs --run <运行目录> --workspace <工作区> &

# 2. 生成交给模型的说明:提示词段 + 工具目录 + 调用方式 + 剧本任务书
node tools/sim/brief.mjs model <运行目录> <剧本名>      # → <运行目录>/model-brief.md

# 3. 派一个子代理读 model-brief.md 照做(它用 call.mjs 调工具)

# 4. 内核派评估者时请求会挂起:取出来,派一个只读子代理去判,它自己用 settle 交回
node tools/sim/call.mjs <运行目录> --pending
node tools/sim/brief.mjs evaluator <运行目录> <请求 id>  # → <运行目录>/evaluator-<id>.md

# 5. 模型结束后判分(读日志重放,结果写进 <运行目录>/result.json)
node tools/sim/judge.mjs <运行目录> <剧本名>
node tools/sim/call.mjs <运行目录> --stop
```

剧本在 `tools/e2e-scenarios.mjs`。系统当场问人时缺省选第一个选项;要换答案,给 server 传 `--answers '{"blocked":"none","release":"先不放行"}'`(键是问题 id 或它的前缀 `release` / `blocked` / `fact`;`none` 模拟没人能答)。
评估等待缺省 15 分钟(`--audit-timeout` 可改),因为评估者要等编排者派人去判。

## 测得到什么,测不到什么

- **测得到**:提示词、工具面、内核、折法与判据,在真模型手里是否走得通。
- **测不到**:宿主接线(装包、注册、路由)。这部分由 CI 的干净安装与生命周期验收覆盖。原生的 `subagent`、`ask_user_question`、`present` 在这里不存在。
- **一处偏差**:扮演模型的子代理带着它自己的系统提示词,ClearAI 的提示词是作为任务书交给它的。

基线与历次结果放在 `docs/optimization/sim-runs/`。
