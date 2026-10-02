# JEPA 世界模型:文献综述(截至 2026-10-02)

## 0. 证据来源与等级说明

本次运行的网络策略挡住了 arXiv、Meta 官网、Hugging Face 以及大多数博客/新闻站,只有 **GitHub 原始文件**(raw.githubusercontent.com)与**搜索引擎摘要**可用。因此每项都标出证据等级:

- **A = 官方仓库原文**:已下载到 `sources/` 下,数字可逐字复查。
- **B = 搜索引擎摘要**:摘要转述了论文/会议页的内容,本次没能打开原文核对;数字可能有转述误差。
- **C = 二手转述**:非作者方的整理站(如 jepawiki 社区站)经搜索摘要转述。

链接一律给论文/仓库的规范地址(读者可自行打开);本次运行能否打开见上。

## 1. 主线:从立场论文到 V-JEPA 2.1

| # | 工作 | 年份 | 一句话贡献 | 关键数字 | 出处 | 等级 |
|---|---|---|---|---|---|---|
| 1 | **A Path Towards Autonomous Machine Intelligence**(LeCun) | 2022-06 | 提出 JEPA 与层级 H-JEPA:在表示空间里预测、用能量模型框架,不还原像素;世界模型+代价+行动者的自主智能架构 | 立场论文 v0.9.2 | https://openreview.net/forum?id=BZ5a1r-kVsf | B |
| 2 | **I-JEPA**(Assran 等,CVPR 2023) | 2023-01 | 图像上从上下文块预测目标块的表示;无手工视图增强、无像素解码器;EMA 目标编码器 | ViT-H/14 线性探测 IN-1K 79.3%(300 epoch),MAE ViT-H/14 77.2%(1600 epoch);ViT-H/14 在 16 张 A100 上 <72 小时 | https://arxiv.org/abs/2301.08243 ;仓库 https://github.com/facebookresearch/ijepa(`sources/facebookresearch_ijepa_README.md`) | 方法描述 A;数字 B |
| 3 | **V-JEPA**(Bardes 等,TMLR 2024) | 2024-02 | 把特征预测作为视频自监督的唯一目标:不用预训练图像编码器、文本、负样本、像素重建 | ViT-H/16 冻结骨干:K400 81.9%、SSv2 72.2%、IN-1K 77.9%;训练数据 VideoMix2M(约 200 万视频) | https://arxiv.org/abs/2404.08471 ;仓库 https://github.com/facebookresearch/jepa(`sources/facebookresearch_jepa_README.md`) | 方法与数据 A;数字 B |
| 4 | **Intuitive physics understanding emerges from self-supervised pretraining on natural videos**(Garrido 等) | 2025-02 | 用"惊讶度"评测:V-JEPA 在表示空间预测,对物体恒存、连续性等直觉物理属性显著高于随机;像素空间视频预测模型与多模态 LLM 接近随机 | IntPhys:物体恒存 85.7%、连续性 86.3%、形状恒常 83.7%;未训练网络约 51% | https://arxiv.org/abs/2502.11831 ;仓库 https://github.com/facebookresearch/jepa-intuitive-physics(`sources/facebookresearch_jepa-intuitive-physics_README.md`) | 结论 A(README 说明了可复现数据);数字 B |
| 5 | **V-JEPA 2 / V-JEPA 2-AC**(Assran 等) | 2025-06 | 超过 100 万小时互联网视频预训练(动作无关);再用 <62 小时 DROID 机器人视频后训练动作条件预测器 2-AC,在两个实验室的 Franka 臂上零样本做图像目标规划 | SSv2 探测 77.3%、EK100 动作预期 R@5 39.7%、Diving48 90.2%、MVP 44.5%、TempCompass 76.9%;机器人结果见 §3 | https://arxiv.org/abs/2506.09985 ;仓库 https://github.com/facebookresearch/vjepa2(`sources/vjepa2_README.md`) | 数字 A(README 表格);数据规模 B |
| 6 | **V-JEPA 2.1**(Meta FAIR) | 2026-03 | 稠密预测损失(可见与被遮 token 都算损失)+ 深层自监督(多层中间表示)+ 图像/视频多模态 tokenizer + 规模化,得到时间一致的稠密特征 | Ego4D 短期交互预期 7.71 mAP、EK100 R@5 40.8、真实机器人抓取成功率比 V-JEPA 2 高 20 个百分点、NYUv2 深度 RMSE 0.307、SSv2 77.7% | https://arxiv.org/abs/2603.14482 ;仓库同上(README 2026-03-16 条目,方法四要点为 A) | 方法 A;数字 B |

## 2. 理论、防坍缩与变体

