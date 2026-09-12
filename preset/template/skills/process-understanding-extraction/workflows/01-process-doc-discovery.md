# Workflow 1: 流程资料定位与边界定义 (Process Doc Discovery & Boundary)

## 目标
用“流程/方法资料”把系统讲清楚，形成后续数据分析的 **边界口径**：
- 系统包含哪些单元（装置/处理单元/子系统/公用支撑系统）？
- 物料流/对象流与能量流的入口与出口是什么？
- 哪些是**回流/旁路/内循环**（不能当作净输出）？
- 每个关键单元（例如反应器/分离单元/培养装置/处理模块等）的主要**流向**与**能量/资源接口**是什么？

## 步骤

### Step 1: 建立资料检索清单（先列后找）
优先级从高到低：
1. 操作规程/实验方案（SOP/操作法/Protocol）
2. 流程描述/流程图（含物料或对象走向的 PFD、方法章节）
3. 详细示意图（管路仪表图 P&ID、接线图、系统架构图等，含编号与回路）
4. 装置清单/单元参数（设计负荷/规格/型式）
5. 变量表/位号表（Tag Dictionary、数据字典）
6. 控制指标/报警限/阈值文件

> **Rule（优先级粘性，必须）**：一旦你已经“找到/拿到”了更高优先级的资料文件（例如规程/方案/流程图），就必须优先把它**尽可能读出来**，再允许下沉到下一优先级。
> - “尽可能读出来”必须先用 `read` 做统一文档转换；若 DOCX 原文需要逐段审计，再用本 workflow 的 `python-docx` raw-dump 模板补齐 paragraph+table 与标题目录。仅当 `read` 明确返回扫描/图片型 PDF 提示且正文为空时，才逐页调用 `read_image(page=...)` 做 OCR。
> - 只有在 `products/extracted/process_brief.md` 明确写出“该高优先级文件仍不可读/仍无法定位目标段落（已尝试哪些抽取方式）”后，才允许使用低优先级资料作为补充证据。
> - 低优先级资料只能作为补充证据，必须标注来源与置信度，禁止替代流程叙述主证据。

### Step 2: 用“关键词 + 单元编号”定位段落
流程型资料常见有效关键词（按优先级）：
- **优先检索（流程叙述主证据）**：“流程叙述/流程概述/流程说明/方法描述/实验流程/工作流程/Process Description/Process Overview/Methods”
- **辅助检索（补充证据，不可替代流程叙述）**：“正常操作/正常运行/启动/停止/参数调整/联锁/报警/控制逻辑/异常处理”
- **单元与介质关键词**：“加热/冷凝/真空/蒸汽/冷却水/回流/循环/缓冲/进料/出料/采样”
- **单元编号**（如 Cxxx、Exxx、Vxxx、Pxxx、Unit-x、Step-x）

> **Rule（检索优先级，必须）**：必须先用“流程叙述/流程概述/Process Description”等关键词定位流程叙述主证据章节；只有在 `products/extracted/process_brief.md` 中明确记录“未找到/无法抽取”（含已尝试的抽取路径）后，才允许使用“启动/停止/联锁/参数调整/控制逻辑”等段落作为补充证据（不得替代主证据）。

#### 2.0 “必须找到真正流程叙述，否则明确声明未找到”（硬规则）
本 workflow 的核心交付是“**真正的流程叙述原文**”（例如章节名包含“流程叙述/工作流程/流程说明/方法描述”一类）。
在未定位到该类段落前，禁止基于猜测补写流程、禁止用零散句子拼接冒充流程叙述。

**强制输出策略（二选一）**：
1. **找到**：在 `products/extracted/process_brief.md` 中粘贴“流程叙述原文”（可含前后 1-2 段上下文），并给出定位证据（标题路径/页码/表格位置/抽取方式）。
2. **未找到**：在 `products/extracted/process_brief.md` 的首段明确写：`未找到流程叙述章节/段落，无法输出流程原文。` 并列出已尝试的抽取路径与关键词（read、paragraph/table raw dump；若为扫描 PDF，再列 read_image OCR 页码）。

