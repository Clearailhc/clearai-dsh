> **时点声明**：本文是**当时**（0.2.9 开发线）的状态与读数快照，正文数字保留原样、不改写历史。文中的「真值表 64 / 68 条」「`verify-truth-table.mjs` 25 项全过」「反向检查仍不存在」「29 件工具」都是那一刻的读数；现行读数以 `truth-table.zh-CN.md`（71 条机制、29 项校验，且已有「代码 → 真值表」反向检查）与 `CHANGELOG.md` 为准。
> 独立验证员（fresh context，未参与实现）对上述诊断与全部改动的逐条复算记录。
> 结论：放行通过；遗留清单见文末。

# VERIFY.md —— 独立验证报告(verify-final)

范围:本轮 30 个改动文件 + 4 个新文件(逐文件读 `git diff`)。只读;除本文件与 `.tmp-verify/` 证据脚本外未改仓库任何文件。
基线:`git HEAD=9396403`。所有读数都是我自己跑出来的;凡引用他人结论的地方都标了「未独立复算」。

> 先纠一个前提:任务书说「`DIAGNOSIS.md` §1 有 S1–S9 九条成功标准」——**该文件里没有 S1–S9**
> (§1 是 CloseGoal 诊断;`.tmp-audit/A-closegoal-broken.md` 用的是 P1–P7)。所以下面 1–7 条
> 是按任务书正文的描述逐条复算,不存在一份可对照的成文 S1–S9。

---

## 1. S1 · 属性式服务访问 & 读面不抛 —— **已证实**

- `grep -n "ctx\.(sessions|sessionProjections)" ui/lib/index.js preset/plugins/clearai-kernel.js` → 0 命中;
  两文件的会话/投影访问全是 `ctx.get('sessions')` / `ctx.get('sessionProjections')`(index.js:144/159,
  kernel.js:796/826/1426/1693/6891)。`inject` 声明保留(index.js:28),与契约一致。
- 读面降级路径(index.js:141-168 sessionsOf/projectionsOf 各带 try/catch + undefined/null 判断;
  216-233 stateOf/sessionOf/viewOf 全部落到 `emptyState()`;`apply()` 里 `projectionsOf()` 拿不到就
  返回空 disposer;`ctx.on('internal/status')` 整段 try/catch)——**不抛**。
- 行为复现:`DSH_HOME=$PWD/.tmp-impl/dsh node test/host.test.mjs` → **119 通过 / 0 失败**,其中
  「A1/A6」「P7」两组 13 条全绿(含桩忠实性检查:属性式访问确实当场抛 inactive,方法式只回 undefined)。
- **残留(见 §8-D10)**:同包 `ui/lib/invariant.js:163` 仍有属性式 `ctx.sessions.list()`;
  任务书只点名了两个文件,所以不算违反本轮契约,但「ui 源码无属性式」这句话作为整包断言是假的。

## 2. S2 · 派发事实在 await 之前 —— **主项已证实;后半被证伪**

- audit 路:`preset/plugins/clearai-kernel.js:2071` `landFact(sessionId, {t:'audit/dispatched', id: pendingId, status:'dispatching'})`
  紧接 `:2072` `await dispatchSubRun(...)`。scout 路同形(1957 → 1958)。
  该函数内确实还有别的 `await`(`Promise.race` @2094、`entry.run.dispose()` @2129),但它们都在 landFact 之后。
- **派发失败分支会留下悬空事实(已实测)**:失败时 `:2083` 只 push `audit/settled(id=pendingId)`,
  而 `audit/dispatched(id=pendingId)` 只存在于独立通道。`withPendingFacts`(3101-3115)把 pending
  **追加在** own **之后**,去重键是 `t:id`(settle 与 dispatched 不同键,互不压制);fold 侧
  `audit/settled` 是 `find(id)` 更新、找不到即 no-op(`fold.js:557-566`),`audit/dispatched` 无条件
  push(`fold.js:509-529`)⇒ 最终账上留下一条 `verdict:null、child:null` 的 dispatched。
- 实测(`node .tmp-verify/kernel-probe.mjs`,宿主桩与 `test/kernel.test.mjs` 同形):
  1 次失败后 `state.audits` = 1 条 verdict=null,`derive()` 报 `pendingAudit:true / phase:'auditing'`;
  连续 2 次失败后 = 2 条(每次失败 CloseGoal 自己又写一条 evidence ⇒ digest 变 ⇒ 新 pendingId,
  所以两条不会互相结清)。`:2082` 的注释「不让它挂成悬空」与实际相反。

## 3. S3 · reuseAudit / auditDigest —— **判据已证实;「同态不重派」适用面被证伪**

- 判据(读码):`digest = sha256(JSON.stringify([kind, step.id, goal.id, goal.revision,
  confirmed.map(ref:digest), evidence.map(id:verdict)]))[:16]`(kernel.js:1918-1924);
  `reuseAudit` 要求 `state.audits` 里存在 `step` + `digest` 相同、且 `verdict ∈ {support,refute,inconclusive}`
  的条目(1927-1937);调用点先看在飞的 `pendingAudits` 再看已落定的(2027-2058)。
