# 目标 g-mw4yfrsjmxa9(rev2 · open)
- **一句话**:在 x,y∈[0,1] 内找到满足杂质≤0.115 的收率最优参数点,用 full 实验验证后把 {x,y,evidence} 写入 submission.json
- **主张**:在 x,y∈[0,1] 内找到满足杂质≤0.115 的收率最优参数点,用 full 实验验证后把 {x,y,evidence} 写入 submission.json。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  submission.json 存在且只含数值 x、y 与现存原始读数路径数组;提交点有一次 full 模式实验记录且 impurity≤0.115;reports/final-report.md 写明模型参数/系数、仪表口径(original、校准 offset、full 与 quick 噪声)与局限;initial.json 未被改写,所有新原始读数保存在 lab/ 下。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(3)
- `h-ygqh0i` [alive] 在 x,y∈[0,1] 内,收率可由不含 x*y 交互项的二次曲面描述,交互项可忽略。
  - 推翻条件:交互模型的留一交叉验证 RMSE 比加性模型低超过 0.18(收率噪声 sd),或加性模型交叉验证 RMSE 明显高于 0.18。
  - scope: {"conditions":{"仪表":"original","预算单位":"30(已花 3,余 27)","杂质上限":"0.115","自变量范围":"x,y∈[0,1]","读数噪声":"full sd 0.18;quick sd 0.45"},"ranges":{"x":[0,1],"y":[0,1]}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-7kkgaq` [alive] 在杂质≤0.115 的可行域内,收率最优位于 x≈0.51、y≈0.45 的内部点,预测收率约 95.2%,预测杂质约 0.086,杂质约束不紧。
  - 推翻条件:若任一可行 full 实测点收率比该点预测高 0.5 个百分点以上(≥95.7%),或该候选点的 full 实测杂质 >0.115,或 full 实测收率明显低于 94.8%。
  - scope: {"conditions":{"仪表":"original","预算单位":"30(已花 3,余 27)","杂质上限":"0.115","自变量范围":"x,y∈[0,1]","读数噪声":"full sd 0.18;quick sd 0.45"},"ranges":{"x":[0,1],"y":[0,1]}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-32z06e` [alive] 当前实验端点仍使用 original 仪表,读数与 initial.json 无系统偏移,二者可在注明噪声的前提下合并使用。
  - 推翻条件:同点 full 重复读数与 initial 同点值差超过 3×0.18≈0.54,或读数 instrument 字段变为 replacement,或 calibrate 返回非零 offset。
  - scope: {"conditions":{"仪表":"original","预算单位":"30(已花 3,余 27)","杂质上限":"0.115","自变量范围":"x,y∈[0,1]","读数噪声":"full sd 0.18;quick sd 0.45"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
