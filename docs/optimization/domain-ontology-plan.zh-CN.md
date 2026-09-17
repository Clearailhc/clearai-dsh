# 领域本体与类型化事实：落盘开发计划

> 这是**已批准的执行计划**，也是后续所有 `0.2.0` 工作的依据。
> 概念与设计见 [`domain-ontology.zh-CN.md`](../domain-ontology.zh-CN.md)；每阶段结束后**在本文件对应分节里追加一行**「完成项 / 跑过的命令 / 实际输出 / 阻塞点」——不另立第二份进度台账。
> 英文版见 [`domain-ontology-plan.md`](domain-ontology-plan.md)。

## 0. 目标与成功标准

1. 一个项目里可以建立**领域本体图**：概念是节点、谓词是带域/值域的有向边，值形态与约束可校验。
2. 事实获得**内容形态**：`fact = 断言 + 认识论元数据`；纯文本、公式、代码、数值、引用是断言的五种值形态，不是五种事实。
3. 事实与假设按 **id** 关联（修掉今天按 `text` 字符串相等匹配的脆弱点）。
4. 图可以**渲染**（Markdown + Mermaid 货架、**「事实」格里的图带**：本体图 / 实体图）并且**可编辑**——编辑一律落成**具名治理动词**，图编辑不写文件、不产生布局事件。
5. 本体的增删改只有三种语义：**带依据注册 / 版修订（语义变化换 id）/ 黏性废止（无删除）**。
6. 冲突**机械派生**：同一单值谓词、同一主体、不同客体且两侧都未撤回时，投影给出冲突对；**只暴露，绝不自动裁决或自动撤回**。
7. 所有读面（货架 / 面板 / 运行卡 / 图）来自**同一个 fold 投影**，没有第二本账；旧账本（无本体事件、无断言）重放结果不变。
8. `npm test`（新增 1 套，共 15 套）、`npm run build`、`npm run verify`、`npm run verify:install` 全绿，端到端剧本含图编辑链。

## 1. 已核实的关键代码事实（计划基线）

以下为**代码事实**（`0.1.7` 时点；行号会随改动漂移，符号名是权威），后续对齐以它们为准：

| 事实 | 位置 |
|---|---|
| 投影状态版本 `STATE_VERSION = 9` | `ui/lib/fold.js:40` |
| 事实升格折叠：`case 'fact/promoted'` 写入 `facts[]`（`text/scope/level/evidence/path`） | `ui/lib/fold.js:474` |
| **假设与事实按文本相等匹配**：`fact.text === mutation.claim` | `ui/lib/fold.js:293` |
| 本体声明是**数据**：九个对象 + 五级，装配期 `validateOntology`，渲染 `describeOntology` | `preset/plugins/ontology.js` |
| 模型工具目录由 `defineTool` 定义，`SetGoal` / `CloseGoal` 在此 | `preset/plugins/clearai-kernel.js:2676` / `:2786` |
| 事实升格发生在 `CloseGoal`：`t: 'fact/promoted'` 只带 `goal/text/scope/level/evidence/path` | `clearai-kernel.js:2908` |
| 事实货架渲染 `renderFactsIndex` / 写盘 `ensureFactsShelf`：`clear/knowledge/facts/INDEX.md` | `clearai-kernel.js:2556` / `:2589` |
| 过程本体货架 `ensureOntologyShelf`：`clear/ontology/verification-loop.md` | `clearai-kernel.js:2617` |
| 系统所有路径拒写清单（模型不能写 `clear/evidence`、`clear/knowledge/facts`、`clear/goals`） | `clearai-kernel.js:5847` |
| 宿主 HTTP 面走 `connection.fetch.register`：`/api/clearai/gate`（人签名的账本入口） | `ui/lib/index.js:367` |
| 只读读面：`/api/clearai/deliverables`、`/api/clearai/brain` | `ui/lib/index.js:502` / `:574` |
| 客户端页签类型注册契约 `sidebarRightTabs.register({id, kind, title, guide})`；注入 `slots/sessions/sidebarRightTabs/sidebarRight` | `ui/lib/client.js:2895` / `:119` |
| 提示词共 **23 段**，`prompt-sections` 套件按 hard/native/advisory 分类钉死 | `preset/plugins/prompts.js`、`test/prompt-sections.test.mjs` |
| 测试共 **15 套**，清单在 `test/run.sh` | `test/run.sh` |