- 实测:
  - **状态逐字不变**(按 sweep 口径手工把一条 `audit/settled`(refute,同 digest)落进账本,不加证据行)
    → 落 `audit/reused` 1 条、**新派遣 0 次** ✓(kernel-probe 场景 3)。
  - **证据变一条**(正常 CloseGoal 把裁决记成 `evidence/recorded`,id 是随机 `e-xxxxxx`)→ digest 变
    → **第 2 次真派遣** ✓(场景 2:`第1次 dispatched=1, digest=73e1…;第2次 dispatched=1, digest=7d13…`,
    真实派遣 2 次)。
- **重要限定(证伪的部分)**:CloseGoal/AdvancePlan 在非 support 裁决时**自己**会追加一条证据,
  于「同一状态反复结案」在内联结算路径上**必然重派**——A3 想治的正是这条。复用只在
  「进程重启后 pendingAudits 为空」或「sweep 回收的结算落账但不带证据行」时生效。
  这是机制适用面的限制,不是算术错误。

## 4. S4/S5 · graphProjection 实算 —— **已证实**

命令:`node .tmp-verify/s45.mjs`(旧版用 `git show HEAD:ui/lib/domain-language.js` 取到 `.tmp-verify/domain-language.old.js`):

| 输入 | entity 节点 | entity 边 | 总节点/边 |
|---|---|---|---|
| 5 条 facts 断言 `sucai\|yangben_* · cheng_wei = chouxiang\|chouxiang` | **6** | **5** | 8 / 6 |
| 5 条 `entity/registered` + 5 条 `entity/asserted`(同批主体) | **6** | **5** | 8 / 6 |
| 上面两组同时喂(同键去重) | 6 | **10** | 8 / 11 |

- 第一种与 `.tmp-audit/B-entity-graph-broken.md:117` 的反事实读数(6 节点/5 边)一致;
  第二种里 `chouxiang` 节点 `source='asserted'`、5 个主体 `source='registered'`。
- **逐字节兼容**:6 个用例(空态 / 词表+事实 / 无断言事实 / 含 literal 宾语 / `entities:[]` 显式空 /
  `entities:undefined`)新老 `JSON.stringify(graphProjection(state))` **全部相同,0 处不一致**。
- 说明:新实现只在 `entities.length>0 || entityAssertions.length>0` 时加 `source` 字段
  (`domain-language.js` 的 merging 判断),空来源路径与 HEAD 逐字一致——这一条我自己比的是**字节**,
  不是「有没有 source 字段」。

## 5. S6/S7 · 断言能否抓住回归 —— **levels_skipped 已证实;entities_unlanded 与 headline 部分证伪**

方法:整份 `ui/lib` + `preset/plugins` + 三个测试复制到 `.tmp-verify/mut/`,逐条变异后跑,跑完复位。

| 变异 | 结果 | 判定 |
|---|---|---|
| `fold.js` `if (skippedCount > 0)` → `if (false && …)` | contrast **5 红**、readability 1 红 | 抓得住 ✓ |
| `fold.js` `entities_unlanded` 触发条件 → `if (false)` | contrast **41/41 全绿**;readability 仅「七种缺口都被构造出来」那条**前置**断言红 | **抓不实** ✗ |
| kernel `headline.maxLength` 120 → 500 | readability 2 红 | 抓得住 ✓ |
| kernel 运行时上限 `>120` → `>500`(文案仍写 120) | readability **35/35 全绿** | **抓不住** ✗ |
| kernel 运行时校验整段 `if (false)`(fail code 与文案留着) | readability **35/35 全绿** | **抓不住** ✗ |
| `landFact` 行挪到 `await dispatchSubRun` 之后 | contrast 1 红(定点那条) | 抓得住 ✓ |

- `entities_unlanded` **没有专属正确性断言**:没有对 `count`(= wanted)的断言,没有对
  `entityNodes===0` 触发条件的断言,也没有 C2 承诺的「落账后缺口消失」那一半。
- `readability` ①的三条「机制」断言都是**文本级**(`maxLength` 数值 + 源码里有没有 `headline_too_long`/
  `headline_required` 字符串),没有任何测试**执行** SetGoal 去验拒绝(见 §6)。
- `readability:121-122` 两条「活检查」是**恒真自证**:`'长'.repeat(500).length > limit` /
  `'长'.repeat(30).length <= limit` 只对字面量做长度比较,与源码无关(limit 恒为 120 或 500)。

## 6. 端到端读数复核(18 套件)—— **已复现**

命令(照抄任务书):
```
rm -rf .tmp-impl/dsh/profiles/web/node_modules/clearai-dsh \
  && cp -r dist/clearai-dsh .tmp-impl/dsh/profiles/web/node_modules/clearai-dsh \
  && DSH_HOME=$PWD/.tmp-impl/dsh bash test/run.sh
```
读数(第 1 遍):

