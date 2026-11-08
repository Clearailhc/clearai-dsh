# 阶段归档 · p-mw4yh6zowacy

- 收束时间:2026-11-06T12:47:17.781Z
- 所属目标:g-mw4yfrsjmxa9
- 收束之辞:完成响应面比较与提交点验证。9 条 initial full 读数拟合:加性 CV RMSE 0.187≈噪声 0.18,交互模型 0.276 更差,判定加性二次曲面可用;连续最优 (0.5077,0.4528),预测 95.31%。仪表核对:calibrate 返回 original/offset 0;(0.5,0.5) full 复核与 initial 同点差 −0.078<3σ=0.54。在 (0.508,0.452) 做两次 full:95.406 / 95.517,杂质 0.08393 / 0.08445,仪表均为 original;两次差 0.111<0.54。12 点重拟合仍选加性(CV 0.190),最优不变。总花费 12/30,余 18 未花(曲率平,加测无法改进选点)。submission.json 与 reports/final-report.md 已交付;initial.json 未改写。未采信候选:交互曲面(CV 更差)、quick 读数入模(噪声口径不同)、[0,1] 边界外推(无实测)。

## 步骤
- [advanced] 1. 核对仪表基线与预算台账:读取已完成的 calibrate 与 (0.5,0.5) quick 记录,与 initial.json 同点 full 值比较,确认 instrument 与 offset,并写 lab/budget.json。 → lab/calibrate-1.json, lab/quick-0.5-0.5.json, lab/budget.json
- [advanced] 2. 用 method/response_surface.py 对 9 条 initial full 读数拟合加性与交互二次曲面,比较留一交叉验证,给出受限最优候选与预测区间。 → lab/model-initial.json
- [advanced] 3. 在 (0.5,0.5) 做一次 full 实验,与 initial 同点值对照,以 full 精度检验仪表一致性与漂移。 → lab/full-center-1.json
- [advanced] 4. 在模型最优候选 (x≈0.51,y≈0.45) 做一次 full 实验,作为提交点的首次验证。 → lab/full-optimum-1.json
- [advanced] 5. 在提交候选同点再做一次 full 复测,检验重复性与仪表漂移,并用 initial+新 full 读数重拟合曲面。 → lab/full-optimum-2.json, lab/input-final.json, lab/model-final.json
- [advanced] 6. 写 submission.json(仅 x、y、evidence)与 reports/final-report.md,汇总模型参数、仪表口径、预算台账与局限。 → submission.json, reports/final-report.md
