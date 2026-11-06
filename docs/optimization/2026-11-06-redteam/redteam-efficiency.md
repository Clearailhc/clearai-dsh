# ClearAI 效率红队评估

日期：2026-11-06。对象：仓库当前 0.5.7，Node v24.22.1；兼容性修复由主代理负责。本报告没有调用付费模型、没有修改受跟踪源码。结论区分本次本地实测、历史模型实验和静态推断。

## 结论

当前代码有明确的防浪费机制（裁决缓存、并发合并、未知 usage 不伪装为零、停止后清理），但现有证据不足以认定 0.5.7 比裸模型更省 token、时间或钱。项目过去记录的对照反而暴露显著额外成本。不能把更多核验等同于更高净效率；也不能把实验次数节省直接换算为模型费用节省。

### E1｜P1：当前版本的净效率收益尚未获得对照验证

证据：

- `README.zh-CN.md:186` 明确结果是 0.5.0 开发集，样本小；`:196` 写约 2.2 倍 token，而非节省 token。
- `docs/optimization/sim-runs/2026-10-08-0.5.1-dev/README.md:10` 明确止损线未通过。该报告“对照止损线”记录含独立评估的总处理 token 为裸模型 **4.8–7.2 倍**；成本段记录主模型亦是主要来源，不只是多了评估者。反应器 15.9M 主模型 +2.3M 评估者；良率题 19.6M+6.2M。
- `docs/known-gaps.zh-CN.md:21` 已披露上述负结果；`:22` 说明每组 3–4 次，未做显著性检验。
- `docs/optimization/0.5.3-release/native-probe.json` 的工程探针两段分别 449039、143887 processed tokens，23、9 次调用，结束原因均为 user_cancelled。文件自己的 limitations 明确“不证明相对质量或 token savings”。这是旧版机制探针，不是当前版完成任务的成本样本。
- 本次搜索受跟踪 `docs/optimization` 发现的是历史小样本、预注册和工程探针，没有找到当前 0.5.7 的配对正式验收结果；不能据此断言其他地方不存在外部实验。

影响：把上述机制测试用于宣称“知识积累使当前版本更高效”会超出证据。历史负结果也不能自动推出 0.5.7 同样差；当前结论是**未证实**。

建议：运行已有 native-headless 的 6 场 smoke，再按预注册推进 development/formal；固定模型、宿主、代码摘要、预算与任务，包含失败/取消，报告配对质量差、实验次数、端到端耗时、各代理 token、缓存读写及按实际价目计算的费用。质量与节省分别达标，不能互相抵消。

### E2｜P2：所谓“裁决预算”实际上只约束消费后的内容，不是硬生成预算

定位：`preset/plugins/audit-schema.js:5` 删除 maxLength；`:6` 将其转为描述。`preset/plugins/clearai-kernel.js:1401` 和 `:1472` 使用转换后的 schema。`:1817` 的 auditTimeoutMs 只打警告；`:404` 明确 auditHardTimeoutMs 已废弃且忽略，取消和预算交由宿主。

本次直接调用 `nativeAuditSchema({type:'string',maxLength:1200,description:'basis'})`，得到：

```json
{"type":"string","description":"basis (maximum 1200 characters; excess is truncated by the consumer)"}
```

`node test/prompt-budget.test.mjs` 28 项全通过，包括超长产物被归一截断。因此消费后账本长度确实受控。但测试文件头 `test/prompt-budget.test.mjs:3` 关于“耗时靠协议形状”的叙述、以及对源 verdictSchema 的 maxLength 检查，不能证明实际宿主阻止模型先生成长文本；截断发生时生成费用已产生。宿主可能另有预算，本次没有证明它不存在，也没有运行 live 模型去测费率。

建议：补实际 native schema 路径的预算测试，区分“落账字符上限”和“生成 token/运行时间上限”；在宿主允许的接口上验证每次审计的预算、取消与成本可见性。不要简单恢复内部硬超时而造成重复派遣和丢失裁决。

### E3｜P2：每次新审计同步复制整个工作区，缓存/嵌套依赖会放大开销

