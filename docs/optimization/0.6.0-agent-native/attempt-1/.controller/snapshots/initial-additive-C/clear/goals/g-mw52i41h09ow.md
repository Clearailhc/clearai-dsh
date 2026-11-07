# 目标 g-mw52i41h09ow(rev2 · open)
- **一句话**:在 x,y∈[0,1] 内、杂质≤0.115 的约束下找到收率最高的配方点，并用 full 测量验证，写入 submission.json
- **主张**:在 x,y∈[0,1] 内、杂质≤0.115 的约束下找到收率最高的配方点，并用 full 测量验证，写入 submission.json。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  submission.json 存在且含 x、y 数值与 evidence 路径列表；最终点有一次 full 原始读数（value 为收率%、impurity 为分数）且 impurity≤0.115；该 full 收率不低于初始 9 点中最好的 94.693%；报告写明模型参数、仪表口径与局限。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(4)
- `h-173dc0` [proposed] 收率响应面在 x,y 上近似加性二次，交互项可忽略
  - 推翻条件:补充测量后交互模型的留一交叉验证误差比加性模型低出噪声 sd=0.18 以上
  - scope: {"conditions":{"范围":"x,y∈[0,1]","杂质上限":"0.115","总预算":"30"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-dfrfe9` [proposed] 可行域内收率最大点在 (0.45,0.45) 附近，full 读数约 94.9%
  - 推翻条件:在 (0.45,0.45) 附近 full 测量收率低于已测最佳 94.693% 或明显低于预测区间下界
  - scope: {"conditions":{"范围":"x,y∈[0,1]","杂质上限":"0.115","总预算":"30"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-gux36c` [proposed] 预测最优点 (0.45,0.45) 的杂质约 0.085，远低于 0.115，约束不活跃
  - 推翻条件:该点及其邻域实测杂质超过 0.115
  - scope: {"conditions":{"范围":"x,y∈[0,1]","杂质上限":"0.115","总预算":"30"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-r2abbn` [proposed] quick 模式与 full 模式读数之间存在系统性偏差（或噪声更大），需校准后才能混用
  - 推翻条件:同一批点的 quick 与 full 读数差值在噪声 sd=0.18 以内且无系统方向
  - scope: {"conditions":{"范围":"x,y∈[0,1]","杂质上限":"0.115","总预算":"30"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