| 套件 | 读数 | 套件 | 读数 |
|---|---|---|---|
| kernel | 754 通过,0 失败 | docs-consistency | 16 / 0 |
| host | 119 / 0 | comment-style | 7 / 0 |
| brain | 40 / 0 | authority-boundary | 18 / 0 |
| client | 242 / 0 | preset-composition | 22 / 0 |
| domain-language | 225 / 0 | prompt-sections | 13 / 0 |
| ontology | 96 / 0 | e2e-scenarios | 41 / 0 |
| truth-table | 24 / 0 | invariant | 28 / 0 |
| state-machine | 43 / 0 | contrast | 41 / 0 |
| readability | 35 / 0 | prompt-budget | 26 / 0 |

末行 `全绿(1 遍)。`,退出码 0。host/client 是**真跑了**(不是「跳过」);dist 与源逐字节一致这条
由这两个套件自己的比对通过间接证明(我没有独立重算构建产物)。

**「空跑 / 恒真」的排查结论**:
- 没有断言数为 0 的套件;`invariant` 里 3 条 `check(…, true)` 是 try/catch 的**通过分支**(同 label 的
  catch 分支传 false),不算恒真。
- 恒真:readability 的两条 length 自证(见 §5)。
- **覆盖声明与实现不符**:`test/run.sh:17` 写 contrast 覆盖「同态不重派」,而 contrast.test.mjs
  全文没有 `reuse`/`audit/reused`/digest 相关断言(grep 0 命中)——S3 的行为没有测试。
- `comment-style` 配额确实是 **0/0/0**(dateStamp/sectionRef/incidentTag),但它只实现了判据文档写的
  「四类」反模式里的**三类**:`变更流水` 既无 PATTERN 也无 BASELINE(非本轮改动)。
- `prompt-sections` 断言的「24 段」与 `SECTIONS`(实测 24)一致;CONTRACT §8 说本计划要改成 25,
  实际本轮只在既有段里加了 2 段文字、没有新段 ⇒ **契约文本过期,不是缺陷**。
- `run.sh` 语义提醒:host/client 在未安装插件时打印「跳过」并仍然输出「全绿」。
  本次读数组里它们是真读数。

---

## 7. 真实缺陷 / 风险(按严重度,含触发条件)

### D1(高)· 派发失败留下悬空 `audit/dispatched`,且每次失败累积一条
- 触发:`dispatchSubRun` 返回 `ok:false`(subagents 服务不可用 / provider 拒绝全部变体)。
- 位置:kernel.js:2071(landFact)、2083(只落 settled)、3101-3115(withPendingFacts 把 pending 追加在 own 之后、去重键 `t:id`);fold.js:509(`audit/dispatched` 无条件 push)、557(`audit/settled` find-不到即 no-op)。
- 实测:1 次失败 → 1 条 `verdict:null` + `derive().pendingAudit===true`;2 次失败 → 2 条。
- 后果:卡/派生告诉模型「有裁决在飞,等一等」,而根本没有评估者在跑;`:2082` 的注释与事实相反。
- 建议:失败分支把 settle 落成 `audit/settled` 时改成「先补 dispatched 再 settle」,或让 withPendingFacts
  把 pending 拼在 own **之前**,或让 fold 的 settled 在找不到时按缺口补建。

### D2(高,契约偏离)· B2「判据修订过独立裁决」没有生产者
- 冻结契约 §1③ 要求 `criteria/revised`(带 `audit`),§6 要求 SetGoal 新增 `criteria[]` /
  `criteria_note` / `criteria_verdict`;`docs/optimization/state-machines.zh-CN.md` §1 也写它「已实现」。
- 实际:全仓只有 `fold.js:992`(折法)与 `test/domain-language.test.mjs:607/731`(手造变更);
  内核 SetGoal 参数里没有 `criteria*`,`goal/set` 从不带 `criteria`,`criteria/revised` 无任何生产者。
- 后果:卡上 `goal.criteria` 分支、`GLOSSARY.criteria_verdict`、「判据全文只在变更时注入」都是**死代码**;
  模型没有办法完成「改判据要带独立裁决」。

### D3(高,契约偏离)· SetGoal 的 `legacy` 例外没接上
- 契约 §4 明写「内核 SetGoal 传 legacy:true 时跳过该校验」。
- 实际:kernel.js:3193 `judge.validateAssertions(sessionId, hypothesis.assertions)` **不传 options**;
  生产 facade(`ui/lib/index.js:853`)递整份 state,而 `emptyState()` 恒有 `entities: []`,
  所以主体校验**永远生效**。
- 实测:未登记主体 + `legacy:true` → `assertions_rejected`(同一条不带 legacy 也是它);
  主体已登记 → `goal_set`(所以不是误伤已登记场景)。

### D4(中高)· `entities_unlanded` 门可被「一个无关登记」绕过
- 触发条件写成 `wanted > 0 && entityNodes === 0`(fold.js:1403)。登记**任意一个**实例节点
  (哪怕与断言主体毫无关系,或只登记 5 个主体里的 1 个)⇒ 缺口整条消失 ⇒ CloseGoal 的
  `requireLandedEntities` 门放行,而 5 个断言主体仍在实体图外。
- 实测(`node .tmp-verify/extra.mjs`):0 节点 → `count:5`;登记 1 个无关节点 → `null`;
  只登记 1/5 个主体 → `null`;登记全部 5 个 → `null`。