> **硬约束（必须遵守）**：`products/extracted/process_brief.md` 必须按如下结构输出，避免“检索到了章节但抽取结果错误很多”的情况：
> 1) **定位信息**（标题路径/页码/抽取方式）
> 2) **原文摘录（逐字粘贴）**：必须是文档中的连续原文，不允许改写、不允许总结冒充原文。
> 3) **AI 摘要（可选）**：若需要摘要，必须放在“原文摘录”之后，并明确标注为“摘要”，且不得与原文混排。
> 4) **疑点清单**：若原文存在歧义或抽取不完整，必须列出“疑点/缺口”，并禁止在后续边界契约中用强断言填空。
> 5) **补充证据/控制逻辑摘要（可选，但推荐）**：允许收录“启动/停止/参数调整/控制逻辑/动态平衡机理”等段落作为补充证据，用于帮助理解稳态与控制，但必须满足：
>    - 明确标注其章节来源（标题路径/页码）与性质（补充证据，非流程叙述）。
>    - 只能用于提出“候选假设/需要核对的控制规律”，不得用来替代流程叙述原文。
>    - 不得据此在 `products/extracted/segment_boundary.md` 中写出无证据的测点/装置数量等强断言；最多写成“待确认/待匹配”。

> **段落选型闸门（必须通过）**：只要你输出“流程叙述原文”，就必须同时满足以下条件；否则该段落只能作为“补充证据”，并视为 **未找到流程叙述**（继续回到 Step 2 搜索）。
> - **标题类型必须匹配**：标题/小节名应指向“流程叙述/工作流程/流程说明/方法描述/Process Description”这类“讲对象怎么流转”的章节。
> - **明确排除项（不可作为流程叙述主证据）**：仅属于“启动/停止/参数调整/控制指标/操作调整/异常处理/联锁/报警处理/控制逻辑/动态平衡机理”的段落，不能当作流程叙述主证据（即使内容很专业）。
> - **内容必须包含流向要素**：原文中必须出现至少 1 个明确的“外来输入/净输入”与至少 1 个明确的“外送产物/净输出/去向”，并能读出至少一条“从 A 到 B”的流向（例如“进料→处理单元→顶部/底部/侧线→去向”）。
> - **覆盖性最小要求**：若系统包含多个关键单元，流程叙述原文必须能覆盖这些关键单元的主流向关系；若只覆盖少数单元或只讲控制调整，则不合格。
>
> **说明**：像“启动过程中的参数调整”这类段落非常适合放入 `products/extracted/process_brief.md` 的“补充证据/控制逻辑摘要”部分（例如控制逻辑、真空建立顺序、回流策略），但不能替代“流程叙述”。

#### 2.1 DOCX 文档抽取的鲁棒策略（必须）
很多正式规程/方案/报告的 DOCX 结构复杂（大量空段、分节符、表格、页眉页脚、隐藏文本），只读 `paragraphs` 往往会漏掉关键章节（例如章节标题在表格单元格内）。

##### 2.1.0 代码优先：先产出“可审计 raw dump”，再由代码生成 process_brief（必须）
为避免大模型“自己写出一段看似合理的流程”，本 workflow 要求使用**代码**把 DOCX 转储为 raw dump，再从 raw dump 中**逐字复制**目标段落到 `products/extracted/process_brief.md`。

推荐使用模板脚本：`templates/docx_raw_dump_extractor.py.tpl`（段落 + 表格、按顺序转储）。
推荐使用模板脚本：`templates/process_brief_builder_from_raw_dump.py.tpl`（按 range 从 raw dump 抽取并生成 `products/extracted/process_brief.md`）。

**最小交付要求**：
- 产出 raw dump（建议放在过程目录 `lab/`，例如 `lab/raw_dumps/<doc>.raw_dump.md`）
- 确定目标段落的 raw dump range（例如 `P00376-P00420`），并将 range 写入定位信息
- 使用代码从 raw dump + range **生成** `products/extracted/process_brief.md`（最终交付目录 `products/extracted/`）

