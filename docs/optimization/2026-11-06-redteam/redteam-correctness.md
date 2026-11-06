# ClearAI 正确性红队审查

日期：2026-11-06。对象：当前 clearai-dsh 0.5.7 源码；兼容性修复由主任务独立处理。本审查未修改受版本控制文件，未调用付费模型。探针使用仓库现有 makeHost 测试宿主和生产内核代码，临时文件只落在一次性目录。以下属于实现级验证，不等同于完整真实 DSH 沙箱攻击演练。

## P1：受保护事实/评估卡路径可以经普通 shell 工具改写

**实际复现。** `tools/pre-execute` 拒绝 `echo '{}' > clear/evidence/forged.json`，却放行并实际完成以下三种等价写入：

- `python3 -c "open('clear/evidence/forged.json','w').write('{}')"`
- `node -e "require('fs').writeFileSync('clear/evidence/forged.json','{}')"`
- `p=clear; echo '{}' > "$p/evidence/forged.json"`

前者控制组为 `deny / written:false`；后三项均为 `allow / written:true`。目标是测试新建工作区，不是用户的实际证据。

**位置：** `preset/plugins/clearai-kernel.js:5095` 的 `WRITE_HINT` 白名单不包含 Python/Node 文件 API；`:5096` 的 `shellTouchesProtected` 要先匹配写操作，再依赖命令原文包含路径；`:5238` 将该结果作为 shell 写保护的判断。变量展开、脚本调用也不受这类文本扫描约束。`test/authority-boundary.test.mjs` 当前用正则证明有 deny/protected 字样，不能证明写保护不可绕过。

**影响边界：** 已证明普通工作者可以写入系统宣称独占的评估卡目录；相同规则覆盖 facts/lessons/negatives/goals。不能据此直接声称会话投影中的权威变更已被伪造；内存/日志通道与普通文件仍不同。但“评估卡和事实文件只有系统能写”的主张不成立，且后续人或评估者读取的文件材料可被替换。

**复现：** `node docs/optimization/2026-11-06-redteam/repro-authority.mjs`。脚本复用现有测试宿主的 before-tool hook，对被放行命令在一次性目录实际执行并检查文件存在。

**建议：** 将权威输出放在工作者无法写的存储/OS 权限隔离区域，或让只读挂载由工具执行器统一强制；若暂时保留提示性 deny 规则，明确它不是安全/权威隔离保证。加入 Python、Node、变量路径及符号链接行为测试，而不只是新增若干关键字。

## P1/P2：绝对路径产物内容已改动，系统仍复用旧评估结果

**实际完整内核复现（测试宿主）。** 建立包含工作区内部绝对路径 `result.txt` 的 L3 步骤。首次内容为 WRONG，独立评估桩返回 no。将同一文件改为 VALID，并配置下一次评估桩返回 yes；再次 AdvancePlan 得到旧的 no，评估者调用次数仍是 1，返回文案明确显示复用。

输出：

```text
frame goal_set
plan plan_created
first delivery_not_holding audits 1
second delivery_not_holding audits 1 reuse true
```

**位置与机制：**

- `preset/plugins/clearai-kernel.js:781` 的 admission 接受绝对路径并读取文件；CreatePlan `:4258` 直接保留 artifacts，schema 中的“相对路径”文字不是校验。
- `preset/plugins/audit-material.js:18` 对任何绝对路径固定返回 `unavailable`；`:58` 将该固定值用于材料摘要，未绑定 gate.confirmed 中 admission 算出的内容 digest。
- `preset/plugins/clearai-kernel.js:1738` 附近按照摘要复用旧裁决；因此改文件不能使该缓存失效。

**对照探针：** `docs/optimization/2026-11-06-redteam/repro-digest.mjs` 对同一内容变更，以相对路径引用时 digest changed=true，绝对路径时 changed=false。`docs/optimization/2026-11-06-redteam/repro-cache.mjs` 则通过真实内核 CreatePlan/AdvancePlan 路径证明实际错误复用，而非只测工具函数。

**影响：** 本次已证明修正产物后旧拒绝仍被沿用，可造成反复受阻。相同摘要缺失也影响评估期间内容变更的绑定；接受错误结果的端到端场景本次未复现，不把它记作已证明。核心“材料变化就重新核验”的主张存在输入路径例外。优先级建议 P1（若视为评估有效性边界），最低也应 P2（正常绝对路径用法造成错误缓存）。

**建议：** 在计划入口统一规范化工作区内路径、拒绝越界路径，并让 admission/hash/reuse 对同一 canonical path 达成一致；绝对路径属于工作区内时可转相对路径。不可用/不可哈希的材料不应支持裁决缓存复用。添加绝对路径修改后的重新派发回归测试。

## 已检查但未报告为已证实缺陷

- 内核 `sha256File` 对 >8 MiB 文件返回 size 标记；但正常相对路径的 `audit-material.js:fileDigest` 仍进行完整 SHA-256，因此不能单凭这个分支断言所有大文件可绕过审计材料变更检查。
- `runEvaluator` 用 session/kind/step 串行化，并在等待后检查原生目标 revision/phase 与新材料摘要；没有在本次有限审查中复现并发重复推进。该结果不是并发安全性证明。
- 恢复路径检查结构化裁决和终止状态；仓库有针对回放、恢复及审计指纹的测试。本次没有尝试伪造真实 DSH 的日志写入接口，因此不声称攻破该层。
- `rerunCopy` 失败时会降级只读评估（kernel :1874 附近）；因此“独立评估”不自动意味着独立重跑。此为已读到的行为，是否符合产品主张需要结合 claims 审查，不额外重复记为已证实正确性 bug。

## 综合判断

该实现对一般错误路径和恢复有大量守卫，但其“不可表达/只有系统能写”的强主张超过了 shell 文件边界实际提供的保证。材料摘要机制在正常相对路径下较完整，但计划入口接受的路径范围与摘要支持范围不一致，造成了可复现的错误复用。应先修复这两类边界，再把测试通过数作为结构可信性的辅助证据。