- 契约 §5 的说明自己担心「登记一堆孤立节点」满足这道门,但触发条件恰好允许**一个**孤立节点。

### D5(中高,本轮未交付而非新引入)· 运行态卡带绝对时间 ⇒「同一状态不重复注入整卡」不成立
- `renderCard` 传 `now: Date.now()`(fold.js:2768)→ 卡里写 `YYYY-MM-DD HH:MM`
  (knowledge-view.js:181);kernel.js:7389 用 `lastCard.get(sessionId) === card` **逐字节**去重。
- 实测:同一状态同一时刻两次渲染相同;**跨 60 秒边界不同**(首个差异行就是那行「时间」)。
- 即:每分钟边界后,状态一字未变也会重发整张卡——C4 要治的 194 卡 / 101.6 万字符那条没被治。
  (HEAD 的旧卡也带这行,所以是「没修」,不是本轮引入。)

### D6(中)· 本轮新增的内核面零行为测试
- `git diff test/kernel.test.mjs` 只改了三处工具**数字**与名字清单(29→32、23→26)。
- 全仓没有任何测试**执行** `RegisterInstance` / `Assert` / `ExplainLevelSkip`,也没有测
  `requireLandedEntities` / `requireLevelReasons` 两道门、headline 的落账前拒绝、`audit/reused`、
  `pendingFacts` 通道(只有 contrast 的源码文本断言 + fold/derive 单测)。
- 直接后果见 §5:headline 的运行时上限被改成 500 或整段死掉,套件仍全绿。

### D7(中)· run.sh 对 contrast 的覆盖声明不实
- `test/run.sh:17` 声称 contrast 覆盖「同态不重派」;contrast.test.mjs 无任何 reuse/digest 断言
  (grep `reuse` = 0)。S3 的行为(§3)因此没有回归保护。

### D8(中)· 真值表漏了本轮 5 个新机制,且有两条声明已过期
- `docs/optimization/truth-table.json` 共 64 条,`id` 里没有 pending 独立落账、audit digest 复用、
  entity 写入口、level-skip 理由、hostHealth/host-inactive(grep `skip|reuse|digest|pending|host-health` 全 0)。
- 已有条目的 `input` 已过期而 `known_mismatch` 仍为 null:
  `graph-projection.input` 只写「state.lexicon 与 state.facts」(没提 entities/entityAssertions/source);
  `independent-evaluator` 不提 digest;`assertion-validation.input` 只写「与当前词汇」(现在递整份 state)。
- `tools/verify-truth-table.mjs` 全绿:它核的是配置键白名单、`status=implemented` 有没有给代码位置、
  已删机制有没有回到工具目录、原生行有没有被误摘——**不检查「代码里新长出来的机制有没有被登记」**。
- 且 state-machines 文档把 D2 那个**不存在**的机制写成「已实现」。

### D9(中低)· `Assert` 的类型门是死代码
- kernel.js:4056 用 `hostService.domain.graph?.(sessionId)`;生产 facade
  (`ui/lib/index.js:845-861`)的 `domain` 对象**没有 `graph` 键**(整个 index.js 不含字符串 "graph")
  ⇒ `projection` 恒为 null ⇒ `assert_subject_type_unknown` / `assert_object_type_unknown` 永不执行。
- 实测:`Assert` 宾语给未登记概念 → 被 `validateAssertions` 的 `object_type_mismatch` 拦下
  (`assertion_rejected`),所以危害是「声称的门从不运行 + 误导读码」,不是漏检。

### D10(低)· 同包内仍有属性式访问
- `ui/lib/invariant.js:163` `ctx.sessions.list()`。`dsh-invariants` 用
  `ctx.plugin(Object.assign(install, {inject:['sessions']}))` 建子 fiber,**推断**同一条 inactive
  walk 同样可能抛;但没有真实 fiber 生命周期样本,**未复现**。host.test.mjs 的结构断言只扫 index.js。

### D11(低)· 「判据全文只在变更时注入」实为「改过就永远注入」
- knowledge-view.js:351-361:`criteriaChanged = criteriaHistory.length > 0`,一旦非空,之后**每张卡**
  都注入全文(≤200 字)。实测:加一条 `criteria/revised` 后 done 行永远是全文。因 D2 无生产者,当前不可达。

（另:locale 表 zh/en 各 **425** 键,无单边键,2 个键 zh===en(`放弃缘由(必填)`/`过滤`)——
readability 只对 GLOSSARY 的 plain 查 en≠zh,所以这 2 个不会被抓;不构成缺陷。）

---

## 8. 我无法验证 / 未做的部分

1. **S1–S9 成文标准不存在**(见开头),所以「对照成功标准」这件事没有依据面。
2. `ui/lib/invariant.js:163` 在真实 invariant fiber 生命周期下会不会真的抛:`dsh-invariants@0.2.0-rc.1`
   的 `ctx.plugin(...inject)` 子 fiber 状态机没有可用的真实样本 ⇒ **无法验证**(D10 标为推断)。
