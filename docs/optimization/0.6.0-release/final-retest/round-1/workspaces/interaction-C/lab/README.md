# lab/ 原始读数索引

所有读数均为 `experiment.py` 返回的原始 JSON,未经修改。

| 文件 | 模式 | x | y | value (%) | impurity | 说明 |
|---|---|---|---|---|---|---|
| `calib-1.json` | calibrate | 0.50 | 0.50 | — | — | offset 0, instrument original |
| `q-0.5-0.5.json` | quick | 0.50 | 0.50 | 96.139 | 0.08787 | 参考,噪声 sd 0.45,未纳入拟合 |
| `f-0.5-0.5.json` | full | 0.50 | 0.50 | 95.181 | 0.08828 | (0.5,0.5) 复测 |
| `f-0.6-0.6.json` | full | 0.60 | 0.60 | 95.902 | 0.09522 | |
| `f-0.70-0.60.json` | full | 0.70 | 0.60 | 95.902 | 0.10022 | |
| `f-0.75-0.60.json` | full | 0.75 | 0.60 | 96.184 | 0.10156 | |
| `f-0.8-0.6.json` | full | 0.80 | 0.60 | 95.943 | 0.10281 | |
| `f-0.75-0.65.json` | full | 0.75 | 0.65 | 95.851 | 0.10456 | |
| `f-0.71-0.61.json` | full | 0.71 | 0.61 | 96.322 | 0.10041 | 最优点重复 1 |
| `f-0.71-0.61-r2.json` | full | 0.71 | 0.61 | 96.167 | 0.10139 | 最优点重复 2 |
| `f-0.71-0.61-r3.json` | full | 0.71 | 0.61 | 96.455 | 0.10086 | 最优点重复 3 |

初始 9 个 full 读数在 `../initial.json`。

派生文件(非原始读数):`input-initial.json`、`input-updated.json`、`input-final.json`、`input-all.json`、`model-*.json`、`verification.json`、`verify_final.py`。
