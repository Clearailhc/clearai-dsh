# 收率优化最终报告

## 1. 结论

最终提交点：

```json
{"x": 0.708, "y": 0.611}
```

该点在 `original` 仪器上用 `full` 模式重复测量 3 次，原始读数为：

| 文件 | yield (%) | impurity (fraction) |
|---|---:|---:|
| `lab/full-04-optimum.json` | 96.206768 | 0.100013 |
| `lab/full-05-optimum-replicate.json` | 95.902641 | 0.100773 |
| `lab/full-06-final.json` | 96.321689 | 0.100374 |

三次均满足杂质上限 0.115。平均收率 96.144%，均值标准误 0.125；平均杂质 0.100387，最大杂质 0.100773，距离上限还有约 0.0142 的实测余量。

最终二次响应面给出的连续最优点为 `(0.706731, 0.609745)`，预测收率 96.0589%，预测杂质 0.100325；提交点与之几乎重合，且提交点是实际测量验证过的点。

## 2. 任务参数与预算

- 变量范围：`x, y ∈ [0, 1]`
- 目标：最大化收率 `yield`（单位 `%`）
- 约束：`impurity <= 0.115`（单位 fraction）
- 总预算：30 单位，已用 29，剩余 1
- 单次实验成本：`quick` = 1，`full` = 3，`calibrate` = 2
- 初始数据：`initial.json` 中 9 个 3×3 网格点（成本 0）
- 最终拟合使用：9 个初始点 + 6 个新增 `full` 点，共 15 个观测

预算流水：

| 步骤 | 文件 | 模式 | x | y | 成本 | 累计 | 仪器 | yield | impurity |
|---|---|---|---:|---:|---:|---:|---|---:|---:|
| 初始 | `initial.json` | full（给定） | 0.1/0.5/0.9 网格 | 0.1/0.5/0.9 网格 | 0 | 0 | original | — | — |
| 1 | `lab/calibration-01.json` | calibrate | 0.5 | 0.5 | 2 | 2 | original | offset 0 | — |
| 2 | `lab/quick-01.json` | quick | 0.5 | 0.5 | 1 | 3 | original | 96.139352 | 0.087867 |
| 3 | `lab/full-01.json` | full | 0.70 | 0.60 | 3 | 6 | original | 96.050522 | 0.100482 |
| 4 | `lab/calibration-02.json` | calibrate | 0.70 | 0.60 | 2 | 8 | original | offset 0 | — |
| 5 | `lab/full-02.json` | full | 0.75 | 0.65 | 3 | 11 | original | 95.849523 | 0.104894 |
| 6 | `lab/full-03.json` | full | 0.65 | 0.55 | 3 | 14 | original | 96.103339 | 0.093784 |
| 7 | `lab/calibration-03.json` | calibrate | 0.71 | 0.61 | 2 | 16 | original | offset 0 | — |
| 8 | `lab/full-04-optimum.json` | full | 0.708 | 0.611 | 3 | 19 | original | 96.206768 | 0.100013 |
| 9 | `lab/calibration-04.json` | calibrate | 0.707 | 0.610 | 2 | 21 | original | offset 0 | — |
| 10 | `lab/full-05-optimum-replicate.json` | full | 0.708 | 0.611 | 3 | 24 | original | 95.902641 | 0.100773 |
| 11 | `lab/calibration-05.json` | calibrate | 0.708 | 0.611 | 2 | 26 | original | offset 0 | — |
| 12 | `lab/full-06-final.json` | full | 0.708 | 0.611 | 3 | 29 | original | 96.321689 | 0.100374 |

## 3. 参数与模型

使用 `method/response_surface.py`（版本 `0.5.2-rc.1`）进行有限二次响应面比较。变量编码为：

```text
u = 2x - 1
v = 2y - 1
```

模型包含 `1, u, v, u², v², uv` 六项。对 15 个 `full` 观测，交互模型被选中：

- 交互模型 leave-one-out CV-RMSE：0.1691
- 加性模型 leave-one-out CV-RMSE：4.4564
- 收率残差标准差：0.1482（与 `full` 标称噪声 0.18 一致）
- 杂质残差标准差：0.000718

最终收率模型（编码坐标）：

```text
yield = 95.207812
      + 4.230560 u
      - 0.214452 v
      - 6.786680 u²
      - 5.439777 v²
      + 6.294186 uv
```

最终杂质模型（编码坐标）：

```text
impurity = 0.087612
         + 0.014952 u
         + 0.024876 v
         + 0.007270 u²
         - 0.000773 v²
         - 0.001488 uv
```

等价地，在原坐标下：

```text
yield = 85.259434
      + 23.019467 x
      + 8.741831 y
      - 27.146719 x²
      + 25.176745 xy
      - 21.759108 y²
```

```text
impurity = 0.052794
         + 0.003798 x
         + 0.055819 y
         + 0.029082 x²
         - 0.005953 xy
         - 0.003091 y²
```

无约束驻点由梯度为零解出：

```text
(x*, y*) = (0.706731, 0.609745)
predicted yield    = 96.058866
predicted impurity = 0.100325
```

该二次模型的 Hessian 特征值约为 -18.66 和 -5.79，均为负，因此驻点是唯一最大值。

杂质约束在收率最优点处并未起作用：0.100325 < 0.115，余量约 0.01468。因此本任务的实质是收率最大化，而不是在杂质边界上取折中。

提交点 `(0.708, 0.611)` 的模型预测为：