3. `pendingFacts` / `pendingFactIds` 按 sessionId 只增、进程内不清:理论上是无界增长;
   我**没有找到**能让同一 `(t,id)` 在独立通道上二次落账的可达场景(需要同 digest 二次派遣,而
   in-process 的 `pendingAudits` 条目会挡住),所以无法量化泄漏,判为低风险。
4. e2e 只跑 1 遍(run.sh 支持 `[遍数]`,未跑 3 遍);`dist` 是否等于源,我依赖 host/client 套件自己的
   逐字节比对通过,没有独立重算构建。
5. 真值表/状态机文档与代码的**方向性**核对:我只查了「文档写了、代码有没有」(查出 D2/D8),
   没有反向穷举「代码有、真值表有没有」(只按关键词抽样)。

## 9. 本次跑过的命令(全部可复跑)

```
git status --short; git diff --stat; git diff <每个改动文件>
grep -n "ctx\.(sessions|sessionProjections)" ui/lib/index.js preset/plugins/clearai-kernel.js   # 0 命中
DSH_HOME=$PWD/.tmp-impl/dsh node test/host.test.mjs                                             # 119/0
node .tmp-verify/s45.mjs                # S4:6/5 节点边;5+5 → 6/5;空来源 6 例逐字节一致
node .tmp-verify/kernel-probe.mjs       # S2 悬空;S3 复用/重派;legacy;Assert;headline
node .tmp-verify/extra.mjs              # D4 门绕过;D5 卡确定性;卡上限 2989/3000;D11
bash /tmp/mut.sh                        # S6/S7 六个变异(结果见 §5)
rm -rf .tmp-impl/dsh/profiles/web/node_modules/clearai-dsh && cp -r dist/clearai-dsh <同上> \
  && DSH_HOME=$PWD/.tmp-impl/dsh bash test/run.sh                                              # 18 套件全绿
node -e '<zh/en locale 键数比对>'        # 425/425,0 单边
```

---

# 复验(lead 修复之后)

冻结版本:`md5sum preset/plugins/*.js ui/lib/*.js test/*.mjs | md5sum` = **b49c0454e347**
(全量运行前后同一哈希,读数可归因;此前几次跑读数漂移 764/3 → 772/1 → 774/0 → 780/0,
是因为 `test/kernel.test.mjs` 在我运行期间仍在被改,那些中间读数不可引用)。

命令:
```
npm run build                     # dist 当时落后于源 ⇒ 必须先重建(dist/ 是 gitignore 的生成物)
rm -rf .tmp-impl/.../clearai-dsh && cp -r dist/clearai-dsh <同上>
DSH_HOME=$PWD/.tmp-impl/dsh bash test/run.sh     # 全绿,退出码 0
node .tmp-verify/{kernel-probe,extra,s45}.mjs
```

读数(冻结版):内核 **780/0** · 宿主 119/0 · 外脑 40/0 · 客户端 242/0 · 领域语言 225/0 ·
本体 96/0 · 真值表 24/0 · 状态机 43/0 · 文档 16/0 · 注释 7/0 · 边界 18/0 · 组合 22/0 ·
段 13/0 · 长测 41/0 · 不变量 28/0 · 对照 41/0 · 可读性 35/0 · 预算 26/0 → `全绿(1 遍)。`

**已修复并复验通过**:

| 缺陷 | 复验证据(同一冻结版) |
|---|---|
| D1 悬空派发事实 | `withPendingFacts` 改为 pending 在前(kernel:3108 起,注释写明 no-op 失效模式);探针:失败 1/2 次后悬空 **0** 条,mutation 序列 `dispatched → settled → evidence`,derive 不再报 pendingAudit |
| D2 B2 无生产者 | SetGoal 参数新增 `criteria`/`criteria_note`/`criteria_verdict`(kernel:3144-3152),`criteria/revised` 有了生产者(kernel:3266,带 audit) |
| D3 legacy 例外未接线 | kernel:3224 传 `{ legacy }`;探针:`legacy:true` + 未登记主体 → `goal_set`(不带 legacy 仍是 `assertions_rejected`) |
| D4 entities_unlanded 可绕过 | 触发改为逐主体差集(fold:1411 `unlanded = wantedKeys − entityKeys`);探针:登记 1 个无关节点 → 仍报 count=5;只登记 1/5 → count=4;全登记 → null |
| D6 新内核面零行为测试 | kernel.test.mjs 新增「实体两件与跳级理由」整节,真的执行 RegisterInstance/Assert/ExplainLevelSkip;套件 754 → **780** |

**仍未闭合**(冻结版实测):

- **D5 卡带绝对时间**:`fold.js:2777` 仍 `now: Date.now()`;实测同一状态跨 60 秒边界卡文本不同 ⇒ kernel:7389
  的逐字节去重每分钟失效一次(旧卡也如此,属「没修」)。
- **D8 真值表**:仍 64 条,无 pending 独立落账 / digest 复用 / 实体写入口 / 跳级理由 / hostHealth;
  `graph-projection.input` 仍只写 lexicon+facts。
