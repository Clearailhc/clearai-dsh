# 本体:verification-loop

十个对象 + 五级验证(给模型选的只有 L2 / L3 / L4 三档)。声明是数据;实例状态由事实算出来(见文件头那条红线)。

## 对象

### goal
- 状态:open → achieved → abandoned → superseded
- 初始:open · 终态:achieved、abandoned、superseded
- 落点:fold.goal + clear/goals/(不新建存储)
- 每次转移发:goal/set
  - open → achieved:由 **system** 发起,当 goal_verified(守卫:independent_verdict_support)
  - open → abandoned:由 **model** 发起,当 goal_abandoned(守卫:independent_verdict_written)
  - open → superseded:由 **model** 发起,当 new_goal_set
- 字段:claim、done_criteria、promote_at_level(L0|L1|L2|L3|L4)、revision
- 说明:这一平面的一等对象(那一侧记在 goal 文档里);status 是派生值,声明里没有它的住处

### hypothesis
- 状态:proposed → alive → confirmed → refuted → superseded → retracted
- 初始:proposed · 终态:refuted、superseded、retracted
- 落点:fold.hypotheses(goal/set 一起落)(不新建存储)
- 每次转移发:hypothesis/superseded
  - proposed → alive:由 **system** 发起,当 evidence_appended
  - proposed → confirmed:由 **system** 发起,当 promotion_threshold
  - alive → confirmed:由 **system** 发起,当 promotion_threshold
  - confirmed → refuted:由 **system** 发起,当 refuting_evidence
  - alive → refuted:由 **system** 发起,当 refuting_evidence
  - confirmed → retracted:由 **human** 发起,当 retraction_request(守卫:human_retraction_decision)
  - proposed → refuted:由 **system** 发起,当 refuting_evidence
  - proposed → superseded:由 **model** 发起,当 hypothesis_revised
  - alive → superseded:由 **model** 发起,当 hypothesis_revised
- 字段:claim、refute_when
- 说明:状态由证据算:**confirmed 那条边的落账在 fact 对象那边**(升格成事实 ⇒ 面板把它读成已确认),假设自己没有那条变更;refuted 与 retracted 都是黏性终态(与「目标侧被推翻的计划不可复活」同一个病同一个修法),而 retracted 是**人的动作**、落账在 fact 对象上(`fact/retracted`);不声明 status

### plan
- 状态:active → closed
- 初始:active · 终态:closed
- 落点:fold.plans + clear/goals/plans/(不新建存储)
- 每次转移发:plan/created
  - active → closed:由 **model** 发起,当 plan_closed
  - active → active:由 **system** 发起,当 gate_failed_repeatedly(守卫:block_threshold)
- 字段:brief、steps、confirmed_at、confirmed_by(user|autonomy|progress)、blocked
- 说明:「受阻」是字段不是状态(它会被清掉);授权记号也是字段——有记号或已推进过都算授权

### step
- 状态:open → advanced → void
- 初始:open · 终态:advanced、void
- 落点:fold.plans[].steps(不新建存储)
- 每次转移发:step/advanced
  - open → advanced:由 **system** 发起,当 step_delivered(守卫:admission_passed、level_judge_split、external_source_for_l4、human_release_for_l4)
  - open → void:由 **model** 发起,当 step_voided
- 字段:do、done_criteria、artifacts、tests
- 说明:这一平面上它同时就是「一次验证」(step.tests = hypothesis + level);没有「降级重做」那条边:秩明令降级不可表示;「受阻」不在步的状态里——它是计划上的字段(见 plan 的自环)

### observation
- 状态:received → accepted → rejected
- 初始:received · 终态:accepted、rejected
- 落点:fold.materials(收下的)+ 准入账(不收的)(不新建存储)
- 每次转移发:observation/recorded
  - received → accepted:由 **system** 发起,当 source_admissible(守卫:admission_passed)
  - received → rejected:由 **system** 发起,当 source_not_admissible
- 字段:content、source(self)、ref
- 说明:`received` 活在一次交付调用之内(候选观测):收下的才成为对象,不收的只留一条准入事实——「不收」不是对象的终态,是账本上的一行。来源取值与生产者**逐一对齐**(见 `source` 字段的说明):类型只声明今天真能发生的那些

### evaluation
- 状态:recorded
- 初始:recorded · 终态:recorded
- 落点:fold.audits + clear/evidence/audits/(不新建存储)
- 每次转移发:audit/settled
- 字段:evaluator(self|independent|machine)、verdict(support|refute|inconclusive)、basis、shortfalls
- 说明:写下就不改;重评产生新的一条。做的人与判的人按等级分开(L3 以上只能由独立评估者写)

### evidence
- 状态:recorded
- 初始:recorded · 终态:recorded
- 落点:fold.evidence(不新建存储)
- 每次转移发:evidence/recorded
- 字段:verdict(support|refute|inconclusive)、level(L0|L1|L2|L3|L4)、refs、anchor(auditor|artifact)
- 说明:与步骤上的收敛记录分开;anchor 说这条证据钉在哪(独立裁决 / 物证)

### fact
- 状态:promoted
- 初始:promoted · 终态:promoted
- 落点:clear/knowledge/facts/(不新建存储)
- 每次转移发:fact/promoted
- 字段:text、scope、level、evidence、path、last_verified、refuted、review
- 说明:升格由系统做;每条带边界(scope)与等级,下一轮作为「已知」引用时先看边界。货架在 clear/knowledge/facts/INDEX.md(面板「事实」那一格读的是同一张表)。被推翻只**标记**(refuted,派生),撤回是**人的动作**(retracted,落 fact/retracted)——两件事分开记,因为数据自己也可能错

### anomaly
- 状态:open → explained → ruled_out → escalated
- 初始:open · 终态:explained、ruled_out、escalated
- 落点:fold.anomalies(不新建存储)
- 每次转移发:anomaly/opened
  - open → explained:由 **model** 发起,当 anomaly_explained
  - open → ruled_out:由 **model** 发起,当 anomaly_ruled_out
  - open → escalated:由 **model** 发起,当 anomaly_escalated
- 字段:what、anchor、by(model|evaluator)、reason
- 说明:认识论里的「反常」:和预期或本体对不上的观测。评估者报的随 audit/settled 一起来(by=evaluator)。不阻塞结案,但结案时随交付交给评估者

### release
- 状态:granted
- 初始:granted · 终态:granted
- 落点:fold.releases(原生审批栈的审计对是权威记录)(不新建存储)
- 每次转移发:human/released
- 字段:step、call、via(approval)
- 说明:L4 的人放行:一次一放行;步级的事实一落,同一步重试不再问人)

## 五级
- **L0** 判者 self · 来源 self · 门 none —— 旧账:读作自己检验(与 L2 合并,新写的 L0 当 L2 收)
- **L1** 判者 self · 来源 self · 门 none —— 旧账:读作自己检验(与 L2 合并,新写的 L1 当 L2 收)
- **L2** 判者 self · 来源 self · 门 none —— 自己检验:推理、已有知识、已有数据或小规模计算;依据必须可复查
- **L3** 判者 independent · 来源 self · 门 registered_criteria —— 新产生且可重跑的证据;判据先写后做,裁决由独立评估者写
- **L4** 判者 independent · 来源 human_upload、file_drop、callback、pull · 门 human_release —— 不可重复或来自外部的证据;先登记标准,人放行(原生审批栈的权威记录)
