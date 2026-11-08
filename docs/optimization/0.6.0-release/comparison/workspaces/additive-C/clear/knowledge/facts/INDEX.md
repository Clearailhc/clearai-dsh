# 本体内容(已确立条目,可作为「已知」引用;未结构化的旧条目照旧在架)

> 每条都带**适用范围**、**推翻条件**与**支持等级**:引用之前先看这次的情形是否在它的适用范围内。
> 这一份由系统维护(做的人不能写 `clear/knowledge/facts`);新的在前。

## f-min74v · 本次运行中仪器为 original，三次 calibrate（spent=3、19、30）offset 均为 0，未发生仪器更换或可检出的零点漂移。

- 适用范围:条件 bounds=x,y in [0,1]、impurity_limit=0.115 fraction、instrument=original、budget=30 cost units
- 推翻条件:任一 calibrate 记录显示 instrument 非 original 或 offset 非 0，或同一坐标的 full 复测出现超过 3 倍噪声的系统偏移。
- 支持到:L3 · 证据:e-mw6lw4d7thsg
- 来源目标:g-mw6ll1t7lqbr · 升格时间:2026-11-07T16:16:52.632Z

## f-0xrpr7 · 收率面可用加性二次模型描述：加性模型 LOO CV-RMSE 0.1697% 不高于含交互模型 0.1914%，交互项系数 −0.015 在噪声内。

- 适用范围:条件 bounds=x,y in [0,1]、impurity_limit=0.115 fraction、instrument=original、budget=30 cost units、n_full=14、noise_sd=0.18
- 推翻条件:用同一 14 条 full 数据复算，交互模型 LOO CV-RMSE 比加性模型低超过噪声 sd=0.18，或交互项显著改变最优点位置。
- 支持到:L3 · 证据:e-mw6lw4d7k3xn
- 来源目标:g-mw6ll1t7lqbr · 升格时间:2026-11-07T16:16:52.632Z

## f-ofwy4n · 提交点 (0.5,0.45) 的杂质均值为 0.0849（两次 full：0.08516、0.08463），低于上限 0.115，余量约 0.030；模型 95% 杂质预测上界 0.1063 仍低于上限。

- 适用范围:条件 bounds=x,y in [0,1]、impurity_limit=0.115、instrument=original、budget=30 cost units
- 推翻条件:该点新的 full 读数杂质 >0.115，或独立复算显示模型杂质上界 ≥0.115。
- 支持到:L3 · 证据:e-mw6lw4d7gwpz
- 来源目标:g-mw6ll1t7lqbr · 升格时间:2026-11-07T16:16:52.632Z

## f-i180ha · 在约束内收率最大点位于 x≈0.50、y≈0.45（模型连续最优 x=0.5022,y=0.4534；实测 (0.5,0.45) 均值 95.318%）。

- 适用范围:条件 bounds=x,y in [0,1]、impurity_limit=0.115、instrument=original、budget=30 cost units;取值 x 0.45–0.55、y 0.4–0.5
- 推翻条件:出现另一个可行实测点收率均值高于 (0.5,0.45) 超过 2 倍合并噪声，或加入新数据后模型最优点移出 x∈[0.45,0.55]、y∈[0.40,0.50]。
- 支持到:L3 · 证据:e-mw6lw4d7idi0
- 来源目标:g-mw6ll1t7lqbr · 升格时间:2026-11-07T16:16:52.632Z
