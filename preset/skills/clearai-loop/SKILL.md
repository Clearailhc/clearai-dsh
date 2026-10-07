---
name: clearai-loop
description: Use when working inside the ClearAI preset and a delivery keeps getting rejected, a plan is blocked, an ontology file write is refused or flagged, or you need to read an evaluator's verdict card — what admission checks, what to do after a rejection, how the two-part verdict is read, and how the ontology files are checked.
---

# ClearAI 循环:被拦了怎么办

循环本身写在提示词的「循环」一段,每个工具的用法写在工具说明里。这份技能只讲那两处没写的:准入核什么、被拦之后怎么走、评估卡怎么读、本体文件怎么被检查。这里的每条规则都由 `clearai-kernel` 执行,不是劝告。

## 准入只回答「收不收」

`AdvancePlan` 交付时,系统按这个次序核对:

1. 声明的产物**存在**吗?不存在就拒,出路三条:把它做出来、改声明、或用 `RevisePlan(action="void")` 带因作废这一步。
2. 声明的是**目录**吗?目录不是物证,改为声明具体文件。零字节文件同样拒:空文件不是观测。
3. **结构合法**吗?`.json` 要能解析;`.md` 去掉标题行后不足 20 个字算「只有标题」。别的扩展名不做结构判定。
4. 一个产物都没声明 → `no_anchor`:不改变世界的步骤没有可验收的东西。
5. 都过了且判据非空 → 不是放行,而是送评(L3 以上派独立评估者;L2 自己检验用你给的 `basis` 与 `results`)。

准入不看判据里的任何断言:数值、口径、一致性都不看。`touch` 一个文件也能过准入,所以过了准入绝不等于这一步做完了。

## 被拦之后

- **准入拒了**:按返回的缺口改产物或改声明再交。判据本身写错了,用 `RevisePlan(action="refine")` 改,旧判据留在账上。
- **评估者说交付不成立**:读它的 `shortfalls`(哪条判据、看到了什么、还缺什么),补齐再交。不要换个说法重交同一份东西。
- **同一步连拦到阈值**:计划置为 blocked,系统当场问人是按缺口再改还是作废这一步;没人能答就停下等人。别硬试下一次。
- **在 L3 以上带了 `results`**:被拒(`verdict_not_accepted`),去掉 `results` 重交,系统会派评估者。

## 评估卡怎么读

一张卡两项裁决,各管各的:

| 项 | 回答什么 | 取值 |
|---|---|---|
| `holds` | 交付成立吗:判据逐条满足、观测真实 | yes / no / unclear |
| `results` | 这一步检验的每条判断,对照推翻条件读出了什么 | support / refute / inconclusive |
| `anomalies` | 原始数据里你没登记的异常、站不住的排除理由 | 每条一句;系统记成「评估者发现」的未解释项 |

`holds=yes` 这一步就完成,不管 `results` 是支持、推翻还是说不清。推翻和说不清照样记成证据,判断的状态由证据算。评估卡写不进来时裁决降级为 `unknown`,这一步不推进,绝不静默放行。

评估卡、证据、事实由系统落盘;`clear/evidence`、`clear/knowledge/facts`、`clear/goals` 你都写不了。重评产生新证据,旧证据不改不删。

## 本体文件被拒或被标出来

本体文件(`clear/ontology/{concepts,relations,entities}/**.json`)查三道:

1. **写入时只查这一个文件**:JSON 能解析、字段齐且类型对、`id` 等于文件名、取值合法。不过这次写入就被拒,原因原样回给你;照 `clear/ontology/SCHEMA.json` 改好再写。引用的东西在不在这时不查,所以先写实体、后补它的概念也可以。用 bash 写进来的文件跳过这一道,但躲不过下一道。
2. **读取时查跨文件**:引用的 id 存在、id 不重复、主语和宾语的类型对得上(下位概念也算)、单值关系只有一个取值。有问题的节点或关系不进图,卡上「本体文件有 N 处问题」逐条列出;它只提示,不拦你干活。
3. **升格时把断言涉及的本体全查一遍**:结案通过时,判断里的断言用到的关系、类型、主体此刻都要成立;不成立这条判断就不写进长期知识,回执里写明卡在哪。

卡上某条事实标「定义已变」:它升格时用到的某个概念或关系后来改了含义(释义、上位、主语域、宾语域、单值性)。看一眼它还成不成立:不成立就在新目标里把它当待检验的判断重新检验;改名、改别名不会触发这个标记。

要重新检验一条已有事实(定义变了、新数据与它矛盾、换了条件),Frame 时给那条判断写 `retests: "<事实 id>"`(事实 id 就是 `clear/knowledge/facts/<id>.json` 的文件名)。别的会话留下的事实也这样做:复检被推翻时,系统会当场问人撤回还是维持那条事实;不写 `retests`,旧事实不会知道它被推翻了。

