> **时点声明**：本文是**当时**（0.2.9 开发线）的现状定位、根因分析与改动清单，正文里的读数与「缺哪三条」都是那一刻的；清单里的各项其后已落地，正文保留原样、不改写历史。现行读数以 `truth-table.zh-CN.md` 与 `CHANGELOG.md` 为准。
> 本轮（0.3.0）:从一次真实运行的三个症状出发的现状定位与根因分析。
> 实现与验证记录见同目录的《独立验证》与 `CHANGELOG.md`。

# ClearAI 真实运行诊断（会话 9dc1fe2b · 2026-09-29 · 工作区 chouxiang）

证据：`.tmp-session/`（父会话 1635 事件 / 6 turn / 227 step + 35 个子会话）、`preset/plugins/*.js`、
`ui/lib/*.js`（与 `dist/clearai-dsh/lib/host.js` 逐字节相同，md5 已核）。
深挖报告：`.tmp-audit/A-closegoal-broken.md`（510 行）、`.tmp-audit/B-entity-graph-broken.md`（279 行）。

## 0. 会话事实（先对齐"现状"）

| 项 | 读数 |
|---|---|
| 人类消息 | 5 条（其余 194 条是运行态卡注入 + 14 条 system-reminder + 4 条 runtime-context + 2 条 goal_round） |
| 运行态卡 | 194 次注入，合计 **1,016,567 字符**（均 5240，最大 13945）；去时间行后 168 种唯一内容 |
| 子代理 | 19 评估者 + 16 侦察兵 = 35 个 |
| CloseGoal | 5 次：1 次落地 inconclusive、1 次 `inactive context` 报错、3 次被用户打断 |
| goal_audit 子代理总耗时 | 5 个评估者 / 64 步 / 103 次工具调用 / **584.8s**，其中 99.99% 是评估者自身模型生成 |
| 语汇 | `lab/data/lexicon-raw.jsonl` **451 条**（有年代 265、有出处 233、带 URL 72） |
| 本体 | RegisterTerm 34 + RegisterPredicate 9 → 图上 **36 节点 / 24 边** |
| 实体图 | **0 节点 / 0 边**（`facts[].assertions` 为空 ⇒ 投影空） |
| 已升格事实 | **0**（卡自陈「已升格事实里 0/0 条带类型化断言」） |
| 命题等级读数 | 4/4 条最终 `supportedLevel = L3`；`untouchedLevels`：L0 / L0+L1 / L0+L1 / L0+L2；全会话 **L0 证据 0 条** |
| 判据 | rev1–rev3 四条硬判据 → rev4 主动降级②③为「边界声明」，并写入修订留痕 |

---

## 1. CloseGoal 运行失败且耗时很长

### 1.1 失败是平台层的单点，不是设计内的分歧（已证实）

- 出错串 `cannot get required service "sessions" in inactive context` 只在 Cordis 的**属性式**服务访问
  （`ctx.sessions`）里生成；**方法式 `ctx.get('sessions')` 同条件只返回 `undefined`、不抛**（本机最小复现逐字一致）。
- 内核侧所有 `sessions` 访问都是方法式（kernel:733/752/1261/1528/6274）⇒ 没有一个能抛。
  唯一能抛的是宿主半 **`ui/lib/index.js:124` `ctx.sessions.get(sessionId)`**，而它是 `derive`/`preview` 的唯一入口，
  CloseGoal 必经（kernel:3032 derive、kernel:3108 preview）。
- 时序：04:44:04.735 同一调用里 derive 成功 ⇒ 当时 fiber 是 ACTIVE；04:46:58.745 评估者子会话正常结束，
  `structured_output{verdict:"refute"}`；04:46:58.759 父工具抛错——**晚 14ms**；
  04:47:03.7 下一次 CloseGoal 又能走到 `subagents.start` ⇒ 5 秒后已恢复。**这是一次瞬态 unload/reload**，
  不是派发失败、不是 240s 超时（配置 240000ms，实际 174s）。