| # | 工作 | 年份 | 一句话贡献 | 关键数字/结论 | 出处 | 等级 |
|---|---|---|---|---|---|---|
| 7 | **JEPAs Focus on Slow Features**(Sobal 等) | 2022-11 | 离线无奖励设置下比较 JEPA(VICReg/SimCLR 目标)与生成式重建:干扰噪声逐帧变化时 JEPA 持平或更好;干扰固定不变时 JEPA 失败,并给出理论解释 | 定性结论 | https://arxiv.org/abs/2211.10831 | B |
| 8 | **How JEPA Avoids Noisy Features**(Littwin 等,Apple,NeurIPS 2024) | 2024-07 | 深度线性自蒸馏网络的隐式偏置:JEPA 偏向学"高影响"(回归系数大)的特征,MAE 偏向高方差特征 | 理论(线性设定) | https://arxiv.org/abs/2407.03475 | B |
| 9 | **LeJEPA**(Balestriero & LeCun) | 2025-11 | 证明各向同性高斯是嵌入的最优分布,提出 SIGReg(随机一维投影 + 特征函数匹配,线性复杂度);不需要预测器之外的教师、停梯度、EMA 调度 | README:LeJEPA ViT-L(304M,IN-1K 100 epoch)8 个数据集全量线性评测平均 79.48,I-JEPA ViT-H(632M,300 epoch)78.50 | https://arxiv.org/abs/2511.08544 ;仓库 https://github.com/rbalestr-lab/lejepa(`sources/rbalestr-lab_lejepa_README.md`) | A |
| 10 | **LLM-JEPA**(Huang, LeCun, Balestriero) | 2025-09 | 在下一词预测之外加 JEPA 目标:从一个"视图"(如自然语言描述)预测另一视图(如代码)的嵌入 | 摘要称在 NL-RX、GSM8K、Spider、RottenTomatoes 及 Llama3/Gemma2/OpenELM/OLMo 上明显优于标准目标;README:JEPA 损失随机丢弃 75% 时约 1.25× 计算量仍保持性能 | https://arxiv.org/abs/2509.14252 ;仓库 https://github.com/galilai-group/llm-jepa(`sources/galilai-group_llm-jepa_README.md`) | 训练细节 A;效果 B |
| 11 | **VL-JEPA**(Meta) | 2025-12 | 视觉-语言 JEPA:预测目标文本的连续嵌入而非自回归生成 token | 摘要称 WorldPrediction-WM 63.9%,超过 GPT-4o、Claude-3.5-sonnet | https://arxiv.org/abs/2512.10942 | B |
| 12 | **VJEPA / Var-JEPA:变分 JEPA**(概率世界模型) | 2026-01/03 | 把 JEPA 写成变分/概率形式,以表达预测的不确定性 | 定性 | https://arxiv.org/abs/2601.14354 ;https://arxiv.org/abs/2603.20111 | B |

## 3. JEPA 作为世界模型做规划

| # | 工作 | 年份 | 一句话贡献 | 关键数字/结论 | 出处 | 等级 |
|---|---|---|---|---|---|---|
| 13 | **DINO-WM**(Zhou, Pan, LeCun, Pinto) | 2024-11 | 在冻结的 DINOv2 补丁特征上训练动作条件预测器,零样本在潜空间做 MPC 规划(迷宫、推物、可形变物体等) | 定性 | https://arxiv.org/abs/2411.04983 ;仓库 https://github.com/gaoyuezhou/dino_wm(`sources/gaoyuezhou_dino_wm_README.md`) | A(方法);B(效果) |
| 14 | **PLDM:Learning from Reward-Free Offline Data**(Sobal 等) | 2025-02 | 无重建的 JEPA 潜动力学模型 + 规划,从无标注离线数据学环境动力学,对新任务/新环境泛化好于无模型 RL 基线 | 定性(导航域) | https://arxiv.org/abs/2502.14819 | B |
| 15 | **EB-JEPA**(Meta FAIR,开源库) | 2025–2026 | 单卡几小时可跑的教学库:图像 JEPA(CIFAR-10)、视频 JEPA(Moving MNIST)、动作条件视频 JEPA 在 Two Rooms 中规划 | — | https://github.com/facebookresearch/eb_jepa(`sources/facebookresearch_eb_jepa_README.md`) | A |
| 16 | **VLA-JEPA** | 2026-02 | 用 JEPA 式潜世界模型给视觉-语言-动作策略预训练,避免潜动作目标锚定在像素变化上 | 定性 | https://arxiv.org/abs/2602.10098 | B |

### 3.1 关键声称核对:V-JEPA 2-AC vs Cosmos(判断「VJEPA2规划声称」)

官方仓库 README(`sources/vjepa2_README.md` 第 102–148 行附近的表格,等级 A)给出 Franka 臂、单目 RGB、图像目标规划的成功率:

| 方法 | Reach | Grasp-Cup | Grasp-Box | Pick&Place-Cup | Pick&Place-Box |
|---|---|---|---|---|---|
| Octo(视觉-语言-动作策略) | 100% | 10% | 0% | 10% | 10% |
| Cosmos(生成式视频世界模型) | 80% | 0% | 20% | 0% | 0% |
| **V-JEPA 2-AC** | 100% | 60% | 20% | 80% | 50% |

