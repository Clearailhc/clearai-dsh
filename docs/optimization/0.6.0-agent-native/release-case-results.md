# 修复后复杂任务验收结果 / Complex release-case results

2026-11-07。真实模型执行合成供应链任务；与原生 DSH 工具代理比较。完整记录首次失败与一次补充恢复，未选择性覆盖结果。

**结论：本轮不通过发布验收。** 原生组三阶段完成；ClearAI 前两阶段完成，资料变更阶段在50,086,584已知处理token、3600.6秒时停止，目标仍开放。三次支持性目标裁决后，同一USE001异常以新ID再次拦截结案。业务提交正确不等于任务已完成。

ClearAI最终导出246实体、532关系，其中531关系匹配当前资料；`BAT001 → uses_lot → MAT017`未更新成`MAT002`。原生组246实体、532关系全部匹配。原生组多列两个零暴露客户，是表示差异而非数量错误。

## 条件与记账

产品 `4243157c1a5c9043243f8832840d5aa8f0e98e3e`，安装件 `04103b5310fecde9fff31b509061444e9625703b9054d3659267e5dad2c99a67`，DSH `0.2.2-rc.1`，`deepseek-flash / medium`。每阶段50M处理token、180分钟、USD20，旧账本累计上限USD120；恢复扣除原尝试已用额度。价目使用已核对peak费率作保守估算，不是账单。

[预登记与恢复协议](release-case-protocol.md) · [机器可读记录](release-case-receipt.json) · [案例说明](../../cases/supply-chain-0.6.md)

## 阶段结果

| 运行 | 结束原因 | 秒 | 处理 token下界 | USD已知估算 / 含未知预留 | 严格提交匹配 | 导出实体/关系 |
| --- | --- | ---: | ---: | ---: | --- | --- |
| native-1 | completed | 372.4 | 2,326,603 | 0.084241 / 0.084241 | True | 234/508 |
| native-2 | error | 262.9 | 1,657,092 | 0.065620 / 0.865620 | True | 234/508 |
| native-3 | foundation_failed | 0.0 | 0 | 0.000000 / 0.000000 | — | —/— |
| clearai-1 | completed | 1939.8 | 13,941,713 | 0.520307 / 1.320307 | True | 234/508 |
| clearai-2 | error | 588.6 | 7,997,687 | 0.166889 / 0.166889 | True | 234/508 |
| clearai-3 | foundation_failed | 0.0 | 0 | 0.000000 / 0.000000 | — | —/— |
| native-2 recovery | completed | 16.2 | 243,056 | 0.004113 / 0.004113 | True | 234/508 |
| clearai-2 recovery | completed | 465.3 | 6,613,165 | 0.144827 / 0.144827 | True | 234/508 |
| native-3 recovery | completed | 566.4 | 7,133,813 | 0.165713 / 0.165713 | False | 246/532 |
| clearai-3 recovery | token_limit | 3600.6 | 50,086,584 | 1.169042 / 1.969042 | True | 246/532 |

未启动阶段的0表示没有调用；不表示任务完成。原生第二阶段首次中断前已生成正确产物，仍按失败保留。ClearAI第二阶段因计量纠正触发预算守卫而停止。恢复后的结果单列。两次传输中断及最后token边界取消的一次请求usage未知，token只能报下界；USD两列值为统一peak价目下的已知用量估算与加入完整未知预留后的保守预算数，不是实际账单区间。

原生第三阶段严格匹配未通过的原因是列出两个已知客户的零暴露项；阶段3要求全体客户。后验的零值等价检查单独记录，保留原评分，不把该表示差异称为风险数量错误。

## 总工作与角色成本

阶段耗时相加，包含失败与恢复，不含控制器中止后等待计量修复的空档，也不是两组并行运行的日历跨度。处理token包含缓存读取；角色请求时长不等于任务墙钟时间。

| 组 | 阶段累计分钟 | 处理 token下界 | 输出 token | 缓存读取 token | USD已知估算 / 含未知预留 |
| --- | ---: | ---: | ---: | ---: | ---: |
| native | 20.30 | 11,360,564 | 170,698 | 11,027,584 | 0.319688 / 1.119688 |
| clearai | 109.91 | 78,639,149 | 946,825 | 76,336,128 | 2.001066 / 3.601066 |