## 2. 设计原则

- **第一性原理**：循环管「凭什么信」，本体管「用什么语言说」。凡是能被算出来的（状态、进度、冲突、布局）就不要被说出来或存起来。
- **奥卡姆剃刀**：不为不存在的消费方引入机制。不做 OWL/RDF/SHACL/SPARQL、图数据库、推理机、实体消解；不建 `Proposal/Review` 状态机（本版没有批量归纳）。
- **图是投影，不是存储**：本体图与实体图都由 `fold` 算出；布局是确定性纯函数，不进账本。
- **不可表达优于不可违反**：本体只能经具名动词落账；模型与 UI 都结构上写不进 `clear/ontology/`。
- **没有删除，只有版本化修订与黏性废止**；语义变化必须换 id，稳定 id 的含义不许在历史上漂移。
- **宽松+校验**：断言可选；不提供放行，提供即严校（未知谓词/术语、类型不合域、客体形态不合法、同一事实自冲突一律拒收）。
- **每阶段独立可验证**：每阶段结束 `npm test` 必须绿；行为变更与清理变更分开提交，逐段可回滚。

## 3. 阶段与交付物

### 阶段 A：概念与模型定稿（文档先行）

**交付物**

- `docs/domain-ontology.zh-CN.md` / `docs/domain-ontology.md`（已落盘）
- 本计划（`docs/optimization/domain-ontology-plan.zh-CN.md` / `.md`）
- 事件词汇表、断言 JSON 结构、`graphProjection` 契约（写进设计文档）

**验收**

- 能用中文案例完整讲清「概念 / 谓词 / 断言 / 事实 / 本体图 / 实体图」的区别；
- 明确「过程本体是后台流转本体：不进账本、不可运行时编辑、只以状态形状出现」。

**回滚**：纯文档，删除即可。

### 阶段 B：纯函数与 fold（不改运行行为）

**交付物**

- 新模块（内核与客户端共享的纯函数）：值形态枚举、术语/谓词/断言校验、域与值域检查、`is_a` 环检测、确定性布局、`graphProjection`、`lexiconHealth`；
- `ui/lib/fold.js`：六类本体事件折叠 → `state.lexicon`；`fact/promoted` 增 `hypothesis` 与 `assertions`；假设↔事实改为按 id 关联；`conflicts` 派生；`STATE_VERSION` 9 → 10；
  （`state.ontology` 这一格**已经被占用**：它是过程本体的形状。领域词汇另起 `state.lexicon`，两个字段两种权威。）
- `test/domain-language.test.mjs`（新套件）并在 `test/run.sh` 增行。

**验收**

- `node test/domain-language.test.mjs` 绿：id 唯一、引用存在、值形态枚举、`is_a` 无环、废止条目不可新引用、语义修订必须换 id、五种值形态各自的校验、同一事实自洽；
- 同一账本重放得到同一图数据与同一默认布局；
- 旧账本（无本体事件、无断言）折叠结果**逐字段不变**；
- `npm test` 全绿（此时内核尚未接新动词）。

**回滚**：revert 该阶段提交；`STATE_VERSION` 回 9，旧账本不受影响。

**进度 · 已完成**

完成项:

- `ui/lib/domain-language.js`（新）：值形态与对象形态枚举、`applyLexiconMutation`、`validateTerm` / `validatePredicate` / `validateAssertion(s)`、`objectKey` / `subjectKey`、`deriveConflicts`、`lexiconHealth`、`graphProjection`（含确定性布局与包围盒）、`formatAssertion` / `formatObject`；
- `ui/lib/fold.js`：`STATE_VERSION` 9 → 10；`emptyState().lexicon`；六类本体事件折进 `state.lexicon`；`fact/promoted` 增 `hypothesis` 与 `assertions`；假设↔事实改按 id 关联（旧账本仍按文本）；`derive()` 增 `lexicon` / `conflicts` / `lexiconIssues`；`view()` 增 `lexicon`（含图投影）；运行态卡增词汇与冲突两行；
- `tools/build-package.mjs`：把 `domain-language.js` 拷进包（漏了它，包里的 fold 会在 import 那一刻报模块找不到）；
- `test/domain-language.test.mjs`（新，92 条断言）与 `test/run.sh` 的「领域语言」一列；
- `docs/optimization/state-machines.{zh-CN,md}`：新增 §12 领域词汇（六个事件 + 状态图 + 四条要点），事件覆盖表补六行；
- 套件计数 14 → 15（README 中英 · dsh-integration 中英 · release-verification）。

