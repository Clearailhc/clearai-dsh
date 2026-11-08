# 目标 g-mw6ll1t7lqbr(rev3 · achieved)
- **一句话**:在 x,y∈[0,1]、杂质≤0.115 的约束下找到收率最大的工艺点，用 full 模式复测验证，并提交 submission.json 与参数/仪表/局限报告
- **主张**:在 x,y∈[0,1]、杂质≤0.115 的约束下找到收率最大的工艺点，用 full 模式复测验证，并提交 submission.json 与参数/仪表/局限报告。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  submission.json 存在，含 x∈[0,1]、y∈[0,1] 与均存在的 evidence 路径；提交点至少有 2 次 full 原始读数且杂质均≤0.115；report.md 写明模型参数、仪表口径与局限；实验总花费≤30 且原始读数保留在 lab/。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(4)
- `h-3x198v` [alive] 在约束内收率最大点位于 x≈0.50、y≈0.45（模型连续最优 x=0.5022,y=0.4534；实测 (0.5,0.45) 均值 95.318%）。
  - 推翻条件:出现另一个可行实测点收率均值高于 (0.5,0.45) 超过 2 倍合并噪声，或加入新数据后模型最优点移出 x∈[0.45,0.55]、y∈[0.40,0.50]。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115","instrument":"original","budget":"30 cost units"},"ranges":{"x":[0.45,0.55],"y":[0.4,0.5]}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-ojabk8` [alive] 提交点 (0.5,0.45) 的杂质均值为 0.0849（两次 full：0.08516、0.08463），低于上限 0.115，余量约 0.030；模型 95% 杂质预测上界 0.1063 仍低于上限。
  - 推翻条件:该点新的 full 读数杂质 >0.115，或独立复算显示模型杂质上界 ≥0.115。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115","instrument":"original","budget":"30 cost units"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-zsq1f7` [alive] 收率面可用加性二次模型描述：加性模型 LOO CV-RMSE 0.1697% 不高于含交互模型 0.1914%，交互项系数 −0.015 在噪声内。
  - 推翻条件:用同一 14 条 full 数据复算，交互模型 LOO CV-RMSE 比加性模型低超过噪声 sd=0.18，或交互项显著改变最优点位置。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","instrument":"original","budget":"30 cost units","n_full":"14","noise_sd":"0.18"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-kh6r4a` [alive] 本次运行中仪器为 original，三次 calibrate（spent=3、19、30）offset 均为 0，未发生仪器更换或可检出的零点漂移。
  - 推翻条件:任一 calibrate 记录显示 instrument 非 original 或 offset 非 0，或同一坐标的 full 复测出现超过 3 倍噪声的系统偏移。
  - scope: {"conditions":{"bounds":"x,y in [0,1]","impurity_limit":"0.115 fraction","instrument":"original","budget":"30 cost units"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