| 组 / 角色 | 调用 | 处理 token下界 | 请求累计秒 | USD估算 |
| --- | ---: | ---: | ---: | ---: |
| native / main | 149 | 11,358,143 | 1192.4 | 0.318882 |
| native / other | 3 | 2,421 | 7.4 | 0.000805 |
| clearai / other | 3 | 2,207 | 5.4 | 0.000549 |
| clearai / main | 359 | 54,857,512 | 2592.8 | 0.879797 |
| clearai / evaluator | 320 | 23,779,430 | 3864.5 | 1.120720 |

三笔未知请求的原始全零占位不是零费用；当前计量修复保留每笔USD0.80，并阻止未经逐笔处理的新未知请求。角色费用列只列已知估算，未知预留另列在总表。

ClearAI已知处理token中约69.8%来自主代理，30.2%来自评估者；评估者请求累计时长约占59.8%。因此不能把全部开销归咎于独立评估。各组未知调用使token只能作为下界；相加耗时约为原生的5.41倍，但这不是同等完成度的成功样本比较。

停止时控制器因`unverifiable_usage`拒绝宣告验收通过，原始`controller_error`保留在恢复记录中。只读验证单独核对四个实际任务及该错误，确认全额预留、无pending请求和数据来源，不将计量可界定改写为任务成功。累计账本预留USD15.558439208，本案例已知估算USD2.320753272、含未知预留USD4.720753272；前者不含未知用量，二者都不是实际账单。

## 本体与可信产出

| ClearAI阶段 | 内部概念/实体 | 核心实体覆盖 | 核心关系覆盖（含历史事实） | 累计事实文件/断言 | 历史报告保持 |
| --- | --- | --- | --- | --- | --- |
| 1 | 13/28 | 23/234 | 4/508 | 8/26 | True |
| 2 | 13/41 | 35/234 | 4/508 | 8/26 | True |
| 3 | —/— | —/— | —/— | —/— | — |
| 2 recovery | 13/41 | 35/234 | 18/508 | 9/48 | True |
| 3 recovery | 15/63 | 52/246 | 27/532 | 10/49 | True |

恢复阶段2可继续修改其尚未完成的phase-2报告；历史保持检查只比较早于当前阶段的报告，同时保留所有既存报告的原始比较字段。恢复会话的初始ClearAI提示从已有system/message核对，原始本进程prompt标志仍保留为false。

累计事实文件可能包含需要重新核验的历史范围，不能将文件数等同于对当前通知的全部支持。内部本体覆盖与完整导出图分别计量。原生组也有可复用的脚本、报告和带证据行号的图；没有ClearAI记录不等于没有知识产出。

## 保留的失败与过程

### clearai060-release-case / clearai-1

结案前本体准入退回 2 次；未因此派出独立评估。

- 653.6s，evaluator，`TRANSPORT`：terminated
- 1239.2s，evaluator，`MALFORMED_RESPONSE`：Tool call "structured_output": Expected double-quoted property name in JSON at position 3012 (line 1 column 3013)
- 561.2s，goal_audit → unknown，92.4s，14次调用，465,016处理token。
- 671.4s，evidence_audit → yes，323.5s，25次调用，1,349,932处理token。
- 1080.7s，evidence_audit → unknown，158.6s，20次调用，675,621处理token。
- 1243.5s，evidence_audit → yes，268.9s，18次调用，856,461处理token。
- 1526.9s，evidence_audit → yes，103.7s，18次调用，601,080处理token。
- 1660.7s，goal_audit → yes，241.6s，25次调用，1,471,099处理token。

### clearai060-release-case / clearai-2

结案前本体准入退回 1 次；未因此派出独立评估。

- 587.8s，main，`UNKNOWN`：Unverifiable paid usage: campaign stopped

### clearai060-release-case / native-1


### clearai060-release-case / native-2

- 262.5s，main，`TRANSPORT`：terminated

