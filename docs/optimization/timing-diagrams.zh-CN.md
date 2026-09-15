# ClearAI 预期时序图

> 这些图描述**四条主路径上，谁在什么时候对谁做了什么**。
> 与状态机（[`state-machines.zh-CN.md`](state-machines.zh-CN.md)）配套：
> 状态机回答「有哪些状态」，时序图回答「谁把它推过去的」。
> 图里出现的工具名与事件名都可以在代码里逐条对上。

## 1. 轻量探索路径 · 部分实现

**目的**：允许模型先用 DSH 原生能力做低权威探索，不强迫立刻建立正式计划。

```mermaid
sequenceDiagram
    autonumber
    participant U as 人
    participant A as Agent
    participant D as DSH 原生工具
    participant P as ClearAI 投影

    U->>A: 问题 / 任务
    A->>D: read / glob / grep / bash / web_search
    D-->>A: 探索材料
    A->>A: 形成临时假设与路线
    A-->>U: 探索结果，或建议正式化
    Note over A,P: 这一阶段不写权威账：<br/>没有 SetGoal / CreatePlan / AdvancePlan
```

当前状态：**部分实现**。低权威探索在物理上可行（原生工具本来就在），
但提示词把它描述成正式循环的前置步骤，而不是一个可以自由停留的区域；
`tool-todo` 等临时计划工具当前未挂载，所以模型没有一个「不进入账本的计划」可用。

计划：见优化计划阶段 4「探索区 / 正式区」与阶段 5「非权威工具回归」。

## 2. 正式认识论路径 · 已实现

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant K as ClearAI 内核
    participant H as 人
    participant E as 独立评估者
    participant P as 投影 / 面板

    A->>K: SetGoal(claim, done_criteria, hypotheses)
    K->>P: goal/set（派生阶段 planning）
    K->>E: precommitRecon 派一次只读侦察（可选，input/ 有材料时）
    E-->>K: scout/settled

    A->>K: CreatePlan(brief, steps[].done_criteria)
    K->>K: validateSteps（判据必填、不自指、≤25 步）
    K->>H: 原生审阅卡（plan-review）
    alt approved
        H-->>K: approved
        K->>P: plan/created（confirmed_by='user'）
    else declined / cancelled / unavailable
        H-->>K: 其余三种
        K->>P: plan/created（confirmed_at=null）
        Note over K,P: 记号不落；自动续跑 hold；<br/>但交付一步会以 by='progress' 补写
    end

    A->>K: AdvancePlan(step_id, observations)
    K->>K: admission：产物存在 / 非空 / 结构合法
    alt 准入没过
        K->>P: block/counted（连续达 blockedThreshold → plan/blocked）
    else 准入通过且 L0–L2
        K->>P: step/advanced + evidence/recorded
    else 准入通过且 L3+
        K->>E: 派 fresh-context 只读评估者
        E-->>K: 结构化裁决
        K->>P: audit/settled + step/advanced（写 verdict 由系统落）
    end
    opt L4
        K->>H: 原生审批栈（人放行）
        H-->>K: approval
        K->>P: human/released
    end

    A->>K: ClosePlan → CloseGoal(outcome=achieved)
    K->>E: 目标评估者（合成 step，判据 = goal.done_criteria）
    E-->>K: support
    K->>P: goal/closed + fact/promoted（达 promote_at_level 且无推翻）
```

三个必须记住的边界：

1. **准入不裁决**。准入只回答「收不收」，`support / refute` 是评估者或 L0–L2 自判的事。
2. **L3 以上写 verdict 会被拒绝**（`verdict_not_accepted`）。
3. **结案前必须先收尾计划**，否则内核拒收。

## 3. 失败与恢复路径 · 已实现（机制侧）/ 仅提示词（恢复纪律）

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant D as DSH
    participant K as 内核
    participant L as 账本（git）

    A->>D: 有副作用的工具调用
    alt 普通工具错误
        D-->>A: ok=false + failure_class
        Note over A: 可自纠：改因、换路、或按 retry_safe 有界重试
    else 供应商失败
        D-->>A: 类型化事实
        Note over A,K: 有界退避；终不可用则 run paused
    else KernelPanic / EffectOutcomeUnknown
        D-->>A: 效果可能已提交
        A->>K: 分类为引擎级故障
        K-->>A: 降权契约：只读恢复回合
        A->>D: read / glob / grep（禁止 bash / 子 Agent 重放）
        D-->>A: 当前事实
        A->>K: 据观察决定：修因 / 收手
        Note over A,L: 每次写入都已经自动进账本，<br/>所以「先观察」总是有可观察的对象
    end
```

当前状态：账本与准入是机制；**恢复纪律本身只在提示词里**（`clearai/execution-discipline`）。
把它从「建议」升级为边界，需要宿主侧配合，属后续议题。

## 4. 世界线路径 · 已实现

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent
    participant K as 内核
    participant X as 世界线执行者（各自工作副本）
    participant H as 人
    participant P as 投影

    A->>K: ForkPlan(branches[], decide_by)
    K->>K: validateForkOptions（尺子必须事先登记）
    K->>X: 准备 branch + worktree（或退化到声明目录）
    K->>X: 各自派一个执行者（工具面不含计划/目标动词）
    K->>P: fork/created, worldline/prepared, worldline/executing

    X-->>K: 分支交付（读数 + 产物）
    K->>P: branch/delivered（各分支秩 → evaluated）

    A->>K: ConvergeFork
    K->>K: decideWinner（按预注册尺子算术排序）
    alt 唯一优胜者且分差 ≥ autoAdoptMinGap
        K->>P: fork/converged（winner 标 adopted，其余标 pruned 留痕）
        K->>H: 采纳门
        H-->>K: adopt_branch
        K->>P: user 来源消息（by='user'）
    else 分差小但确实分胜负
        K->>P: fork/converged（临时采纳 + 待复核痕迹）
    else 算不出来
        K->>P: fork/undecidable
        K->>K: 可选：派横评仲裁（fork/arbitrated 只记判决）
        K->>H: 交人决定
    end
```

要点：

- 算术只负责**排序**；`adopt_branch` 是人按的那一下。
- 落选分支只删工作副本，**保留 branch ref**，因为事后改判依赖它永久可读。
- 分叉已收口而执行者未归 → 派生 `unreturned`，不再等。

## 5. 人门（human gate）路径 · 已实现

```mermaid
sequenceDiagram
    autonumber
    participant H as 人
    participant UI as 面板（只读投影 + 人门通道）
    participant Host as 宿主半（投影单元）
    participant K as 内核

    Host-->>UI: useProjection('clearai') 推送视图
    H->>UI: 点一个动作（adopt_branch / abandon_fork / promote_skill）
    UI->>Host: 提交动词 + 参数
    Host->>Host: 白名单校验（表外一律拒）
    Host->>Host: 变成 source.kind='user' 的消息
    Host->>K: 消息进入会话日志
    K->>K: parseHumanGateMessage → 折进投影
    Host-->>UI: 视图更新（by='user'）
```

三条硬约束（每条都有测试）：

1. 动词白名单，表外拒绝，取值也在这一层校验。
2. 这些动词**没有工具 schema**，模型的工具面里不存在它们。
3. 动作留下署名，折进投影时写 `by:'user'`。