- 在全部 5 项上 V-JEPA 2-AC ≥ Cosmos,其中 4 项严格更高(Grasp-Box 持平 20%);抓放(Pick&Place)两项 80%/50% vs 0%/0%。
- **每步规划耗时**:"V-JEPA 2-AC 约 16 秒/动作,Cosmos 约 4 分钟/动作(约 15×)" —— 这一数字本次只拿到**等级 C**(社区整理站 jepawiki 经搜索摘要转述,提到 800 个候选采样、10 轮迭代的 CEM 规划);论文原文被网络策略挡住,**未能对照一手原文**。
- 注意:README 表格每格的试验次数未在 README 中给出(百分比都是 10% 的整数倍,推测每格约 10 次试验),样本量小,置信区间宽。

### 3.2 已知的局限(来自文献,等级 B)

- V-JEPA 2-AC 不做相机标定,需从单目画面隐式推断动作坐标轴;机器人基座不在画面里时坐标轴推断不明确,对相机位置敏感(V-JEPA 2 论文局限一节,经搜索摘要)。
- 长时程:自回归潜空间滚动误差累积;FF-JEPA(https://arxiv.org/abs/2606.09311)等 2026 年工作专攻潜空间长时程规划。
- 有工作报告在 PushT 上把 V-JEPA 2.1 检查点接入同一训练接口时几乎不依赖动作、规划完全失败(经搜索摘要,具体论文未能打开核对,等级 C)。

## 4. 与生成式世界模型的区别

| # | 工作 | 年份 | 特点 | 出处 | 等级 |
|---|---|---|---|---|---|
| 17 | **NVIDIA Cosmos 世界基础模型(WFM)** | 2025-01 | 扩散/自回归视频生成,文本/图像/视频条件生成"物理感知"视频,开放权重;V-JEPA 2-AC 对比的生成式基线 | https://techcrunch.com/2025/01/06/nvidia-releases-its-own-brand-of-world-models | B |
| 18 | **Genie 3**(Google DeepMind) | 2025-08 | 文本提示生成可交互环境,720p/24fps 实时、数分钟一致 | https://deepmind.google/discover/blog/genie-3-a-new-frontier-for-world-models/ | B |
| 19 | **DreamerV3**(Hafner 等) | 2023/2025 | RSSM 潜空间动力学 + 重建/奖励学习的模型式强化学习,跨领域固定超参数 | https://arxiv.org/abs/2301.04104 | B |

**区别要点**(综合 1、2、3、5、7、8、17–19):

1. **预测目标**:生成式世界模型(Cosmos、Genie 3、DreamerV3 的解码器)在像素/token 空间还原未来;JEPA 只在表示空间预测,不需要也不能直接出图(V-JEPA 另训扩散解码器才可视化,见 `sources/facebookresearch_jepa_README.md`)。
2. **不可预测细节**:像素损失必须为不可预测的细节(纹理、噪声)付代价;JEPA 可以在表示里丢掉它们(I-JEPA/V-JEPA 的动机;Littwin 2024 的线性理论)。代价是 JEPA 可能被"慢特征"骗(Sobal 2022)。
3. **坍缩**:像素重建天然不会坍缩;JEPA 必须靠 EMA+停梯度(I-JEPA/V-JEPA)、方差/协方差正则(VICReg 系)或 SIGReg(LeJEPA)防坍缩。
4. **规划成本**:在紧凑潜空间里打分候选动作比生成视频便宜(V-JEPA 2-AC vs Cosmos 的耗时声称,等级 C)。
5. **可解释与可验证**:生成式模型的输出可以直接看;JEPA 需要探测器或解码器才能检查它"想"的是什么。

## 5. 与其他自监督方法的区别

- **对比学习 / 不变性方法(SimCLR、VICReg、DINO 系)**:两视图表示对齐,依赖手工数据增强定义不变性;JEPA(I-JEPA)用遮挡+预测器替代增强(I-JEPA README:"without relying on pre-specified invariances to hand-crafted data transformations")。LeJEPA 则又回到多视图裁剪增强(README 的 2 全局 + 6 局部视图),说明"JEPA = 无增强"并非定义的一部分。
- **掩码重建(MAE、VideoMAE)**:在像素空间重建被遮区域;I-JEPA 报告同规模下线性探测更高、训练更省(§1 第 2 行,等级 B)。
- **自回归下一词预测(LLM)**:在离散 token 上生成;LLM-JEPA / VL-JEPA 尝试在语言侧引入嵌入预测目标。

## 6. 本节小结(供 final.md 引用)

- 一手可核(A):V-JEPA 2-AC 在 Franka 规划上 5 项中 4 项成功率高于 Cosmos、1 项持平;V-JEPA 2 的理解/预期基准数字;LeJEPA 无 EMA/停梯度的方法声明及其 README 对比表;V-JEPA 2.1 的四要点方法。
- 只能二手确认(B/C):V-JEPA 2-AC 规划耗时 16 秒 vs 4 分钟;V-JEPA 2.1 / VL-JEPA / LLM-JEPA 的具体数字;直觉物理数字。
- 文献内部的张力:Sobal 2022(静态干扰下 JEPA 失败)与 Littwin 2024(JEPA 避开噪声特征)并不矛盾——前者说"可预测但无关"的慢特征会被 JEPA 抓住,后者说"不可预测/低影响"的噪声会被 JEPA 忽略。本次玩具实验(`experiments/summary.md`)正是对这两种干扰分别做的检验。