- **D9 `Assert` 的类型门仍是死代码**:kernel 1 处 `domain.graph`,生产 facade 0 处 `graph`。
- **D10 `ui/lib/invariant.js:163` 属性式访问仍在**。
- **两道新门无测试**:`grep requireLandedEntities|requireLevelReasons test/*.mjs` 无命中(没有测试设置它们)。
- **contrast 仍无复用断言**:`grep reuse test/contrast.test.mjs` = 0,而 run.sh:17 仍声称它覆盖「同态不重派」。
- **D11**「判据改过就永远注入全文」(knowledge-view.js:351-361)现在因 D2 已可达,行为未变。

---

# 最终复验(源已冻结)

冻结修订哈希(源 + 测试 + 真值表 + 校验器):`md5sum preset/plugins/*.js ui/lib/*.js test/*.mjs
docs/optimization/truth-table.json tools/verify-truth-table.mjs | md5sum` = **7fa9f74f9f83**
(全量运行前后一致,读数可归因)。`npm run build` 重建 dist 后跑任务书那条命令。
仓库提交:`8826100` 含本轮源码改动;其上另有 3 个**空提交** `clearai: 交付 p-…/v1 — 跑一遍`。

18 套件读数(冻结版,`全绿(1 遍)`,退出码 0):内核 **791** · 宿主 119 · 外脑 40 · 客户端 242 ·
领域语言 225 · 本体 96 · 真值表 24 · 状态机 43 · 文档 16 · 注释 7 · 边界 18 · 组合 22 · 段 13 ·
长测 41 · 不变量 28 · 对照 41 · 可读性 35 · 预算 26 —— 全部 0 失败,与 lead 报的读数一致。

## 逐条判定(独立复算)

| # | 判定 | 我的证据 |
|---|---|---|
| 1 D5 | **已闭合** | `renderCard` 不再传 `now`(fold.js 里已无 `now: Date.now()`);`timeText` 已删;`.tmp-verify/extra.mjs`:同一状态跨 60s 渲染 **逐字相同**(此前为 false)。残留:knowledge-view.js:85/150/331 三处注释仍写「时间由调用方给,进 options.now」——注释过期,非行为问题 |
| 2 D8 | **部分闭合** | 68 条(+4:`entity-registration`/`entity-assertion`/`level-skip-reason`/`criteria-revision-gate`);`graph-projection.input` 已含 state.entities/entityAssertions、output 含边 `source`;`verify-truth-table.mjs` 25 项全过。**仍缺 3 条**:A2 独立落账通道(pendingFacts)、A3 digest 复用、A6 hostHealth/host-inactive —— grep pending/digest/reuse/host-health 在 68 条里 0 命中。「方向性」:本轮机制已登记,**但反向检查(代码里新长的机制必须在真值表里)仍不存在**——verify-truth-table 只核已声明条目(①/⑬/⑭),这是结构洞,不是本轮回归 |
| 3 D9 | **已闭合** | `ui/lib/index.js:871` 导出 `graph`(真投影);`.tmp-verify/final.mjs`:宾语类型未登记概念 ⇒ `assert_object_type_unknown`(此前是 `assertion_rejected`);宾语类型已登记 ⇒ `entity_asserted` |
| 4 D10 | **已闭合** | `ui/lib/invariant.js` 改 `ctx.get('sessions')`(取不到就少做一次种子);`ui/`+`preset/` 全域 grep 属性式访问 **0 命中**(invariant.js:164 只是解释性注释);invariant 28/0 |
| 5 两道新门 | **已闭合** | `.tmp-verify/final.mjs` 独立复现:实体门开门 `entities_unlanded`(缺口 count=2、派评估者 0)→ 补登记后放行;关门不拦。跳级门开门 `levels_skipped` → `ExplainLevelSkip` 后 `goal_achieved`;关门不拦 |
| 6 复用 / run.sh | **已闭合** | run.sh:17 已改成「派发事实在 await 前落账、实体图反事实、跳级缺口」;kernel:4820 新增「同态结案」块(断言 evaluators 恒 1 + `audit/reused` 存在)。我独立复现:状态不变再结案 ⇒ `audit/reused` 1、新 dispatched 0、累计真实派遣 1 |
| 7 D1 | **已闭合** | `withPendingFacts` pending 在前;探针:失败 1/2 次后悬空 **0** 条,mutation 序列 `dispatched → settled → evidence`,derive 不再报 `pendingAudit` |

**变异复检(上一轮 S6/S7 的两个盲点已修)**:
- 关掉 `entities_unlanded` 的产生 → 内核套件 **2 条红**(门测试直接依赖它);
- 把 headline 运行时上限整段死码化 → 内核套件 **1 条红**(新增的行为断言)。
两处都从「抓不住」变成「抓得住」(证据脚本:.tmp-verify/mut + kernel.test.mjs)。

## ★ 新发现:高危 —— `requireCriteriaVerdict` 成功路径 TDZ 崩溃

- **位置**:`preset/plugins/clearai-kernel.js:3266` 使用 `goalId` 与 `revision`,而它们的声明在 **3268/3269**。
- **触发**:目标已 open;`SetGoal` 修订时**改了 `done_criteria`** 且带一个**已落定**的 `criteria_verdict`
  (即 `requireCriteriaVerdict` 门的成功路径)。