验证:

```text
$ node test/domain-language.test.mjs                     → 92 通过,0 失败
$ node test/state-machine.test.mjs                       → 43 通过,0 失败
$ node test/docs-consistency.test.mjs                    → 13 通过,0 失败
$ node tools/build-package.mjs
$ npm_config_cache=… node tools/verify-package.mjs       → 32 通过,0 失败 · 发行物 157 个文件
$ DSH_HOME=<临时 home + 构建产物> bash test/run.sh
  第 1 遍 · 内核:686 · 宿主:89 · 外脑:40 · 客户端:200 · 领域语言:92 · 本体:96 · 真值表:24 ·
  状态机:43 · 文档:13 · 注释:7 · 边界:14 · 组合:20 · 段:13 · 长测:41 · 不变量:27 → 全绿(1 遍)
```

备注（三条，都是本阶段真实撞到的事）:

- **`state.ontology` 已经被占用**：它是过程本体随投影下发的形状（见设计文档 §2.2），所以领域词汇另起 `state.lexicon`——两个字段、两种权威。计划原稿写的 `state.ontology` 已就地更正。
- **交叉校验的正则抓不到带连字符的事件名**：两套旧测试用 `[a-z_]+` 抓事件名；若事件名写成 `ontology/term-added`，声明侧与文档侧会**同时**抓不到，于是「声明了却没人查」静默成立。已改为与全仓一致的 snake_case（`ontology/term_added`），并在新套件里加一条判据钉住这条命名。
- **本机部署尚未同步（不是本阶段的缺陷）**：宿主/客户端两套跑的是**部署产物**，而 `~/.dsh` 里当前装的是 0.1.7 的包。本阶段用「构建产物 + 临时 `DSH_HOME`」验证；要就地让 `npm test` 全绿，需按产品形态重装：`node tools/build-package.mjs && node tools/install-native.mjs --profile web`（会改本机 profile，未擅自执行）。


### 阶段 C：内核治理动作

**交付物**

- 新工具：`RegisterTerm`、`RegisterPredicate`、`ReviseTerm`、`RevisePredicate`、`DeprecateTerm`、`DeprecatePredicate`、`QueryKnowledge`；
- `SetGoal` 假设支持可选 `assertions`（提供即校验）；`CloseGoal` 升格时携带 `hypothesis` id 与 `assertions`；
- 冲突派生接入卡片与投影（只提示，不裁决）；
- `clear/ontology/` 进入系统所有拒写清单（模型路线）；
- `ensureOntologyShelf()` 扩为渲染领域本体 Markdown + Mermaid 读面。

**验收**

- 工具正反例齐全：未知谓词、未知/已废止术语、类型不合域、客体形态非法、同一事实自冲突一律拒；
- 升格后事实带 `hypothesis` id 与断言；
- 未提供断言的假设照常升格（宽松+校验）；
- 两条相互冲突的事实同时存在时，投影给出冲突对，且**两侧事实都没被自动改动**；
- 模型路线直写 `clear/ontology/` 被拒。

**回滚**：revert 该阶段提交；新事件不再产生，`state.lexicon` 为空表，其余机制不受影响。

**进度 · 已完成**

完成项:

- 宿主半 facade 增 `domain`:`validateTerm` / `validatePredicate` / `validateAssertions` / `renderShelf(sessionId, mutations)` / `format`
  ——**判据只有一份**(`ui/lib/domain-language.js`),预设侧经这道门调用它,不复制规则。
- 七个具名动词(`preset/plugins/clearai-kernel.js`):`RegisterTerm` / `RegisterPredicate` / `ReviseTerm` /
  `RevisePredicate` / `DeprecateTerm` / `DeprecatePredicate` / `QueryKnowledge`;`MECHANISM_TOOLS` 增 `ontology` 一格
  (22 → 29 件工具,装配期仍由目录与 `defineTool` 双向核对)。
