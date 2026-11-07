# DSH 原生与 ClearAI：供应链追溯、知识沉淀及复用对照

2026-11-07，执行前固定。产品提交 `57c13d5`，官方 DSH `0.2.2-rc.1`，模型 `deepseek-flash / medium`。当前安装包摘要 `a64e472069ea437e75b469cd45cf2e13c4b42fce39b2500aaab0554f19f98211`。

两组均运行在 DSH：原生 default preset 与 ClearAI preset。原生组保留普通工具、子任务、笔记和文件能力，并非纯文本模型。两边收到同样的任务、资料和结构化交换格式，均可保存概念、实体、关系、分析脚本、知识与说明；不强制某种内部知识格式或凑节点数量。ClearAI 内部知识库另行统计，导出图谱不自动视为独立认证。

## 三个阶段

1. 建立供应链质量追溯知识并确定隔离和客户净暴露量：234 个业务实体，508 条主数据关系。资料含六家供应商、两厂四线、六种产品、24 个来料批次、60 个生产批次、120 笔出货、12 家客户，另有退货、返工、通知和非权威现场意见。同名商标不能合并法人、重复出货版本不能重复求和、未批准返工不能放行。
2. 无新证据的新会话：复用已有知识和脚本，按指定客户与产品集合查询风险。保留前一报告。两组都可以读取全部旧资料和自己产物。
3. 变更条件的新会话：通知替换、用料更正、新增包装单位出货及未批准返工；恢复全体客户口径。应更新当前适用性并保留历史，不能把旧行政隔离扩大为供应商永久缺陷。

每组阶段串行，两组并行。若某组前置任务未完成、证据完整性或隔离失败，该组后续阶段明确记为未运行，不用另一轮替换失败。旧会话上下文不传给新会话，工作区文件保留。未开放的材料、对照组、控制器、安装配置和日志通过既有隔离机制禁止读取，先验证探针。

世界由新随机密钥生成并冻结；在任何模型调用前检查非退化条件：阶段 1/3 至少 8 笔风险出货，阶段 2 至少 2 笔，最多生成 100 次。生成尝试数记入 manifest；不按模型结果选择世界。评分依据正式业务规则与冻结数据，控制器私钥不提供给执行者。

## 口径与预算

- 每次会话最多 1,000 万处理 token、180 分钟、估算 $10；累计账本上限 $60，沿用已有约 $7.26660 记账及已接受的 $0.80 历史未知预留，不重置支出。跨主模型、评估者和其他调用统一记账。
- 同题输入、安装件、模型、测试框架源码摘要和所有结果冻结。失败及重试保留，不作质量导向重跑；没有模型盲评附加调用。
- 判定质量：隔离批次、风险出货及净件数、客户汇总是否逐项准确；同时核查时间、通知和单位口径。
- 结构沉淀：实体和类型正确率/覆盖率、关系正确率/覆盖率、重复/悬空引用、来源可定位性；类型定义与独立事实分开统计。
- 可信沉淀：ClearAI 内部本体、实体、断言、事实及裁决来源，未验证内容和范围是否保留。裸 DSH 的自建知识产物照常评价，不因没有 ClearAI 的事实标签记作零价值。
- 实际复用：先前文件引用、脚本执行、后续答案正确性、变更后是否正确拒用旧结论、旧报告是否保留。仅声称“复用了”不算行为证据。
- 成本：分阶段、分角色记录处理/输出 token、缓存、请求数、评估次数、耗时和费用估算。并发会影响墙钟时间；本例单次样本不证明统计优势。

本轮没有冷启动复用消融，阶段难度也不同，因此不能把阶段间耗时下降解释成复用带来的因果节省。结果只说明该典型案例中的完成、质量、沉淀和实际复用情况，不替代跨任务生产验收，也不自动授权发布。

## Infrastructure repair amendment (2026-11-07)

The first ClearAI construction session was blocked because DSH 0.2.2-rc.1 rejects `minItems` in evaluator output schemas. Preserve this attempt and its cost; skip its dependent stages. Commit d1b75ba adapts cardinality into schema descriptions while retaining kernel completeness enforcement, and validates the adapter against the actual official DSH schema validator. After the original campaign settles, run only ClearAI in a fresh workspace against the exact frozen world, tasks and native baseline. Use a separate budget task prefix, retain the failed attempt in the final report, and do not repeat the native baseline. This is an infrastructure repair comparison across explicitly identified product revisions, not a selected best-of run.