- **实测**:`ReferenceError: Cannot access 'goalId' before initialization`(由真工具 `execute` 抛出,
  不是我脚本的问题)——见 `.tmp-verify/final.mjs` E 段:前两条拒绝路径正常
  (`criteria_verdict_required` / `criteria_verdict_unknown`),第三条带真 auditKey 时崩。
- **为什么高危**:①`preset/agent.cordis.yml:174` 把它**开到生产**;②两条错误文案都在教模型去拿
  auditKey(「最近几条:`<id>(<verdict>)`」),模型照着做就必定踩到;③抛错时 `goal/set` 与
  `criteria/revised` **都还没落账**(两次 push 都在其后),这次修订整个丢失;
  ④`test/*.mjs` 里 `criteria_verdict` / `requireCriteriaVerdict` **零命中**——没有任何测试走过成功路径。
- **同族**:这正是诊断报告点名的 TDZ 类缺陷(kernel:1857 `settleUnknown` 那一类)在新代码里复发。
  建议修完补一条「带已落定 auditKey 改判据 ⇒ 成功 + criteria/revised 落账」的行为断言。

## 新发现(中低)

- **`test/kernel.test.mjs:90` 的宿主桩与生产不一致**:桩只把 `lexicon` 递给 `validateAssertions`,
  生产(`ui/lib/index.js:853`)递整份 state ⇒ 内核套件**永远跳过**契约 §4 的「主体必须可指认」与
  D3 的 `legacy` 接线。后果:门测试里「SetGoal 带未登记主体却成功」在真实部署里要 `legacy:true`
  或「同批以 instance 宾语引出主体」才成立(我已用后者独立构造出门的真实触发路径,门本身没问题)。
  纯函数判据在 `test/domain-language.test.mjs` 有覆盖,缺的是**内核接线**那一层。
- **scratch 进了版本库**:`.tmp-verify/`、`.tmp-audit/` 共 32 个文件已被提交,其中包括
  `.tmp-verify/mut/**` —— 一份**过期的内核/折法/宿主副本**(13:35 的快照)+ 一个
  `.tmp-verify/mut/.tmp-session` 符号链接。风险:仓库里出现可被误认成源码的副本;
  `verify-truth-table.mjs` 的「孤儿副本」检查只看仓库根 ⑪,覆盖不到嵌套路径。
  (我已 `git restore .tmp-verify/mut` 复位,当前 tracked 工作区无改动。)
- **4 个空提交写进了仓库历史**(`clearai: 交付 p-…/v1 — 跑一遍`):内核 A 层账本把提交写进了它运行的
  这个仓库。不是源码缺陷,但值得知道——提交历史被产品行为污染了。

## 仍未闭合(lead 已自认 + 我复验)

- **D2 部分**:`criteria[]`/`criteria_note` 有参数与折法,但卡/面板仍只渲染 `done_criteria` 全文;
  且 `criteria_verdict` 门虽然可用,**成功路径崩溃**(见上,优先级高于渲染)。
- **D11**:「判据改过就永远注入全文」行为未变(knowledge-view.js:351-361),现在可达。
- **D8 残留 3 条**(A2/A3/A6)+ 反向检查缺失(见上)。
- **S3 的适用面**未变:非 support 裁决的内联结算路径仍会重派(设计限制,已在首轮报告说明)。

---

# 最终放行判定(第二轮修复后)

冻结哈希 **16e48847fc7e**(源+测试+真值表工具);`HEAD=e73b727` 跑前跑后同一个 hash。
`npm run build` 重建 dist 后跑全量:18 套件全绿 0 失败,内核 **801**(与 lead 报的读数一致)。

## ① TDZ —— **已闭合**

`.tmp-verify/final.mjs` E 段(我自己的宿主桩,不依赖 lead 的测试):
`改判据·带已落定 auditKey ⇒ ok = true | goal_revised | criteria/revised = 1`,
且 `goal.done_criteria = 存在一份记录 B | criteriaHistory = 1 | audit = a-probe-1`;
两条拒绝路径仍为 `criteria_verdict_required` / `criteria_verdict_unknown`;不再有 ReferenceError。
lead 的 `test/kernel.test.mjs:4919`【判据修订门】块是真的(含 `try/catch` + 「成功路径不得抛」断言)。

## ② 两处 null-cwd —— **命名两处已修;还有第三个同类点仍在**

| 场景(无 sessions 服务) | 结果 |
|---|---|
| `SetGoal`(precommitRecon 缺省开) | `goal_set`,不抛 ✓ |
| `AdvancePlan`(observations 为空) | 干净 `evidence_l1` —— 证明 `admission` 的守卫真的生效 ✓ |
| `RegisterTerm` / `CreatePlan` / `CheckPlan` / `QueryKnowledge` / `WorldlineStatus` / `FileHistory` / `ClosePlan` | 全部不抛 ✓ |
| **`AdvancePlan`(带 observations)** | **仍抛**:`TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type string. Received null` @ **kernel.js:4560** |

- 位置:`preset/plugins/clearai-kernel.js:4560` `const absolute = isAbsolute(ref) ? ref : resolvePath(cwd, ref)`
  —— AdvancePlan 的观测登记循环;同一个 `cwd === null` 还会喂给 4568 的 `sha256File(absolute)`。