定位：`preset/plugins/clearai-kernel.js:1788` 在派评估者前调用 rerunCopy；`:1864–1866` 的 skip 集合只精确排除根目录 `clear/`、`.git/`、`node_modules/`，使用同步 `cpSync`。`preset/agent.cordis.yml:204` 默认启用 auditRerun。

本次用相同复制语句和过滤规则运行可复现微基准：1000 个 64KiB 文件，共 65,536,000 字节；一次复制约 **156.7 ms**。根 node_modules 未复制；`sub/node_modules/` 和 `.venv/` **均被复制**。这是本机单次测量，不代表真实工作区延迟，更不能线性外推为确定的生产耗时。它验证了过滤规则确实包含不必要的依赖目录。

影响：大数据、Python 虚拟环境、monorepo 嵌套依赖使每次新审计产生重复 I/O、磁盘占用和事件循环阻塞。缓存命中会避免新副本；但不同步骤/修改后重新审计仍需付出成本。复制失败退化为只读评估，参见函数注释，需要明确呈现能力降低。

建议：定义可复跑材料清单和依赖策略，按需快照并排除已确认可重建的缓存目录；加入大文件/多小文件/嵌套依赖的测量，不要盲目省略复跑所需输入。可考虑异步复制或受控快照以减少主进程停顿。

### E4｜P2：历史成本摘要混用了主模型与全代理口径，横向引用容易低估

`docs/optimization/sim-runs/2026-10-07-hard-ab/README.md:8` 摘要称约 1.4–1.6 倍 token，但同文成本表明确另列评估者：反应器 ClearAI 92k/97k（另64k/63k），裸模型63k/60k。按表内全部代理相加为 (92+97+64+63)/(63+60)=**2.57 倍**；电解液同法 (81+82+62+61)/(59+59)=**2.42 倍**。这不是新实跑，而是对已公布表格的重算；可能解释是摘要有意只报主模型，但摘要未清楚说明排除评估者。

新版 `tools/native-headless/accounting.mjs:1–12` 分开记录 input/output/cacheRead/cacheWrite 并对 missing/pending 标 unknown，是正确改进；不过 `processed` 是四类 token 总和，不等于账单金额或 wall time。`tools/native-headless/acceptance.mjs:30` 的 ≤2.5 倍成本门槛明确允许多花 token；所谓 savings 在该文件 :31 指实验次数。

建议：历史摘要标明口径；汇总同时给主模型、评估者、合计、处理 token 与实际费用，避免把缓存读 token 与输出 token 等价定价。不要把“达到成本门槛”表述为“更省 token”。

## 其他已验证正面证据与边界

- `clearai-kernel.js:1698` 附近 pendingAudits 与 durable/digest 裁决复用防止相同材料重复花钱；`:1817` 超时只警告，避免自动重启造成重复付费。这是合理权衡，但需要宿主级预算兜底和可见的长运行状态。
- 直接测得三段提示词合计中文 **2263 字符**、英文 **6435 字符**。这是 JavaScript string.length，**没有 tokenizer，不能冒充 token 数**；未计入工具 schema、动态卡片、证据内容和宿主基础提示。
- `node --test test/native-accounting.test.mjs test/native-scoring.test.mjs` 两个文件级执行目标通过；usage/评分防护通过不证明实际模型更有效率。
- 正式统计框架确实存在：`tools/native-headless/acceptance.mjs` 对配对世界、完整结果和已验证 usage 有门槛；存在代码不能当成正式实验已跑完。

## 本次复现命令和产物

```bash
cd /workspace/clearai-dsh
node docs/optimization/2026-11-06-redteam/efficiency-probe.mjs
node test/prompt-budget.test.mjs
node --test test/native-accounting.test.mjs test/native-scoring.test.mjs
```

`efficiency-probe.mjs` 为仓库外追踪的本地辅助文件，仅创建并删除临时数据；输出对应本报告微基准。`prompt-budget.log` 和 `efficiency-tests.log` 保存本次检查输出。测试不触发付费 API，没有把历史 0.5.0/0.5.1/0.5.3 的数字当作当前版本测量。
