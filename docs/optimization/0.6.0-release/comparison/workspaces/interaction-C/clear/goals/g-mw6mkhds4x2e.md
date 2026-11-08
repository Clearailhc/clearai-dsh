# 目标 g-mw6mkhds4x2e(rev2 · achieved)
- **一句话**:在 x,y∈[0,1] 内把收率(yield)做到最大,同时杂质(impurity)不超过 0.115,总实验预算 ≤30 单位
- **主张**:在 x,y∈[0,1] 内把收率(yield)做到最大,同时杂质(impurity)不超过 0.115,总实验预算 ≤30 单位;最终点须有 full 模式实测读数,结果写入 submission.json。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  submission.json 存在且含数值 x,y 与 evidence 路径列表(每条指向保留的原始读数文件);所列最终点有 full 模式实测读数且 impurity≤0.115;累计花费(含 calibrate/quick/full)≤30;报告给出参数、仪表口径(calibrate offset、quick/full 噪声)与局限。清点项:evidence 路径文件全部存在,至少一条为 full 模式。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(3)
- `h-exjsfx` [alive] 收率在 (x,y)≈(0.49,0.49) 附近取最大,交互二次面峰值预测约 95.3%,实测最优点应落在 x∈[0.4,0.6]、y∈[0.4,0.6]。
  - 推翻条件:在 x∈[0.4,0.6]、y∈[0.4,0.6] 之外找到实测收率高于中心区域最优点且杂质≤0.115的点(差值超过噪声)。
  - scope: {"conditions":{"变量范围":"x,y∈[0,1]","杂质上限":"0.115","预算":"30 单位","仪表":"original"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-vfvblr` [alive] 在最优点附近杂质约 0.088–0.10,约束 0.115 不绑定,最优化不需要为杂质牺牲收率。
  - 推翻条件:最优点实测杂质 >0.10,或为满足杂质上限必须把 y 压低 0.05 以上并因此损失收率。
  - scope: {"conditions":{"变量范围":"x,y∈[0,1]","杂质上限":"0.115","预算":"30 单位","仪表":"original"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-5fwi2k` [alive] quick 模式与 full 模式对同一 (x,y) 的收率读数无系统偏差,仅噪声更大(sd 0.45 vs 0.18),可混用于拟合。
  - 推翻条件:同点 quick-full 配对差 |Δ| 持续超过 2 倍合并噪声(约 0.9),或 calibrate 显示仪表偏移需要校正。
  - scope: {"conditions":{"变量范围":"x,y∈[0,1]","杂质上限":"0.115","预算":"30 单位","仪表":"original"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
