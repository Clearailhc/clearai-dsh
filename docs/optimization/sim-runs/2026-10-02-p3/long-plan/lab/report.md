# 三列数值均值报告

## 数据来源

`lab/raw.csv` 由 `lab/gen_raw.py` 生成:Python `random.Random(20261002)` 固定种子,逐行抽取
a ~ Uniform(0, 100)、b ~ Normal(均值 50, 标准差 10)、c ~ Uniform(-20, 20),每个值保留 2 位小数,
共 3 列 × 20 行,带表头 `a,b,c`。重跑生成脚本得到逐字节相同的文件(sha256 `8cff0eb0…4872`)。

## 均值

由 `python lab/analyze.py` 读 `lab/raw.csv` 计算算术均值并写入 `lab/means.json`(保留 6 位小数)。下表数值从 `lab/means.json` 原样取出:

| 列 | 均值 |
|---|---|
| a | 46.147 |
| b | 52.05 |
| c | 0.3675 |

## 核对方法

用一条不经过 Python、也不读取 `means.json` 的独立路径重算:mawk 一行式

```bash
awk -F, 'NR>1{a+=$1;b+=$2;c+=$3;n++} END{printf "a=%.6f b=%.6f c=%.6f n=%d\n",a/n,b/n,c/n,n}' lab/raw.csv
```

输出 `a=46.147000 b=52.050000 c=0.367500 n=20`。与 `lab/means.json` 逐列比较,三列绝对差均为 0(阈值 1e-6),详见 `lab/check.md`。
