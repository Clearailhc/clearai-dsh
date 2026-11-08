# 目标 g-mw4zfrls4bb8(rev2 · open)
- **一句话**:在 x,y∈[0,1] 内找杂质≤0.115 时收率最高的配方，并用 full 实测验证
- **主张**:在 x,y∈[0,1] 的二维配方空间内，杂质 impurity≤0.115 的约束下，找到收率 yield 最高的配方点，并在剩余 30 单位预算内用 full 模式实测验证该点，写出 submission.json 与参数/仪表口径/局限报告。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  1) submission.json 存在且为 {"x":数值,"y":数值,"evidence":[路径…]}，x、y 均在 [0,1]，evidence 列出的文件均存在且含原始读数；2) 最终点有至少一次 full 模式实测，实测 impurity≤0.115，且其实测 yield 不低于任何其他已测可行点（若低于，须在报告中说明并给出理由）；3) 报告 lab/report.md 写明所用模型与参数、quick/full/calibrate 三种读数的口径关系与校准依据、以及结论的适用范围与局限；4) lab/budget.json 记录每次实验成本，累计≤30。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(4)
- `h-mbl20u` [alive] yield 对 x、y 的响应可用含 x·y 交互项的二次面描述，交互项显著（初始 9 点拟合中 additive 的 LOO 误差远大于 noise_sd=0.18）。
  - 推翻条件:新增离网格点的 full/quick 读数与交互二次面预测的系统偏差超过 3×noise_sd，或 additive 模型在新数据上 LOO 误差反超。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","budget_units":"30","costs":"quick=1, full=3, calibrate=2","initial_design":"3x3 grid at 0.1/0.5/0.9, full mode, noise_sd=0.18 %"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-0kz5kc` [alive] quick 模式在同一 (x,y) 的 yield 读数与 full 模式一致，偏差远小于 0.18% 的测量噪声；因此 quick 可用于筛选候选点。
  - 推翻条件:同一 (x,y) 上 quick 与 full 的 yield 差超过 0.5%（或重复 quick 的离散度显著大于 full），表明 quick 有系统偏差或精度不足。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","budget_units":"30","costs":"quick=1, full=3, calibrate=2","initial_design":"3x3 grid at 0.1/0.5/0.9, full mode, noise_sd=0.18 %"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-4or8f8` [alive] 约束最优可行点位于 x,y 的内部（不在 x=0/1 或 y=0 边界），初始拟合给出约 (0.52,0.55)，预测 yield≈95.3%。
  - 推翻条件:在内部邻域或其他位置的 full 实测出现更高的可行 yield（差>3×noise_sd），或最优落在边界。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","budget_units":"30","costs":"quick=1, full=3, calibrate=2","initial_design":"3x3 grid at 0.1/0.5/0.9, full mode, noise_sd=0.18 %"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-cqnqxo` [alive] impurity 随 y 增大而升高，在 y≈0.9 附近接近或超过 0.115 上限；低 y 区域杂质余量充足。
  - 推翻条件:拟合或新读数显示 impurity 对 y 非单调，或 y≤0.5 处出现 impurity>0.115。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","budget_units":"30","costs":"quick=1, full=3, calibrate=2","initial_design":"3x3 grid at 0.1/0.5/0.9, full mode, noise_sd=0.18 %"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
