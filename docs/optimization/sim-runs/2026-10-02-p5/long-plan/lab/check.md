# 均值独立核对

## 两条路径

- **路径 1(主路径)**:`python3 lab/analyze.py` —— Python `csv.DictReader` 读 `lab/raw.csv`,每列 `sum/len`,`round(…, 6)`,写入 `lab/means.json`。
- **路径 2(独立路径)**:bash + awk 一行式,不调用 Python、不读 analyze.py 的任何代码,直接从 `lab/raw.csv` 逐列累加再除以行数:

  ```bash
  awk -F, 'NR>1 && NF==3 {for(i=1;i<=3;i++) s[i]+=$i; n++} END{printf "%.6f %.6f %.6f %d", s[1]/n, s[2]/n, s[3]/n, n}' lab/raw.csv
  ```

  原始输出:`56.945500 49.301000 5.300000 20`

- **对照方式**:`lab/means.json` 的值用 sed 取出、bash `printf '%.6f'` 统一到 6 位小数后,与 awk 结果做逐字符字符串比较(`[ "$x" = "$y" ]`)。

## 结果

| 列 | 路径 1:lab/means.json | 路径 2:awk | 6 位小数是否一致 |
|---|---|---|---|
| a | 56.945500 | 56.945500 | 一致 |
| b | 49.301000 | 49.301000 | 一致 |
| c | 5.300000 | 5.300000 | 一致 |
| 行数 n | 20 | 20 | 一致 |

## 结论

3 列两条路径的均值在 6 位小数上全部相同。

生成时间:2026-10-02T07:16:02Z