> **硬规则（禁止模型逐字输出原文）**：
> - `products/extracted/process_brief.md` 的“原文摘录”必须由**代码**从 raw dump 生成；若 `read` 已判定为扫描 PDF，则可由逐页 `read_image` 的 OCR 文本生成，并记录页码。
> - 大模型只允许做：定位目标标题、给出 raw dump range、可选摘要与疑点清单；**禁止在对话/笔记中逐字粘贴原文**（避免模型代写/错贴/漏贴，且便于审计）。

当“搜不到章节/段落”时，必须按如下优先级补救：
1. **先用 `read` 转 Markdown 并检索**：这是 PDF/DOCX/PPTX/XLSX 等结构化文档的统一入口，不额外依赖宿主机命令。
2. **同时抽取段落 + 表格单元格文本**：若 DOCX 需要逐字审计，使用 `templates/docx_raw_dump_extractor.py.tpl`；不仅遍历 `doc.paragraphs`，也遍历 `doc.tables` 的每个 `cell.paragraphs`。
3. **按样式识别标题并构建目录**：读取 `paragraph.style.name`（如 Heading 1/2/3），先产出“标题清单”再定位目标章节。
4. **扫描 PDF 才进入 OCR**：只有 `read` 返回扫描/图片型 PDF 提示且正文为空，才用 `read_image(path=<pdf>, page=<n>, prompt=...)` 逐页识别；普通 PDF 不走 OCR。

> **Rule**：只要目标章节来自 DOCX，必须在 `products/extracted/process_brief.md` 中注明“抽取方式”（read 或 python-docx paragraph/table raw dump）与定位证据（标题路径/页码/截图）。

> **Rule（不允许“读不出来就跳过”）**：如果高优先级 DOCX 存在但抽取失败，不允许自动跳到低优先级资料“补写流程”。必须先完成上述补救路径（至少 paragraph+table + 转纯文本二选一），并在 `products/extracted/process_brief.md` 明确记录失败原因与已尝试步骤。

> **Rule（抽取正确性优先）**：如果你已经定位到目标章节（例如 5.2.2），但抽取文本“错误很多/明显丢段”，必须追加一个“原文转储（raw dump）”附件：把该标题前后各 1-2 级标题范围内的段落与表格单元格文本按顺序转成纯文本附在 `products/extracted/process_brief.md` 末尾（或单独输出 `products/extracted/process_brief_raw_dump.md`），并标注每段来源（paragraph/table、标题路径）。在完成 raw dump 前，禁止进入 Step 3/4 做边界断言。

#### 2.2 “只识别到一个输入”的防错校验（必须）
如果从资料文本中只抽取到 1 个外来输入，必须执行一次“多证据交叉验证”，避免漏识别第二输入/旁路输入：
- **流程侧**：流程图/示意图是否存在两股外来输入？是否存在“粗品/回收液/补充料/并行来源”等并行入口？
- **数据侧**：在数据 skill（`data-qa-analysis/workflows/02-data-alignment-and-tag-semantics.md`）产出的 `products/extracted/data_dictionary.md` / `products/extracted/tag_map.csv` 中，是否存在“输入计量（流量计/计数器）”对应多股输入？
- **能量/资源侧**：如果系统能耗/资源消耗随负荷变化，负荷口径必须能解释该变化；若解释不了，通常是“负荷口径缺了一股输入”。

输出：把你找到的“最权威”的流程文本段落复制到 `products/extracted/process_brief.md`，并注明来源路径与页码/章节号。

> **产出模板（强制使用）**：`products/extracted/process_brief.md` 必须严格按照 `templates/process_brief.md.tpl` 的骨架结构输出，逐区填写。禁止跳过“原文摘录（逐字粘贴）”区域直接写摘要或改写内容。若提交的 brief 中“原文摘录”区域为空、或其内容实质上是 AI 改写/总结而非文档原文，则该 brief 视为**不合格**，必须回退重做。

### Step 3: 建立 Unit/Stream Inventory（存在性三态，计量点后置）
对每个“单元/流股/关键产物”，必须输出一个清单条目（后续 workflow 以此清单作为对齐与匹配的上游约束）。

