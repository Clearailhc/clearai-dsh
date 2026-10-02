# python3 最小脚本判定

## 结论

- **被推翻的假设:h-no**(h-9xy95a,「python3 不能正常运行 `python3 -c "print(1+1)"`」)。
- **成立的假设:h-ok**(h-6qlsol,「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」)。

## 依据的观测

唯一一次观测,原始记录在 `lab/python3_observation.txt`(2026-10-02T01:40:11Z):

| 项 | 观测值 |
|---|---|
| 命令 | `python3 -c "print(1+1)"` |
| python3 路径 | `/usr/local/bin/python3` |
| 版本 | Python 3.11.15 |
| 退出码 | 0 |
| stdout | `2` |
| stderr | (空) |

## 判定规则(观测前写定)与对照

- h-no 的推翻条件:退出码为 0 且 stdout 恰为 `2` → 观测满足(0、`2`),**h-no 被推翻**。
- h-ok 的推翻条件:python3 不存在、退出码非 0、或 stdout 不是 `2` → 三项均未出现,**h-ok 成立**。

复查方法:在同一台机器上重跑 `python3 -c "print(1+1)"; echo $?`。
