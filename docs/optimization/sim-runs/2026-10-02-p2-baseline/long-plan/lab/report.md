# 数据小链报告:3 列 × 20 行数值的列均值

## 数据怎么来的

`lab/raw.csv` 由 `lab/gen_raw.py` 生成:Python `random.Random(42)`(固定种子),每行依次抽取
a ~ Uniform(0, 100)、b ~ Normal(50, 10)、c ~ Uniform(-20, 20),各保留 2 位小数。
文件为 1 行表头 `a,b,c` + 20 行数据,共 363 字节;连续两次运行的 md5 都是 `c787f807271a69c6564434cd76d4ea61`,可逐字节复现。

## 均值

由 `lab/analyze.py` 计算(csv 模块逐列求算术平均,round 到 6 位小数),原值写在 `lab/means.json`(n = 20):

| 列 | 均值 |
|---|---|
| a | 52.253 |
| b | 50.772 |
| c | -1.9255 |

## 怎么核对的

用一条不经过 Python 的独立路径复算:awk 一行式
`awk -F, 'NR>1{a+=$1;b+=$2;c+=$3;n++} END{printf "%d %.6f %.6f %.6f\n", n, a/n, b/n, c/n}' lab/raw.csv`,
输出 `20 52.253000 50.772000 -1.925500`。在 6 位小数下,n 和三列均值与 `lab/means.json` 逐列一致,详表见 `lab/check.md`。
这次核对由系统的独立评估者判为支持(L3)。