- 候选择被排除：全会话没有任何一次工具调用写过 `*.cordis.yml` / `*.patch.yml` / `presets/**`（不存在 HMR 触发）；
  该步只有一个工具调用（排除同批前序副作用）。

### 1.2 真正恶性的不是抛错，是"已完成的工作被静默丢掉"（已证实）

- `audit/dispatched` 只写在**工具结果的 mutations 数组**里（kernel:1835）。工具一抛错/被 abort，整批变更一起消失。
  父日志最后一条 `audit/*` 事实停在 seq 1480（即第一次 CloseGoal），#2–#5 一条不落。
- 后果：`turnDemand` 的「有裁决在飞 ⇒ hold」(kernel:2173) 触发不了，`sweepEndedAudits`(kernel:1599) 也看不见它。
  一次已经算出 `refute` 的、完整跑完的 174s 评审从账本上不存在，只留在盘上那张评估卡里。
- 附带缺陷：kernel:3080 `fail('audit_pending', …)` 漏传 `{mutations}`；kernel:1857 使用了 kernel:1867 才声明的
  `const settleUnknown`（TDZ）。

### 1.3 耗时的结构

- 派发 16–48ms、裁决回传+落卡 14–17ms；**120–175s 全是评估者的模型生成**（末步单次生成 81.0s）。
- `auditTimeoutMs=240000` 相对真实 P95 是否够，无样本。

### 1.4 重复派遣（已证实）

- 同一个 `goal:g-mum3cqcxxvso` 派了 5 个评估者（catalog seq 1479/1581/1588/1615/1630）。
- `pendingAudits` 去重键 = `session:goal_audit:goal:<id>`（kernel:1820），一落定即 delete（kernel:1855）
  ⇒ 对「同一状态反复 CloseGoal」没有免疫力。
- **可证明的同态重派**：#2 与 #3 之间零工具调用（seq 1582→1587），三张运行态卡逐字同为
  `g-mum3cqcxxvso · rev4 · open`（seq 1578/1585/1597）；而 #2 那 174s 已经产出 `refute`。

### 1.5 根因（第一性原理）

> **对账本的一等事实（派发/裁决）作了"先 await 再做副作用"的排序。**
> 子代理是异步的、可打断的；事实只有在 await 之后才落账，等于把「已经发生的事实」寄存在一个可被撤销的栈帧里。
> 正确顺序反过来：**先落账（dispatch 事实），再 await；结算也是独立落账，而不是搭工具结果的便车。**

---

## 2. 命题晦涩、且没有走认识论 loop

### 2.1 "loop 没走"有精确读数（已证实）

- 4/4 命题最终 `supportedLevel = L3`；`untouchedLevels` 分别 L0 / L0+L1 / L0+L1 / L0+L2。**L0 证据 0 条**。
- 全会话可数出的 25 条证据：L0 = 0、L1 = 7（全 self）、L2 = 3（全 self）、L3 = 15（independent：support 4 /
  refute 6 / inconclusive 5）。
- 机制上为什么允许且几乎无代价：`supportedLevel` = support 证据里 level 的最大值（fold.js:1746-1748），**没有前置等级要求**；
  `untouchedLevels` 只是展示派生量（fold.js:1766-1768），源码注释明写「跳级不违规」（fold.js:1755-1761），
  UI 同义（client.js:868）；唯一等级门只查上限（invariant.js:114-129）；升格门槛也只比 max（kernel:3058）。
- 于是：**最便宜的三级检查从未作为证据落下，最贵的一级承担了全部判断负载**——这既是"晦涩"的来源（结论没有在具体实例上磨过），
  也是"跑很久"的来源。

### 2.2 判据在执行途中被改写成"可交付的形状"（已证实）

- rev1→rev3 判据是四条硬判据（含"留出集实测""语料库每条带可追溯出处"）；评估者判定②字面满足但实质不成立、③不满足；
  随后 rev4 主动把②③降级为「边界声明」，并把降级理由写进判据文本与修订留痕。
