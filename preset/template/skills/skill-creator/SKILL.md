---
name: skill-creator
description: |
  【元技能·创作工艺·触发词: 创建技能, 新建skill, 写skill, 改进技能, 优化skill, 沉淀SOP, 把流程做成技能, 让我以后能复用, 技能描述触发不准】把可复用经验结晶成一个好用的 Skill 的工艺指南。无论你是要从零创建新 Skill、改进已有 Skill、还是优化它的触发描述——动手写 clear/skills 下任何 SKILL.md 之前，都先加载本技能取工艺，确保描述是好触发器、结构精简、解释了 why。
  不适用：写普通文档、README 或代码注释（那是内容工作，不是技能沉淀）；
  一次性经验先落 memory，够通用了再回来沉淀成技能。
license: MIT
metadata:
  tier: system
  origin: template
  version: "1.0-clearai"
---

# Skill Creator（ClearAI 版）

把"这次怎么做成的"结晶为一个**未来千百次可复用**的 Skill。本技能是动态 Skill 进化 loop 的工艺底座：agent 沉淀/改进 Skill 前先读它，保证产出质量。

## 何时用 · 三种入口

1. **创建新 Skill**：手上有一段值得复用的流程（常来自 WriteMemory 的 Trigger-Action-Validation 三元组）。
2. **改进已有 Skill**：某 Skill 用下来有缺漏，要补 checklist / 修步骤 / 改描述。
3. **优化触发描述**：Skill 该触发时没触发（欠触发），调 description。

判断走哪条：先扫外脑索引 `<skills>`/`<candidate_skills>`，有匹配就改、没有就建、都不够通用就只留 memory lesson。

## 在 ClearAI 里怎么落地（工具映射）

写 skill 的**唯一**方式是 `SaveSkill`（勿用 write/edit 改 skill——会被拦）：
- **新建** → `SaveSkill(skill="<name>", content=<SKILL.md 全文>)`。系统自动盖 `tier=candidate`、校验 frontmatter，落入「技能收件箱」等采纳。
- **改进已有** → `SaveSkill(skill="<已有名>", content=<改进后全文>)`。若该 skill 是 trusted/system，系统自动生成「候选改版」、**活版不动**，采纳时才替换。
- **子资源** → `SaveSkill(skill="<name>", path="scripts/x.py"|"references/y.md", content=...)`，一次写一个文件（全文）。
- SaveSkill 不弹写时审批：所有产物都进收件箱，**用户采纳是唯一的生效闸**。
- **不要**在正文引用子代理、`claude -p`、浏览器评测器等 ClearAI 没有的能力。

## frontmatter 契约

```yaml
name: <kebab-case>          # 仅小写字母/数字/连字符
description: |
  【阶段·触发词: kw1, kw2, kw3】一句话能力。适用：...；不适用：指向其他 skill。
metadata:
  tier: candidate           # 系统会自动盖，无需手填
```

**description 是触发的唯一机制，也是最该用心的地方**：
- 首行用 `【阶段·触发词: ...】` 列 3-6 个用户任务里会出现、能命中本 skill 的关键词。
- 要**"pushy"对抗欠触发**：明确写"当用户提到 X、Y、Z 时就用本技能，即使没明说要用"。当前模型倾向于该用 skill 时不用，描述写得主动一点能纠偏。
- 写清**适用 / 不适用**，不适用处指向更合适的 skill 名，减少误触发。

## 结构与渐进式披露

Skill 三级加载，写时按此分层、保持每层精简：
1. **name + description**（始终在 context）——触发判断只看这层。
2. **SKILL.md 正文**（触发后加载，目标 <500 行）——SOP 主干。
3. **子资源**（按需读/执行）——`scripts/` 确定性代码、`references/` 详细文档、`assets/` 产物模板。

正文超长就加一层层级：SKILL.md 留主干 + 指针，细节挪进 `references/`，并在指针处说明"何时去读"。多领域/多框架按变体拆 `references/<variant>.md`，正文只做选择与编排。

## 先分清这是谁的活

harness 执行不变量（与具体任务无关、没商量余地），skill 提供工艺（这类事怎么做得好），
agent 做接合（把工艺用到具体情境）。动笔前先问这条内容属于哪一层——放错层的内容不会报错，
只会慢慢腐坏。

**平台已经强制的，写「为什么」而不是重抄规则。** 读者撞上拒绝时需要理由才能改对；一份和
平台重复的规则表既帮不上忙，还会先于平台过期。

**平台强制不了的，才是 skill 的本职。** 本仓的例子：`verify` 阶段隔离的是数据目录与 HOME，
不隔离网络，所以「运行时不引 CDN」在验证时看不出来，产物拿到没网的地方才炸——这条只能靠
工艺纪律加技能自带的检查脚本兜住。这类内容写得越具体越好。

**数据的形状归上游技能的契约或 harness 的校验**，别焊进呈现/渲染类技能。调用时自然会带
进来；写死了反而让技能在别的数据上用不了。

### 别复述平台行为，那会漂移

写「平台会怎样」的句子迟早和平台对不上，而读者拿它当真。本仓踩过：某技能写「手建目录不会
被识别，且这个失败是静默的」，而平台早已给出带修复建议的显式错误。这句不只是过时——它暗示
agent 不必去读错误信息，可答案恰恰就在那里。

写「你该怎么做、以及为什么」，把「平台实际怎么反应」留给它自己的错误信息去说，那永远是最新的。

### 平台常量分两种

判据只有一个：**这个数字会改变 agent 的下一步动作吗？**

会就写。一个外部调用的超时秒数是「这个操作要不要拆成后台作业」的直接输入，不写他就没法判断。

不会就别抄。state 的字节上限对 agent 没有决策价值，写「有上限、大数组换成摘要与 state_ref」
就够了，具体数字让平台的拒绝去说。抄下来的常量没有任何机制会随平台更新，而它看起来永远
像是准确的。

## 写作风格（决定 skill 好不好用）

- **解释 why，而非堆大写 MUST**。模型很聪明、有 theory of mind，给它理由比给铁律更有效、更通用。写到 ALWAYS/NEVER 全大写或极刚性结构时，是黄旗——回头重述成"为什么这样做"。
- 用**祈使句**，面向通用场景而非过拟合到具体例子。
- 先写草稿，再以新眼光重看一遍精简——删掉不拉动效果的部分。

## 评测 = 复用 ClearAI 已有回路（不要另造）

skill-creator 原版有一套子代理 benchmark + HTML viewer。在 ClearAI 里**用我们已有的两条回路顶替**：

- **人评** = 把 candidate 交给用户在**技能收件箱**采纳/驳回。采纳即"通过评审"。
- **量化** = 看该 skill 的 **uses/wins 遥测**（`clear/audit/skill_usage.jsonl` 聚合，索引按 wins/uses 排序）。被反复加载且关联成功计划多，说明它好用，自然上浮。
- **重复脚本信号** = 若多次任务里你都手写了同一个脚本，把它写一次放进该 skill 的 `scripts/` 并在正文引用，省掉未来每次重造轮子。

## 更细的写作模式 / 示例 / 反例

需要 description 优化细则、好/坏示例、近义反例设计、领域拆分模板时，读 `references/authoring-guide.md`（按需加载，不必一上来就读）。
