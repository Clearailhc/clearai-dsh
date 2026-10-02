# 核对:结论与观测是否一致

核对时间:2026-10-02T07:15:39+00:00。对象:`lab/python3_verdict.md` 对 `lab/python3_run.txt`。

| 项 | lab/python3_run.txt 记录 | lab/python3_verdict.md 所写 | 一致? |
|---|---|---|---|
| 退出码 | 0 | 0 | 一致 |
| 标准输出 | 2 | 2 | 一致 |
| 被推翻假设 | 退出码 0 且输出 2 → 触及 h-no(h-pow5bc)的推翻条件 | 被推翻的是 h-no(h-pow5bc),依据 lab/python3_run.txt | 一致 |

三项都一致。

附:核对时又独立重跑一次 `python3 -c "print(1+1)"`,退出码 0、输出 2,与原观测相同。