- 结果：**loop 的接受条件随一次 inconclusive 而改变**，而不是回到 loop 去补证据。这不是造假（留痕完整、诚实），
  但它是"没有走认识论 loop"的机制性含义：**合取判据没有"降级需要独立裁决 + 降级后必须回头补哪一步"的路径**。

### 2.3 为什么结论停在抽象层（已证实 + 推断）

- 计划的 `tests.level` 由规划者自己硬编码（CreatePlan，kernel:2781），按时间序便宜步（L1/L2）先失败/被 supersede，
  留下的都是 L3 交付 ⇒ 读数自然全是 L3。
- 更关键：**具体物写入账本的路只有 `RegisterTerm`，而它的语义是"约定、不需要依据"**（kernel:3265），
  所以模型把「李赣」「孙笑川」「狗熊哆嗦毛（样本）」这类个体也登记成概念（34 个 term 里 11 个是个体/样本）。
- 模型自己在计划里写了判据④「把语料中的真实样本登记为实例（instance）并挂上断言，使本体不是空图」——
  **但工具面上没有 instance 这个登记动作**。于是"落到具体实例"这一步在结构上无法完成，
  抽象命题成了唯一能闭合循环的形状。

---

## 3. 本体很好，但查到的大量实体没有进实体图谱

### 3.1 实体层的唯一入口绑在一个与它无关的裁决上（已证实）

- 投影：entity 节点/边**唯一**输入是 `state.facts[].assertions`（domain-language.js:449-481）。
- 写入：`assertions` 只在 `fact/promoted` 定型（kernel:3153）；`fact/promoted` 的唯一生产者是 CloseGoal 的升格循环
  （kernel:3127-3157），前置条件是独立评估者对**整条目标**判 `support`（kernel:3081-3114）。
- 本次唯一的裁决是 `inconclusive`，其直接原因是**判据③（语料出处分档）**——与实体图毫无关系。
  ⇒ **实体层的存在性被绑在一个与它无关的目标级裁决上。**

### 3.2 数据其实早就写好了（已证实）

- 累计落账断言 13 条（rev1 3 + rev2 5 + rev3 5），单次最大 5 条，全部挂在 `h-fib2e2` 名下，
  形状 `sucai|yangben_x · cheng_wei = chouxiang|chouxiang`，且带 `qualifiers:{语料条目, 证据强度, 素材出处}`。
- 反事实复算：若 rev3 那一条事实升格成功，实体图就是 **6 节点 / 5 边**。数据早就写好了，只差一条通道。

### 3.3 卡会说"结构完整"，因为缺口模型里没有"实体"这一维（已证实）

`deriveKnowledge` 的四个缺口（fold.js:1146/1157/1169/1183）分别是：语言、只有散文的命题、升格但没断言的事实、从没被证据碰过的命题。
本次读数：语言有；`registered=[h-fib2e2]` 且断言被 fold 保留 ⇒ 0 条散文命题；事实 0 条 ⇒ 第三项**空真**；证据覆盖满足。
四项全 0 ⇒ 卡渲染「结构完整」（fold.js:2552-2557）。
**代码里根本没有 `no_entities` / `entities_unlanded` 这个 code**：卡能把"没走过 L0"写在脸上，
却写不出"实体图是空的"——**看不见 = 长不出来**。

### 3.4 附带发现：两处层间不一致（已证实行为）

- 内核修订把断言写 `null`（kernel:2919），折法 upsert 只在是数组时覆盖（fold.js:305）
  ⇒ rev4 请求面 0 断言，账上仍留 rev3 的 5 条。行为已证实；是否有意待定。
- 卡自报的「21 条对账过的边」只活在 `lab/data/ontology-edges.jsonl` 里，投影一条都读不到（实算 24 边，
  全部是 `is_a` + 谓词边）。**lab 文件里的成果不构成图上的成果。**

### 3.5 根因（第一性原理）

