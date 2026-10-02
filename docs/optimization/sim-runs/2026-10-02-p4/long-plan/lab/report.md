# 数据小链报告:三列均值

## 1. 数据怎么来的

`lab/raw.csv` 由 `lab/scripts/make_raw.py` 生成:Python 标准库 `random.Random(20261002)`(固定种子,重跑逐字节相同,sha256 `3b44822686508a776af92b343d07451a9d93b32459b7df595d92f9d2f4aede2a`)。依次抽取:

| 列 | 生成分布 | 写出精度 |
|---|---|---|
| a | 正态 N(10, 2²),`random.gauss(10, 2)` | 4 位小数 |
| b | 均匀 U[0, 100),`random.uniform(0, 100)` | 4 位小数 |
| c | 1..6 等概率整数(掷骰),`random.randint(1, 6)` | 整数 |

文件为 1 行表头 `a,b,c` + 20 行数据(21 行、355 字节)。环境中没有 numpy / pandas,所以生成与计算都只用标准库。

## 2. 均值是多少

`python lab/analyze.py` 读 `lab/raw.csv`,逐列求和后除以行数(n = 20),保留 6 位小数,写入 `lab/means.json`:

| 列 | 均值 |
|---|---|
| a | 10.066165 |
| b | 41.681055 |
| c | 3.35 |

三列均值都落在事先登记的合理区间内(a ∈ [8.5, 11.5]、b ∈ [35, 65]、c ∈ [2.5, 4.5])。b 比理论值 50 低约 8.3,对 20 个均匀样本来说(均值标准误约 6.5)属正常波动。

## 3. 怎么核对的

用一条不经 Python 的独立路径复算:直接对 `lab/raw.csv` 跑 awk。

```bash
awk -F, 'NR>1{a+=$1;b+=$2;c+=$3;n++} END{printf "n=%d a=%.6f b=%.6f c=%.6f\n",n,a/n,b/n,c/n}' lab/raw.csv
```

输出 `n=20 a=10.066165 b=41.681055 c=3.350000`。与 `lab/means.json` 逐列对照,三列绝对差都是 0(阈值 1e-6),3/3 一致。完整对照表与方法见 `lab/check.md`。

## 复现

```bash
python lab/scripts/make_raw.py   # 重新生成 lab/raw.csv
python lab/analyze.py            # 重新生成 lab/means.json
```