- `SetGoal` 的假设可带 `assertions`(提供即严校:引用存在、形态合域、同一事实自洽,一律落账之前拒);
  `CloseGoal` 升格带 `hypothesis` id 与 `assertions`——**身份与内容一起定型**。
- 折法补一处:`goal/set` 的假设携带 `assertions`(否则升格那一刻拿不到)。
- 货架:`ensureDomainShelf` 渲染 `clear/ontology/domain.md`(概念 / 谓词 / Mermaid 图 / 引用统计 / 废止 / 冲突),
  每个动词落账后重铺、pre-step 也重铺一次(幂等);`clear/ontology/` 进拒写清单。
- 提示词:新增 `clearai/domain-language`(hard;24 段定义 / 23 段在场)。
- 测试:kernel 增 32 条(动词正反例、断言链、冲突只暴露不裁决、货架、拒写、查询);真值表两条从设计目标转已实现
  (`ontology-verbs` / `assertion-validation`)。

验证:

```text
$ node test/kernel.test.mjs                          → 718 通过,0 失败
$ node tools/verify-truth-table.mjs                  → 25 项全过(64 条机制;代码快照 7 机制 / 29 工具 / 23 段在场)
$ DSH_HOME=<临时 home + 构建产物> bash test/run.sh    → 15 套全绿
```

备注:

- 门不在时(宿主半缺 `domain`)七个动词**明确拒**(`domain_unavailable`),不抛 TypeError——
  真实原因不该被伪装成参数错误。
- 量纲换算与公式语义仍不做;断言校验只到**形状**(见已知缺口的「只验到写明的深度」)。
- 面板「本体」与图编辑留给阶段 D–E:今天词汇与图只有货架与卡片两行读数。


### 阶段 D：本体融进「事实」格（图带 + 索引 + 芯片）

> **设计定案见[领域本体 §9](../domain-ontology.zh-CN.md)**：本体不占独立页签，长进中栏「事实」格。
> 一页的排布、六条「不爆炸」契约、两张图的默认与切换都在那一节里。

**交付物**

- 「事实」格（中栏 `conversation.view`，**不新增页签/视图**）顶部的**图带**：本体图 ｜ 实体图 切换（~200px，缩放平移，`⤢` 全景放大并解除节点截断、带「适配」），**点节点 = 按概念过滤**下方货架；
- 冲突：一行指针（仅当有冲突）+ **受害事实行的内联冲突标记**；
- 事实 / 命题行的**断言芯片**：点开**就地**展开词条卡（释义 / 依据 / 主词域 / 值域 / 单值 / 引用数；动作：筛选此概念、在图里看）；
- 折叠的**词汇维护区**（词条表 / 健康度 / 废止 / 「在货架里打开」；0 事实 0 命题而有词条时自动展开）；
- 过滤状态行（N/M + 清除）；
- 投影补断言字段（`view().facts[].assertions`、`view().goal.hypotheses[].assertions`）。

**验收**

- **零成本契约**：没有词条时这一格与从前逐像素相同（用投影空词汇的快照钉住）；
- 同一账本在 Markdown 货架、运行态卡、图带显示**同一组节点 / 边 / 状态**；
- 点节点过滤后 N/M 行说真话，`✕` 一键清除；
- 断言芯片**就地**展开、不跨格跳转；
- 废止条目在图上是虚线幽灵、在维护区带缘由；
- 双语 locale 键齐。

**回滚**：revert 该阶段提交；「事实」格回到只有两个货架的样子（图带与芯片都是加法）。
**进度 · 已完成（面板侧）**

完成项:

- 投影补 `chip`(断言一行人话,由 `formatAssertion` 在投影侧算好,客户端只渲染);
- 「本体」格组装:冲突行(仅当有)→ 图带 → 过滤状态行 → 本体货架 → 在验命题 → 折叠的词汇维护区;
  零成本契约(无词条时与从前同形)由测试钉住;
- **图带**:本体图|实体图切换、滚轮缩放、拖拽平移、「复位」「全景」(全景解除 40 节点截断);
  点概念/实例节点 = 按概念过滤;边点击出一行详情;冲突边红色;
- **断言芯片**:事实行与命题行各带芯片(命题标「未升格」),点开**就地**展开词条卡
  (释义/主词域/值域/单值/依据;动作:按此谓词过滤、在图里看);
