# 均值独立核对

## 两条路径

- **路径 A(主路径)**:`python lab/analyze.py`——Python 标准库 `csv.DictReader` 逐行累加,均值保留 6 位小数,写入 `lab/means.json`。
  (原计划用 pandas,环境中没有 pandas,改为标准库;计算语义相同。)
- **路径 B(独立路径)**:不经 Python,直接用 awk(mawk 1.3.4)读 `lab/raw.csv` 重算,命令原文:

```bash
awk -F, 'NR>1{a+=$1;b+=$2;c+=$3;n++} END{printf "n=%d a=%.6f b=%.6f c=%.6f\n",n,a/n,b/n,c/n}' lab/raw.csv
```

  输出:`n=20 a=10.066165 b=41.681055 c=3.350000`

- 路径 A 的值也不经 Python 读取:`grep -E '"(a|b|c)"' lab/means.json` 取出后与 awk 结果按列名 `join`,差值由 awk 计算。

## 逐列对照

| 列 | analyze.py(means.json) | awk 复算 | 绝对差 | 判定(阈值 1e-6) |
|---|---|---|---|---|
| a | 10.066165 | 10.066165 | 0.0e+00 | 一致 |
| b | 41.681055 | 41.681055 | 0.0e+00 | 一致 |
| c | 3.35 | 3.350000 | 0.0e+00 | 一致 |

## 结论

3 列中 3 列差值 ≤ 1e-6(means.json 里 c 写作 `3.35`,即 3.350000)。两条路径样本数均为 n=20。
