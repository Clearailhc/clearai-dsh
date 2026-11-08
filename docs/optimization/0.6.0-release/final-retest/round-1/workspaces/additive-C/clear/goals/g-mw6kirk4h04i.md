# 目标 g-mw6kirk4h04i(rev1 · open)
- **一句话**:约束(杂质≤0.115)下用≤30预算找 x,y 的最优收率并实测验证
- **主张**:在 x,y∈[0,1] 内、杂质≤0.115 的约束下最大化收率,用受控实验(总预算30)找出并实测验证一个最优点,交付 submission.json
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  1) submission.json 含 {"x":数值,"y":数值,"evidence":[路径]}，x,y∈[0,1] 且为最终实测点；2) 该点有一次 full 模式原始读数文件保存在 lab/，其实测 impurity≤0.115（fraction）、value 记为收率百分数；3) 所有实验原始读数（quick/full/calibrate）均以独立文件保留，初始 initial.json 未被改写；4) 报告写明拟合模型形式与系数、仪表口径（mode/instrument/单位/噪声）、预算账（≤30）与局限；5) 结论有独立核验记录（ReviewClaims）。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(4)
- `h-qdt9qn` [proposed] 收率面在 x,y∈[0,1] 内可用无交互的二次可加面(x,y,x²,y²)充分描述,交互项在噪声内可忽略
  - 推翻条件:含 x·y 的交互模型 LOO-CV RMSE 比可加模型改善超过噪声 0.18,且交互系数相对其不确定度显著非零
  - scope: {"conditions":{"x_range":"[0,1]","y_range":"[0,1]","impurity_limit":"0.115 fraction","budget":"30 units"},"ranges":{}}
  - uses (framing declarations): []
- `h-uvkpfu` [proposed] 杂质随 y 单调上升(高 y 端触及 0.115 约束),x 的影响较弱
  - 推翻条件:对 9 个初始点与新增点拟合的杂质面中 y 的线性系数 ≤0,或 y=0.9 与 y=0.1 的实测杂质差 <0.01
  - scope: {"conditions":{"x_range":"[0,1]","y_range":"[0,1]","impurity_limit":"0.115 fraction","budget":"30 units"},"ranges":{}}
  - uses (framing declarations): []
- `h-sdvimx` [proposed] quick 模式与 full 模式在同一 (x,y) 的收率读数差在噪声(0.18)内,可用于筛选
  - 推翻条件:同一 (x,y) 的 quick 与 full 收率差 >2×0.18=0.36,或 quick 读数系统性偏移(符号一致且幅度超噪声)
  - scope: {"conditions":{"x_range":"[0,1]","y_range":"[0,1]","impurity_limit":"0.115 fraction","budget":"30 units"},"ranges":{}}
  - uses (framing declarations): []
- `h-iwhrt9` [proposed] 约束最优在 x≈0.75–0.95、y≈0.3–0.5,预测收率 ≥95.5%,且该点杂质 ≤0.115
  - 推翻条件:该区域内候选点的 full 实测收率低于既有最佳实测 95.37%,或实测杂质 >0.115
  - scope: {"conditions":{"x_range":"[0,1]","y_range":"[0,1]","impurity_limit":"0.115 fraction","budget":"30 units"},"ranges":{}}
  - uses (framing declarations): []