- **冲突**:一行指针 + 受害条目内联标记;
- **过滤**:断言命中 ∨ 文本/别名命中(判据 `termMatches` 为纯函数,经 `__ontology` 缝导出);
  状态行 N/M 说真话,一键清除;
- **维护区**:词条表/健康度/废止(带缘由)/「打开词汇货架」;0 事实 0 命题而有词条时自动展开;
- locale 双语 ~30 键。

验证:

```text
$ node test/client.test.mjs   → 211 通过,0 失败(新增 11 条本体格断言)
$ bash test/run.sh            → 15 套全绿
```

备注:

- 浏览器里的缩放/平移/全景交互未在真浏览器验证(字符串渲染桩只验结构)——列入阶段 G 走查;
- README 面板截图仍是旧文案,本体格走查后一并重拍(已在 known-gaps 记账)。


### 阶段 E：图编辑与宿主路由

**交付物**

- `POST /api/clearai/ontology`：只接受具名动词白名单，复用内核同一套校验，以 human actor 落账；
- 编辑抽屉：新增概念 / 新增谓词 / 修订 / 废止 + 依据字段；本地草稿 → 应用；
- 应用后自动刷新图与货架。

**验收**

- 一次图编辑可追溯到唯一一条具名事件，署名 human；
- 面板刷新后状态不丢（账本重放得到同样结果）；
- 拖动位置/缩放/筛选**不产生**任何账本事件（权威边界套件钉死）；
- UI 与模型工具对同一非法输入给出同一拒绝理由（同一校验函数）。

**回滚**：revert 路由与客户端编辑面；只读渲染（阶段 D）不受影响。

### 阶段 F：文档、案例与质量检查

> **文档半已提前落地（一次专门的文档清扫）**：设计文档补了「与状态机、流转的联动」一节（§8：三张状态机互不嵌套、四处握手点、读面一览、今天到哪儿了）；
> `state-machines` 补了词汇小节与联动小节、`timing-diagrams` 补了第六条路径（领域本体路径 · 部分实现）、`verification-loop` 补了过程本体/领域本体对照；
> 术语表（22 条）、权威归属（新层四种事实）、灵魂地图（图是投影 / 语义变化换 id）、设计原则（同两条）、认识论循环（边界）、覆盖矩阵、真值表（58 → 64 条机制）全部对齐；
> 同时清掉一批过时表述：`retracted` 的生产者、观测来源、回合收尾（`clearai/turn-ended` 已删）、裁决悬空的剩余风险、真值表里那处 `turn-ended` 残留。
> 另外给这类漂移加了一道机械闸门：`test/docs-consistency.test.mjs` 现在会核对**每一条相对 `.md` 链接都指得到真文件**（本次扫出的那条死链正是它该抓的，并带反例自检）。
> **剩下的是**：案例扩写（physical-experiment 双语补「类型化事实 → 冲突 → 人裁决」一段）、README 版本故事、CHANGELOG。


**交付物**

- 设计文档与计划的双语同步；术语表增「领域本体 / 概念 / 谓词 / 断言 / 值形态 / 实例 / 本体图 / 实体图 / 冲突」；
- `docs/epistemic-loop.*.md`、`docs/design-principles.*.md`、`docs/authority-map.*.md`、`docs/known-gaps.*.md` 同步；
- 真值表新增机制行（接纳 / 修订 / 废止 / 断言校验 / 冲突派生 / 图投影 / 本体路由），各带代码锚点；
- 案例一篇（建议 physical-experiment 双语）：注册概念 → 类型化假设 → 升格 → 图上冲突 → 人裁决；
- `README.md` / `README.zh-CN.md` 文档索引与 `CHANGELOG.md`。

**验收**

- 文档里每一处「已实现」都能指向代码与测试；未实现的全部标为设计目标；
- `npm test` 中 `docs-consistency`、`truth-table`、`state-machine` 三套绿。

**回滚**：文档改动可单独 revert，不影响行为。

### 阶段 G：完整验证与发布

```text
npm test                      # 15 套全绿
npm test 2                    # 连跑两遍
node tools/build-package.mjs
node tools/verify-package.mjs
node tools/verify-clean-install.mjs
node tools/e2e-parallel.mjs
```

