# 仪表口径与校准（第 1 步）

## 三种模式的实际输出

| 模式 | 成本 | 输出字段 | 备注 |
|---|---|---|---|
| quick | 1 | x,y,value,impurity,instrument="original",mode="quick",noise_sd=0.45 | 单次读数噪声约为 full 的 2.5 倍 |
| full | 3 | 同上，noise_sd=0.18 | 初始 9 点与最终验证都用它 |
| calibrate | 2 | instrument, metric, offset, unit（无 x/y 读数） | 只给校正信息，不能当测量值 append |

## 同点对照：(0.5, 0.5)

- full（initial.json）：yield = 95.2917 %，impurity = 0.08670，noise_sd = 0.18
- quick（lab/probe-quick.json）：yield = 95.3754 %，impurity = 0.08808，noise_sd = 0.45
- 差值：yield +0.0836 个百分点；impurity +0.00138 分数。

该差值小于一次 full 的噪声（0.18），也远小于 quick 自身噪声（0.45），与“同一台 original 仪器、无系统偏移”一致。quick 的仪器字段同样是 `original`，所以 quick 不是另一套分析通道，而是同一读数的低精度快照。

## calibrate 记录

两次调用（实验开始前与全部测量结束后）：

```json
{"instrument": "original", "metric": "yield", "offset": 0, "unit": "normalized x"}
```

- offset 两次均为 0，说明本次会话内未发现 yield 通道的可加偏移或漂移。
- `unit` 为 `normalized x`，即校正量按归一化配方坐标 x 报告；0 表示不需要对读数做平移。
- calibrate 只覆盖 yield，不覆盖 impurity，也不给标准值、不确定度或重复性；因此它只能支持“无平移”的结论，不能用来修正数据。

## 对后续分析的口径约定

1. 只有 full 读数进入最终结论；quick 仅用于低成本的区域筛选。
2. 拟合时按模式加权：full 权重 1/0.18²，quick 权重 1/0.45²（见 lab/fit_weighted.py）。
3. method/response_surface.py 不区分模式；把 quick 追加进去后，它会把 quick 读数当普通观测参与无权重拟合，甚至把 quick 点列进 `best_measured`。本任务不把该字段当验证结论（实例：追加 quick 后 model-1 的 best_measured 是 (0.6,0.6) 的 quick 读数 95.557）。
4. 若后续更换仪器，需要重新 calibrate，不能沿用本次 offset=0。

## 局限

- 只有一个校准点、两次调用，无法排除与设定相关的偏差；
- 没有独立标准样，offset=0 是仪器自报值；
- quick 的 impurity 噪声未单独标定（同点差 0.0014，约为 full 杂质残差的 2 倍），所以 quick 杂质只用于看趋势；
- 本会话未更换仪器。