## 结案之后

结案成功、而这次摸出了一套以后还会用的做法(怎么查、怎么算、怎么验),把它写成原生技能:`.agents/skills/<名字>/SKILL.md`,开头的 `description` 写清什么时候用。下次宿主会把它列出来。只做了一次、不会再用的,不写。

---

# The ClearAI loop: what to do when blocked (English)

The loop itself is in the "loop" section of the prompt, and each tool's usage is in its own description. This skill covers only what those leave out: what intake checks, how to proceed after a rejection, how to read an evaluator's card, and how ontology files are checked. Every rule here is enforced by `clearai-kernel`; none of it is advice.

## Intake only answers "accept or not"

When you deliver with `AdvancePlan`, the system checks in this order:

1. Do the declared outputs **exist**? If not, it refuses, with three ways out: produce them, change the declaration, or void the step with a reason via `RevisePlan(action="void")`.
2. Is a declared output a **directory**? A directory is not proof; declare concrete files. Zero-byte files are refused too: an empty file is not an observation.
3. Is the **structure valid**? `.json` must parse; a `.md` with fewer than 20 characters after removing the title line counts as "title only". Other extensions get no structural check.
4. No output declared at all → `no_anchor`: a step that changes nothing has nothing to accept.
5. All passed and the criteria are non-empty → this is not approval but referral (an independent evaluator from L3 up; your `basis` and `results` at L2, self-tested).

Intake does not look at any assertion in the criteria: values, definitions and consistency are not checked. `touch` on a file passes intake, so passing intake never means the step is done.

## After a rejection

- **Intake refused**: fix the output or the declaration according to the reported gap, then deliver again. If the criterion itself is wrong, change it with `RevisePlan(action="refine")`; the old one stays in the ledger.
- **The evaluator says the delivery does not hold**: read its `shortfalls` (which criterion, what it saw, what is missing), fill the gaps, then deliver again. Do not hand in the same thing reworded.
- **The same step blocked up to the threshold**: the plan is marked blocked and the system asks a person right there whether to revise against the gaps or void the step; if nobody can answer, it stops and waits. Do not force another attempt.
- **`results` given at L3 or above**: refused (`verdict_not_accepted`). Deliver again without `results`, and the system dispatches an evaluator.

## Reading an evaluator's card

One card carries two verdicts, each answering its own question:

| Item | Answers | Values |
|---|---|---|
| `holds` | Does the delivery hold: every criterion met, observations real | yes / no / unclear |
| `results` | For each judgment the step tests, what the observation shows against its refutation condition | support / refute / inconclusive |
| `anomalies` | Anomalies in the raw data you did not record, and ruling-out reasons that do not hold | one sentence each; the system records them as unexplained items found by the evaluator |

With `holds=yes` the step is complete, whatever `results` says. Refute and inconclusive are recorded as evidence all the same, and the judgment's status is computed from the evidence. If the card cannot be written, the verdict degrades to `unknown` and the step does not advance; it is never silently let through.

The system writes evaluator cards, evidence and facts; you cannot write `clear/evidence`, `clear/knowledge/facts` or `clear/goals`. A re-evaluation adds new evidence; old evidence is never changed or deleted.

## When an ontology file is refused or flagged

Ontology files (`clear/ontology/{concepts,relations,entities}/**.json`) go through three checks:

1. **On write, only this file is checked**: the JSON parses, fields are present with the right types, `id` equals the file name, values are legal. If it fails, the write is refused and the reason comes back verbatim; fix it according to `clear/ontology/SCHEMA.json` and write again. Whether referenced things exist is not checked here, so you can write an entity first and its concept later. Files written through bash skip this check but not the next one.
2. **On read, across files**: referenced ids exist, ids are unique, subject and object types fit (narrower concepts count), single-valued relations have one value. Nodes or relations with problems stay off the graph, and the card lists them under "ontology files have N problems"; this only warns, it does not stop your work.
3. **On promotion, every part of the ontology an assertion uses is checked**: when a conclusion passes, the relations, types and subjects used by a judgment's assertions must all hold at that moment; if not, that judgment is not written to long-term knowledge, and the receipt says where it is stuck.

A fact marked "definition changed" on the card: a concept or relation it used at promotion later changed meaning (definition, broader term, subject domain, object range, single-valuedness). Check whether it still holds; if not, test it again as a judgment in a new goal. Renaming or changing aliases does not trigger this mark.

## After concluding

If the conclusion succeeds and the run found a method worth reusing (how to look up, compute or verify), write it as a native skill: `.agents/skills/<name>/SKILL.md`, with a `description` at the top that says when to use it. The host lists it next time. Skip anything done once and never needed again.