**存在性三态（本 workflow 的结论只允许这三类）**：
- **State_A 确认存在**：在“流程叙述原文”中直接出现（主证据）。
- **State_B 推定存在**：流程叙述未抽取到，但有第二证据源支持存在（允许：流程图/示意图、装置清单、变量表、数据列名/下游去向证据），并必须标注来源与置信度（高/中/低）以及“为何不是高”。
- **State_C 未确认存在**：主证据缺失且第二证据也不足。

**第二证据源与置信度标注规范（必须，给 State_B 用）**：
- **允许的第二证据源**（从强到弱，项目可增删但必须在此处声明优先级）：流程图/详细示意图（含流向）、装置/管线清单、变量表/仪器台账、报表或历史数据的列名与描述行、下游去向/物料平衡可解释性证据。
- **每个 State_B 条目至少写 1 条 Evidence**，且 Evidence 必须包含以下字段（写在 `products/extracted/unit_inventory.md` 中）：
  - `evidence_type`（例如 flow_diagram / detailed_diagram / equipment_list / tag_dictionary / data_column / downstream_destination）
  - `evidence_location`（文件名或路径 + 章节/页码/图号/表号/截图说明）
  - `evidence_excerpt`（可选，1-3 句/一行关键文字，或“图中 A→B 流向箭头”描述）
  - `confidence`（高/中/低）
  - `why_not_high`（必须：缺什么证据、为什么仍不是“确认存在”）
- **置信度口径（建议）**：
  - **高**：流程图/详细示意图或装置/管线清单中明确出现该流股/产物及其上下游连接关系。
  - **中**：变量表/数据列名/下游去向证据强，但缺少明确流程文字或图纸连接关系。
  - **低**：只有弱线索（零散提及、命名相似、或间接推断），需要进一步补证。

> **禁止规则**：当条目为 State_C 时，禁止输出“无计量点/需要代理测点/unmetered_stream”。只能写“未确认存在（缺证据）”。
> **计量点后置**：本 workflow 不要求确认计量点是否存在、也不要求把对象匹配到 metric-of-record；只要求将“计量点匹配”标记为待数据 skill workflow02 完成。

**单元级流向与能量/资源接口（必须，保持通用性）**：
- 对每个关键单元（例如：反应器/分离单元/蒸发器/培养装置/结晶器/处理模块等），在 `products/extracted/unit_inventory.md` 中必须补齐一段“接口摘要”，至少包含：
  - **输入（inlet_streams）**：来自哪里（上游单元/边界）、大类（新鲜输入/回流/内循环/旁路回注/清洗液等）、是否计入净输入（yes/no/unknown）
  - **输出（outlet_streams）**：去往哪里（下游单元/边界）、大类（产物外送/排放/回流/内循环/旁路外送等）、是否计入净输出（yes/no/unknown）
  - **能量/资源接口（energy_interfaces）**：该单元的主要能量或资源注入/移除方式与介质（蒸汽、冷却水、导热介质、燃气、电、真空、算力/人力等广义资源），并标注“注入/移除”的方向
  - **主要成本驱动（primary_cost_drivers, optional）**：若已知，指出与该单元最相关的成本介质（例如蒸汽/电/试剂/原料损失/时间），用于后续优先级排序
- 允许以“表格 + 简短说明”写法表达，但必须做到**能从单元视角复原流向/能流走向**。
- 本步骤不要求测点/字段名，只要求对象与流向清晰；测点与 metric-of-record 由数据 skill workflow02 统一补齐与校验。

输出：`products/extracted/unit_inventory.md`

### Step 4: 定义分析边界（Boundary Contract）
必须回答并写入文档：
- **边界内单元列表**：哪些装置/子系统/公用支撑系统算在内？必须分层表达：
  - **单元层（unit-level）**：例如反应器/分离单元/蒸发器/压缩机/真空系统等“主单元”
  - **设备层（equipment-level，可选但推荐）**：换热器/泵/罐/辅助机组等明细。若你声称“边界内设备共 N 台”，则必须给出设备清单或明确声明“资料未列出明细，N 仅来自某页统计/表格标题，待补证”。禁止凭空写出 N。
