# 流程提取交付自检清单（Readiness Checklist：Workflow01-02）

> 在宣布“流程提取完成（可进入数据对齐/分析）”前，必须通过以下所有检查。

## 0. 执行计划与交付分区 (Plan & Delivery)
- [ ] 已在执行第一个 workflow 前输出“覆盖本次所有 workflows（仅限本 skill）的统一 plan”并获得用户确认（确认后再执行）。
- [ ] plan 已逐 workflow 列出 01-02，且每一步明确标注强制产出物清单（含文件路径）。
- [ ] plan 已显式声明产物分区：过程文件/中间产物输出至 `lab/`，最终交付输出至 `products/`，且每一步标明输出落点。
- [ ] plan 包含“产出物对照表”，并已逐条对照所选 workflows 的 `## 产出物` 清单逐行复制（无漏项、无概括省略）。
- [ ] 最终交付物（workflows 声明的 `products/extracted/*`）已按 plan 约定落在 `products/`（推荐 `products/extracted/*`），过程转储/临时产物不混入最终交付目录。

## 1. 流程资料与证据链 (Process Evidence)
- [ ] 已遵守“资料优先级粘性”：找到操作规程/实验方案/流程图等高优先级资料后，已尽可能完成鲁棒抽取（paragraph+table、转纯文本、OCR 等），未在高优先级尚可读取时直接降级用低优先级资料替代流程叙述。
- [ ] `products/extracted/process_brief.md` 的流程叙述段落通过“段落选型闸门”：标题类型匹配、包含流向要素、覆盖性满足；若未找到流程叙述，已明确写出“未找到”并列出已尝试路径（而不是补写流程）。
- [ ] `products/extracted/process_brief.md` 的“原文摘录”由代码从 raw dump（或 OCR 文本）生成，且填写了 `raw dump 路径 + 定位范围`（可审计、可复查）。
- [ ] `products/extracted/process_brief.md` 的“补充证据/控制逻辑摘要（可选）”如有填写：已标注来源与性质（补充证据，非流程叙述），且未用其替代流程叙述主证据。

## 2. 单元清单与边界契约 (Inventory & Boundary)
- [ ] `products/extracted/unit_inventory.md` 已覆盖关键单元（尤其核心装置）的输入/输出与能量/资源接口（蒸汽/冷却水/电/燃气/真空等），并能从单元视角复原流向/能流走向（不要求测点/字段名）。
- [ ] 存在性三态输出正确：State_A/State_B/State_C 定义清晰，State_B 有证据链（来源/位置/置信度/why_not_high）。
- [ ] 对 State_C（未确认存在）条目未写成“无计量点/unmetered_stream”（计量点匹配后置到后续数据对齐）。
- [ ] `products/extracted/segment_boundary.md` 的净输入/净输出/回流/旁路规则与流程叙述一致；无证据时均标注“待确认/待匹配”，不存在强断言测点编号或凭空设备数量。

## 3. 流程图与拓扑骨架 (Diagram & Topology Skeleton)
- [ ] `products/extracted/process_flow.md` 开头包含“输入去向映射表”，且每股输入的“直接接收单元”都有逐字原文依据（不得按编号顺序推测）。
- [ ] Mermaid 流程图至少包含：主流程图（净输入/净输出/回流区分清楚）与能量/资源视角图（主要支撑介质表达完整）。
- [ ] 若存在推断连接：已在图中用 `【推断】` 文本标注，并在文档中给出“推断清单”（理由/依据来源/置信度/验证动作）。
- [ ] `products/extracted/entity_map.json` 的节点=单元/公用支撑系统/边界；边=流股/能量；每条 edge 有 evidence；不包含任何具体测点/字段名（测点补齐后置）。

---

**自检结论**:
- [ ] 通过 (Ready to Handover)
- [ ] 需返工 (Needs Rework)