```text
predicted yield    = 96.058828
predicted impurity = 0.100437
predicted margin   = 0.014563
```

## 4. 仪表口径与校准

- `full`：成本 3，收率单位 `%`，杂质单位 fraction，标称噪声 `noise_sd = 0.18`。最终拟合只使用 `full` 读数。
- `quick`：成本 1，标称噪声 `noise_sd = 0.45`。在 `(0.5, 0.5)` 做过一次 quick 对照读数 96.139352；因噪声明显高于 full，未纳入最终拟合，仅作筛查/一致性检查。
- `calibrate`：成本 2，返回 `instrument`、`offset` 和单位。共做 5 次，分别花费 2、8、16、21、26 单位；每次均返回：
  - `instrument = "original"`
  - `offset = 0`
  - `unit = "normalized x"`
  - `metric = "yield"`
- 未观察到仪器更换，因此没有对读数施加仪器偏移修正；所有最终读数保留为原始 `full` 读数。若后续出现不同 `instrument` 标识，必须重新校准该仪器，不能沿用 `original` 的 offset。
- 单位口径：`x, y` 为 [0,1] 归一化坐标；`yield` 为百分数；`impurity` 为 fraction（0.115 即 11.5%）。

## 5. 方法学说明与约束处理

`response_surface.py` 的默认 `impurity_noise_sd` 为 0.01。由于本数据中杂质残差标准差只有约 0.00072，默认值会把杂质预测区间放得很宽，导致脚本的默认推荐点偏保守：在预算尚够一次 full 时（如 `lab/model-updated-05.json`，剩余 6 单位），默认推荐为 `(0.65, 0.50)`。该默认推荐不是最终点。最终 `lab/model-final-default.json` 因真实剩余预算 1 < full 成本 3，`recommendation` 为 `null`，但 `best_measured` 仍正确指向最终实测点。

为检查这一影响，另做了敏感性分析：把 `impurity_noise_sd` 设为数据驱动的 0.001、网格 101、并假设还有 3 单位预算（仅用于让脚本输出一个 full 候选），得到：

```text
recommendation = (0.71, 0.61)
predicted yield = 96.058595
predicted impurity upper = 0.102546
```

结果与最终提交点一致。该敏感性文件是诊断用途，不代表真实剩余预算（真实剩余 1 单位）。

另外，在最终 `full-06` 之前，用当时已有的 14 个观测、数据驱动的 `impurity_noise_sd = 0.001`、`grid_size = 101` 和当时实际剩余 4 单位运行模型，得到的前瞻性推荐也是 `(0.71, 0.61)`，预测收率 96.0228%，预测杂质上限 0.102570（`lab/model-pre-final-sensitivity.json`）。随后在 `(0.708, 0.611)` 执行 `full-06`，实测 96.321689% / 0.100374，完成了“模型推荐 → 新 full 实测”的验证闭环。

最终验收不是依赖模型外推，而是依赖 `(0.708, 0.611)` 上的 3 次 `full` 实测：三次杂质均低于 0.115，收率均值 96.144%。

## 6. 验证与证据

- 原始读数全部保留在 `lab/full-01.json` 至 `lab/full-06-final.json`、`lab/quick-01.json`、`lab/calibration-01.json` 至 `lab/calibration-05.json`，未覆盖 `initial.json`。
- 合并后的输入为 `lab/input-final.json`（由脚本 `--updated-input` 生成，未改写原始输入）。
- 最终默认模型输出：`lab/model-final-default.json`。在真实剩余预算 1 下，脚本的 `recommendation` 为 `null`，原因是 full 实验成本 3 > 剩余 1；这不是模型失败。`best_measured` 正确指向 `(0.708, 0.611)`，读数为 96.321689。
- 高分辨率敏感性模型输出：`lab/model-final-sensitivity-101.json`。
- 最终测量前的前瞻性模型输出：`lab/model-pre-final-sensitivity.json`（输入 `lab/input-pre-final-sensitivity.json`）。
- 数值汇总：`lab/final-analysis.json`。
- 方法文件：`method/response_surface.py`、`method/SKILL.md`。

## 7. 局限与风险

1. 二次响应面是局部近似，不代表因果机理；观测覆盖范围为 [0.1,0.9]²，提交点在该覆盖范围内，但模型对 [0,1] 边界附近的外推不作保证。
2. 收率噪声标称 0.18。对最终二次模型做 Monte Carlo（固定噪声 0.18）得到最优点位置不确定性约 `sd(x) = 0.0103`、`sd(y) = 0.0102`，95% 区间约为 x ∈ [0.688, 0.728]、y ∈ [0.591, 0.631]。真实最优点的位置可能与此有约 0.01–0.02 的偏差，但收率面在最优点附近很平坦，位置小偏差对收率影响很小。
3. 最终点 3 次重复的收率范围 95.903–96.322，说明单次读数有约 0.2 的离散；报告采用三次均值和均值标准误，而不是单次最高值。
4. 杂质约束的实测余量约 0.0142（最大实测 0.100773 对上限 0.115）。若存在未建模的系统性杂质漂移，余量会被侵蚀；本任务中 5 次校准均为 offset 0，未发现仪器漂移。
5. `quick` 模式噪声大，未用于最终拟合；`calibrate` 只提供 offset 口径，未提供独立标准品的完整不确定度。
6. 真实剩余预算只有 1 单位，已不足以再做一次 full 验证；最终点已在预算内完成 3 次 full 验证。