- 触发:会话服务瞬态不可用(`sessionCwd()` 返 null,A5 正是为此而设)时调用带 `observations` 的 `AdvancePlan`。
- 后果:工具抛错,`observation/recorded` 等这一批变更随栈帧一起消失(与 D1 同一个易失载体问题)。
- 定性:**本轮 A5 新引入的潜在崩溃**,与 TDZ 同族,且就在 lead 刚改过的那条调用链上。
- 阳性对照:`有 sessions + input/ 有材料 ⇒ 立约前侦察仍派 1 个` —— 守卫没有把正常路径一起关掉 ✓。

## ③ 其他核查

- **没有新引入的其他问题**:全套件绿;跑测试不再产生 `clearai: 交付` 空提交(HEAD 前后一致);
  源码无 tracked 改动;`.gitignore:28-31` 已含 `.tmp-audit/ .tmp-session/ .tmp-impl/ .tmp-verify/`,
  `git ls-files .tmp-verify .tmp-audit` = 0(scratch 已 untrack,文件仍在盘上)。
- **仍未闭合(lead 自认)**:真值表 A2/A3/A6 三条机制 + 「代码→真值表」反向检查;`criteria[]` 的卡/面板
  分节渲染;D11「判据改过就永远注入全文」;非 support 裁决的内联结算路径仍会重派(设计限制)。
- **我的中低项仍在**:`test/kernel.test.mjs:90` 宿主桩只递 `lexicon`,生产(`ui/lib/index.js:853`)递整份
  state ⇒ 契约 §4 与 legacy 接线在内核层零覆盖(判据本身在 `test/domain-language.test.mjs` 有覆盖)。

## 放行结论

**不通过放行**:①已闭合;**②仍有第三个 null-cwd 崩溃点(kernel.js:4560),属高危**,修完即可放行;
其余为已登记的中低项与 lead 自认的未做项,不阻塞但应在交付说明里如实列出。

---

# 第三轮复验 · 放行判定

冻结哈希 **a1f0a06b5e11**(源+测试+真值表工具);`HEAD=b7a89ec` 跑前跑后同一个 hash。
全量 18 套件全绿 0 失败,内核 **801**。`npm run build` 重建 dist 后跑。

## 复验(我的脚本 `.tmp-verify/nocwd3.mjs`,独立于 lead 的探针)

| 检查 | 结果 |
|---|---|
| 无 sessions + `AdvancePlan` 带 observations | **不抛**;`observation/recorded` **真的落账**(`ref=lab/x.txt`,`digest=null`,`bytes=null`) |
| 无 sessions + `WriteMemory` | `memory_cwd_unavailable`(不是异常) |
| 无 sessions + `SaveSkill` | `skill_cwd_unavailable`(不是异常) |
| 有 sessions(阳性对照)+ `AdvancePlan` | `advanced`;observations 带 `digest="sha256:12746fe839cb10a5"`、`bytes=8` |
| 有 sessions + `WriteMemory` | `memory_written`,文件真在 `clear/memory/lessons.md` |
| 有 sessions + `SaveSkill` | `skill_saved`,文件真在 `clear/skills/probe-skill/SKILL.md` |

交叉核对:跑了 lead 的 `.tmp-impl/probe-no-sessions.mjs` 与 `probe-no-sessions2.mjs`,
两者都报「**抛出的工具数:0**」(29 件工具各按最小合法参数调一遍)。

## 有没有新引入的问题

- **无**。细节:`observation/recorded` 的 `digest: null` 没有消费者会崩——`ui/lib/client.js` 根本不引用
  `digest`;fold 只做透传(fold.js:727 等)。
- 两个新 fail code(`memory_cwd_unavailable` / `skill_cwd_unavailable`)没有进 `GLOSSARY`/`LOCALE_*`,
  但既有 fail code(`card_persist_failed` / `host_unavailable` / `audit_pending` / `scout_unavailable`)
  同样没进——这是既有惯例,不是本轮新偏差。
- scratch 仍 untrack(`.gitignore:28-31`),`git status` 无 tracked 改动,跑测试不产生新提交。

## 放行结论:**通过**

三处 null-cwd 崩溃点全部闭合,降级语义诚实(落账 + 读数缺失为 null / 如实返回 `*_cwd_unavailable`),
阳性对照未被过度抑制,全量无新红。

遗留清单(不阻塞放行,应在交付说明里如实列出):
1. 真值表还差 A2 独立落账通道 / A3 digest 复用 / A6 hostHealth 三条机制的登记,以及「代码→真值表」的反向检查;
2. `criteria[]` / `criteria_note` 尚未在卡与面板分节渲染(参数与折法已就位);
3. D11「判据改过就永远注入全文」未改(现在可达);
4. 非 support 裁决的内联结算路径仍会重派评估者(设计限制);
5. `test/kernel.test.mjs:90` 宿主桩只递 `lexicon`(生产递整份 state)⇒ 契约 §4 与 legacy 接线在内核层零覆盖;
6. `ui/lib/knowledge-view.js` 三处注释仍写 `options.now`(时钟已删,注释过期)。