> **把"节点"全分配给了不需要依据的那一侧。**
> 需要依据的节点（实例/字面值）没有写入口，只能是"目标级裁决的奖励"；不需要依据的节点（概念）有 7 个动词自由写。
> 于是「实体」不是一个可以被记录的东西，而是「结论的副产物」。
> 用户要的"完整的本体**和实体图**"，前半被做成了词表，后半因为完成函数里没有它而整体未产出。
> 这不是模型懈怠——**完成函数缺项**。

---

## 4. 优化方案（按第一性原理分组，每组：机制 / 判据 / 测试）

### 组 A · 让事实不依赖工具调用的成功（治 CloseGoal）

| # | 机制 | 为什么结构上不可能再发生 | 测试 |
|---|---|---|---|
| A1 | 宿主半禁属性式：`ui/lib/index.js:123-127` 改 `ctx.get('sessions')/ctx.get('sessionProjections')` + undefined 降级（同改 :104/549/621/673/680） | 错误串只在属性式 walk 里生成；方法式永不抛，服务瞬态不可得只是"这一刻读不到" | 结构断言 ui 源码无 `ctx.sessions|ctx.sessionProjections`；行为断言瞬态不可得时 derive 返回空态不抛 |
| A2 | `audit/dispatched` 改"派发前独立落账"，走已有的 pluginNotice/factMutations 通道（kernel:6722），并从工具结果 mutations 移除该条；kernel:3080 补 `{mutations}`；修 kernel:1857 TDZ | 事实不再挂在"工具成功返回"这个易失载体上；throw/abort 都抹不掉，hold 与 sweep 恢复链同时生效 | 宿主 preview 抛一次 → 仍断言派发事实落账 + 下一拍 hold + sweep 从子会话日志取回 refute |
| A3 | 目标级裁决按状态 digest 复用（照抄 scoutDigest/reuseScout，kernel:1713-1741）：digest = (kind, step.id, goal.revision, gate.confirmed, evidence digest) | 复用判据是状态内容而不是"模型又喊了一次"；同态只评审一次，证据一变必然重派 | 状态不变连调两次 → 只派 1 个；加证据后再调 → 派第 2 个 |
| A4 | 裁决产出设 schema 级预算（短 verdict + `refs[]`，长论证交回父会话），消掉 48s/81s 的收尾生成 | 字段长度由 schema 校验而非提示词劝告 | 对 VERDICT_SCHEMA 断言 `basis.maxLength` / `refs` 必填 |
| A5 | `sessionCwd` 分级返回，禁止静默写 `process.cwd()`；写不出就返回 null 走 `card_persist_failed` 降级 | "写不出去"与"写到别处"是两件事；删掉回退分支，"错地方"在类型上不可表示 | sessions 桩 undefined + chdir 空目录 → 零写入且裁决降级 |
| A6 | 宿主读面降级落成账本事实：宿主半在取不到服务、或 fiber 掉出 ACTIVE 时记一条观测（`ui/lib/index.js` 的 `hostHealthId`，id 按 **scope + detail 内容寻址**），内核在 pre-step 把还没上账的那几条落成 **`host/inactive`** 变更（`clearai-kernel.js` 的 `landedHostHealth`），折法按 id 幂等（`ui/lib/fold.js` 的 `host/inactive` 分支） | 把"为什么掉了"从推断变成观测，而且是**可事后复判**的观测：只记在进程内的话，重启、换进程、离线复判都读不到它——而"这一刻读不到投影"恰恰最需要能事后解释 | 断言内核 pre-step 落一条 `host/inactive`、同一条反复观察仍只落一条（`test/kernel.test.mjs`）；降级不抛与健康事实形状见 `test/host.test.mjs` |

### 组 B · 让认识论 loop 的"成本"进判据（治晦涩与跳级）