真浏览器走查：注册概念与谓词 → 图上编辑 → 提出类型化假设 → 升格 → 实体图 → 冲突 → 撤回 → 刷新。

**发布条件**：上述全绿；构建物与源逐字节一致；干净安装通过；端到端图编辑链通过；已知缺口更新完毕。

## 4. 测试矩阵

| 层 | 套件 | 覆盖 |
|---|---|---|
| 纯函数 | `domain-language`（新） | 值形态、域/值域、`is_a` 环、断言自洽、布局确定性、`graphProjection`、`lexiconHealth` |
| 投影 | `kernel` / `state-machine` | 六类事件折叠、按 id 关联、`conflicts` 派生、旧账本不变、`STATE_VERSION` |
| 内核 | `kernel` | 七个新工具正反例、`SetGoal`/`CloseGoal` 类型化链、冲突只提示 |
| 外脑/客户端 | `client` | 页签注册、双图渲染、幽灵/冲突/截断、互跳、locale |
| 权威 | `authority-boundary` | 模型与 UI 都写不进 `clear/ontology/`；布局不落账 |
| 文档 | `docs-consistency` / `truth-table` / `state-machine` | 新机制行与代码锚点一致；无过时说法 |
| 长测 | `e2e-scenarios` / `invariant` | 类型化事实全程；冲突不自动裁决；重放同图 |

## 5. 风险与回滚点

| 风险 | 处理 |
|---|---|
| 本体成为「第二本账」（有人手改 `domain.json`） | 不设该文件；只读货架为渲染物；权威边界套件钉死 |
| 断言校验过严，卡住升格 | 宽松+校验：断言可选；只在**提供**时严校 |
| 图编辑产生不可追溯的状态 | 编辑只发动词；路由白名单；布局不落账 |
| fold 新事件破坏旧账本 | 新事件为纯增量；旧账本不产生它们；阶段 B 断言逐字段不变 |
| 窄栏图不可用 | 第一版以详情抽屉为准，拖拽连边是后续增强 |
| 冲突被误当成裁决 | 冲突是派生读数；只暴露、不改事实；撤回走既有 `fact/reviewed` |

## 6. 明确不做

OWL/RDF/SHACL/SPARQL 与推理机；图/三元组数据库；自动本体归纳与批量提案；大规模文档抽取与实体消解；复杂规则推理与传递闭包；跨项目或用户级本体库；量纲换算与数值容差；事实自动覆盖/自动撤回/冲突自动裁决；直接编辑权威本体文件；把拖拽连边作为第一版唯一编辑方式。



### 第三场:全链(登记 → 断言 → 交付 → 独立评估 → 升格 → 冲突)——36/0 全绿

模型在**一个回合内**走完整条链(前一场教训:一次性形态交出回合就结束,CloseGoal 必须与
ClosePlan 同回合连续调用)。21 条变更:`term_added · predicate_added · goal/set · plan/* ·
observation/admission/evidence ×2 · audit dispatched+settled · goal/closed · **fact/promoted ×2**`。

- **升格带断言**:两条事实(口径A 10ppm / 口径B 12ppm)都带着完整断言升格,按 id 关联假设。
- **冲突真跑现形**:同一主体 T2、同一单值谓词、两个取值 ⇒ `derive().conflicts = 1 对`,
  运行态卡与本体货架各说一遍,**两侧事实都没被系统动过**——「只暴露,不裁决」在真模型上成立。
- **实体图**:5 节点(概念 + 值形态 + 实例 T2 + 两个字面值 10/12ppm)· 3 边
  (谓词边 + 两条 [L0][live] 断言边)——本体图/实体图两层都在。
- **货架**:`clear/ontology/domain.md` 的使用段写着「已升格事实里 2/2 条带类型化断言;
  冲突 1 对(只暴露,不裁决)」;`clear/knowledge/facts/INDEX.md` 头已是「本体内容」。
- 8 条跨机制不变量全绿;e2e 断言 36/0。
## 7. 与现有计划的关系

本计划接在 [`plan.zh-CN.md`](plan.zh-CN.md)（认识论核心收敛与 Harness 瘦身）之后：那一轮把**循环**立了起来，这一轮给循环的产出**补上形态**。两轮共享同一条纪律——凡能被算出来的，不要被说出来；凡要成为边界的，就落进 schema / 注册表 / 投影 / 测试。