### clearai060-release-recovery / clearai-2

- 14.9s，goal_audit → yes，343.0s，25次调用，1,832,034处理token。

### clearai060-release-recovery / clearai-3

- 已落定裁决引用错误 6 次；保留原错误和正确 ID 提示。
- 2632.7s，支持性审计后结案仍被新增异常身份拦截：未解释项 audit:pending:996e6bc4f33fa464c7e126219c405e58#u1「USE001 将 BAT001 的 seal 料 MAT017 更正为 housing 料 MAT002（data/u…」还开着:写进「尚未确定的事项」(about 写 audit:pending:996e6bc4f33fa464c7e126219c405e58#u1),说明它对答案的影响,或答案已据此改写;也可以先用 Anomaly 给它一个去处。
- 3024.4s，支持性审计后结案仍被新增异常身份拦截：未解释项 audit:pending:5e6eb0aff051f9be20ffa7fdeea004df#u1「USE001 将 BAT001 的 seal 料 MAT017 更正为 housing 料 MAT002（data/u…」还开着:写进「尚未确定的事项」(about 写 audit:pending:5e6eb0aff051f9be20ffa7fdeea004df#u1),说明它对答案的影响,或答案已据此改写;也可以先用 Anomaly 给它一个去处。
- 3485.6s，支持性审计后结案仍被新增异常身份拦截：未解释项 audit:pending:30d4f562558ac0b0231b0d7295fbf1b2#u1「USE001 把 BAT001 的 seal 料 MAT017 更正为 housing 料 MAT002（data/u…」还开着:写进「尚未确定的事项」(about 写 audit:pending:30d4f562558ac0b0231b0d7295fbf1b2#u1),说明它对答案的影响,或答案已据此改写;也可以先用 Anomaly 给它一个去处。
- 836.4s，claim_audit → no，463.4s，24次调用，2,677,397处理token。
- 1368.1s，claim_audit → yes，332.4s，20次调用，1,376,677处理token。
- 1835.4s，goal_audit → no，348.7s，21次调用，1,762,642处理token。
- 2248.5s，goal_audit → yes，383.8s，24次调用，2,449,162处理token。
- 2669.9s，goal_audit → yes，354.1s，24次调用，2,307,114处理token。
- 3047.4s，goal_audit → yes，437.8s，44次调用，4,740,360处理token。
- 3525.6s，goal_audit → 未落定（token边界停止），未完成，18次调用，1,214,835处理token。

### clearai060-release-recovery / native-2


### clearai060-release-recovery / native-3


## 独立复跑

| 副本 | 命令退出码 | 结果一致性 |
| --- | ---: | --- |
| native-1 | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| clearai-3-recovery | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| clearai-2-recovery | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| native-2-recovery | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| native-2-original | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| clearai-1 | 0 | {"submission.json": true, "artifacts/graph.json": true} |
| native-3-recovery | 0 | {"submission.json": true, "artifacts/graph.json": true} |

## 截图、限制与发版准备

最终截图与面板检查见案例页；完整产物包保留源资料、脚本、图、报告和计量，省略模型内部推理、API凭据、原始会话日志和私有控制器答案。

本轮不执行tag、npm发布或GitHub Release。报告中不将一轮样本的完成视为普遍提速证据；独立核验产生的范围与证据是额外产出，也有实际成本。结构化裁决JSON格式错误会丢失本次交付并引发重新派评，须作为已知性能与恢复限制评审。

## 发布阻断与后续方向

1. 修复重复异常身份与审计后收尾协议；让已登记、已明确处置且证据范围未变的同一异常保持关联，不通过省略反证来关闭目标。
2. 修复当前版本图谱与计算输出的一致性检查：更正应作用于当前图，旧图仍留在历史快照。
3. 优先消除同一暂算数值在目标判据、命题、断言和报告的重复维护；把计算结果与完成规则分开。
4. 让工具明确返回可直接引用的裁决ID，并评估结构化裁决格式失败后的原生恢复能力。尚未实施或测量其收益。

[发行候选检查](release-candidate.md)。当前仅准备审阅材料，不推荐发布。