| # | 机制 | 为什么这是机制而不是劝告 | 测试 |
|---|---|---|---|
| B1 | **跳级需具名理由**：`supportedLevel=Ln` 时，`untouchedLevels` 非空必须在同一条证据或同一次 SetGoal 里带 `skip_reason`（投影可清点） | 现在跳级被源码明写"不是违规"且无代价；加一个**可清点**的字段，"跳过"从默许变成需记账 | 无 skip_reason 的跳级在卡上出缺口码 `levels_skipped`；带理由则消失 |
| B2 | **判据修订要过独立裁决**：`done_criteria` 变更走一条 `criteria/revised` 变更，并强制附"降级了哪一条、被谁裁、降级后回头补哪一步" | 现在判据可在同一工具调用里自我降级（rev4 即如此）；把降级变成需要外部裁决的动作 | 无裁决的判据降级被拒；有裁决的降级在卡上留痕 |
| B3 | **结论必须先落到具体实例**：`RegisterInstance`（或 `Assert`）成为一等动词；至少 1 条达门槛命题的断言主体必须是 instance | 现在"具体物"只能走 `RegisterTerm`（约定层、不需依据），落到实例这一步在工具面上不存在 | 结构断言：带 instance 主体的断言可登记；`entities_unlanded` 缺口与 B3 联动 |
| B4 | **每级给出该级的最小证据形状**：L0 = 一次推理自检的可复核依据、L1 = 已有知识检索结论（含空结论）、L2 = 已有数据/小算 | 现在 L0–L2 只被描述为"便宜的检查"，没有要求它们**必然留下一条证据** | 断言 L1 步交付后账上有 L1 证据行 |

### 组 C · 让实体有写入口、并让"看不见"变成可见（治实体图）

| # | 机制 | 为什么这是机制而不是劝告 | 测试 |
|---|---|---|---|
| C1 | 给实体账本一等写入口（推荐 A 案）：`LEXICON_KINDS` 加 `instance`，`RegisterInstance(term, id, label, provenance)` 或 `Assert(subject{type,id}, predicate, object, provenance, evidence)` 发 `entity/asserted`，`graphProjection` 的 entity 段改读它；升格仍可把断言补挂到已登记实体（去重） | 实体不再依赖升格；"实体是一个可以被记录的东西" | 登记 6 个实例 + 5 条断言 → 投影 entity 6 节点 / 5 边（本次反事实） |
| C2 | 缺口模型加 `entities_unlanded`：`wanted` = 非终态命题断言主体去重数；`entityNodes` = 投影 entity 节点数；`wanted>0 && entityNodes==0` 即触发；CloseGoal 加与 `requireTypedPromotion` 对称的门 | 两个整数都可清点，且有诚实出口（落账 or abandoned）；把"看不见"消灭 | 构造"有断言、无事实"的状态 → 卡上出现该缺口；落账后消失 |
| C3 | lab 文件与账本对账：计划产物里的本体/实体清单（如 `ontology-edges.jsonl`）必须经动词登记才算图上成果 | 现在"21 条对账边"只活在 lab 文件里，图上 0 条；工具面必须指得出动作 | 断言只有登记过的边出现在投影里 |
| C4 | 运行态卡体积治理：时间字段移出卡（或改成"会话内相对量"）、资料面只列增量、判据全文只在变更时注入 | 本次 194 张卡 = 1,016,567 字符；判据全文每次重发 | 断言同一状态连续两步不重复注入整卡 |

---

## 5. 优先级（若只做三件事）

1. **A2 + A1**：派发事实独立落账 + 宿主半禁属性式。修掉"跑 3 分钟、结果静默消失、用户重试"的循环。
2. **C1 + C2**：实体一等写入口 + `entities_unlanded` 缺口。让"查到的实体"有落点、让空图可见。
3. **B1 + B2**：跳级需具名理由 + 判据修订过独立裁决。让认识论 loop 的便宜层级真正被走、让判据不能被静默降级。

这三件落地后，本次会话的复现结果会是：CloseGoal 不再因瞬态 fiber 掉线丢掉裁决；14 条断言中至少 5 条落成实体图；
卡上会显示「5 个断言主体还没落到实体图」而不是「结构完整」；4 条命题里的跳级会被要求给出理由。