- **净输入/净输出**：哪些流股是外送/外来？哪些是回流/内循环？（注意：流程型系统常有“多股输入”，必须列全）
- **能量/资源边界**：蒸汽/电/冷却水等是否全计入？口径是什么？
- **候选口径（待匹配）**：把“系统输入/系统产出/系统主要消耗”的**候选计量口径**先列出来（例如：可能是流量计/累计量/功率计/化验点/计数器），但不在本 workflow 确认最终 metric-of-record；最终匹配由数据 skill workflow02 完成。

> **Rule（禁止强断言）**：边界契约中必须列出“净输入清单”（可能多股）及其“候选计量口径（待匹配）”。
> - 如果你写出了具体测点/回路编号（例如 FIC/FT/TT 等），必须同时提供证据引用（来自 `products/extracted/process_brief.md` 原文摘录、流程图/示意图、或变量表），并标注“候选/待匹配”。
> - 若无证据，必须写成“待确认（no evidence yet）”，禁止用编号填空。
> - 如果规程以泵号/装置号叙述输入，只能把“泵/装置对象”记录到 `products/extracted/unit_inventory.md`，并将“计量口径匹配”后置到数据 skill workflow02（禁止在此阶段用猜测把装置号当作计量点）。

输出：`products/extracted/segment_boundary.md`

## 产出物
- `products/extracted/process_brief.md`：流程简介（带引用）
- `products/extracted/unit_inventory.md`：单元/流股清单（存在性三态 + 证据 + 置信度 + 计量点匹配后置）
- `products/extracted/segment_boundary.md`：边界契约（净输入输出、回流处理、能量/资源边界）

## 闸门（确认后进入下一 Workflow）
在进入 `workflows/02-process-understanding-and-diagramming.md` 前，必须确认本 workflow 产出无误，并在 `products/extracted/process_brief.md` 或 `products/extracted/segment_boundary.md` 末尾追加“确认记录”（日期/确认人/结论/疑点与后续动作）。最少确认：
- **强制产出物是否齐全**：`products/extracted/process_brief.md`、`products/extracted/unit_inventory.md`、`products/extracted/segment_boundary.md` 是否都已生成且内容完整。
- `products/extracted/process_brief.md` 是否真正引用到“流程叙述原文”；若未找到，是否已明确声明“未找到”，且列出已尝试的抽取路径。
- `products/extracted/process_brief.md` 是否严格按照 `templates/process_brief.md.tpl` 骨架结构输出（定位信息 → 原文摘录 → AI 摘要 → 疑点清单 → 补充证据）。
- `products/extracted/process_brief.md` 的“原文摘录（逐字粘贴）”区域：是否有实际内容？内容是否为文档原文逐字复制（而非 AI 改写/概括/重组）？若该区域为空或全部为 AI 生成文字，brief **不合格**，必须回退重做。
- `products/extracted/process_brief.md` 的“AI 摘要（如有）”是否与“原文摘录”分区清晰（禁止摘要冒充原文、禁止混排）。
- `products/extracted/process_brief.md` 的“流程叙述原文”是否通过了“段落选型闸门”：不能用“启动/停止/参数调整/控制逻辑”段落替代“流程叙述/流程说明”段落。
- `products/extracted/unit_inventory.md` 是否覆盖关键单元（尤其是核心装置）的输入/输出与能量/资源接口，且存在性三态与证据链自洽。
- `products/extracted/segment_boundary.md` 的净输入/净输出/回流/旁路规则是否与文字流程一致。
- `products/extracted/segment_boundary.md` 中是否存在“无证据的强断言”（例如凭空给出测点/回路编号、凭空写出边界设备台数或明细）。若存在，必须回退到证据链补齐或标为“待确认/待匹配”。

## 示例（Example）
示例写法（仅展示结构，不依赖任何固定路径）：
- 操作规程/实验方案：定位并逐字粘贴“流程叙述/流程概述”原文（必要时附 raw dump），形成 `products/extracted/process_brief.md`
- 基于规程/流程图/示意图：整理单元/流股存在性三态 + 输入/输出 + 能量/资源接口，形成 `products/extracted/unit_inventory.md`
- 流程图/详细示意图：用单元编号与流向连接关系补齐边界契约（净输入/净输出/回流/旁路/能量边界），形成 `products/extracted/segment_boundary.md`
