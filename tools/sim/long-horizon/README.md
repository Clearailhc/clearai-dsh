# 五个长程任务

计划:[ClearAI 五个长程测试任务](https://claude.ai/code/artifact/1846903c-77c0-4eed-9331-20529ba296d2)。剧本在 `scenarios.mjs`,每个目录一个任务的题目与答案(`answer-key.md`,模型看不到)。

| 剧本 | 题目 | 题目材料 |
|---|---|---|
| `lh-math` | 七条整数说法的甄别 | 无(答案在 `math/`) |
| `lh-reactor` | 有预算的反应器配方优化 | `reactor/reactor.mjs`(模拟器)、`surface.mjs`(真值) |
| `lh-factory-1/2/3` | 良率下滑归因,同一工作区三个会话 | `factory/gen.py` |
| `lh-battery` | 固态电池调研 + 十条宣称核实 | `battery/claims.md` |
| `lh-binpack-1/2` | 目标做不到的装箱启发式,两个会话 | `binpack/gen.mjs`、`ffd.mjs` |

## 怎么跑

ClearAI 组照 `tools/sim/README.md`,剧本名换成上表的;工作区约定放在 `<运行目录>/ws`(反应器的状态文件在运行目录里)。
多会话的剧本,第二、三个会话起新的运行目录,但 `--workspace` 指向会话一的 `ws`。任务二另跑一遍 `--answers '{"release":"先不放行"}'`。

裸模型组(对照):

```bash
node tools/sim/brief.mjs bare <运行目录> <剧本名> [工作区]   # → bare-brief.md,同一份任务书,不装 ClearAI
```

两组都把模型最后一条消息存成 `<运行目录>/final-reply.md`,然后盲评:

```bash
node tools/sim/long-horizon/grade.mjs <math|reactor|factory|battery|binpack> <运行目录> [这次只评哪个会话]
```

扮演模型、评估者、裸模型与盲评的子代理一律用 Sonnet 5.5,思考强度中。
