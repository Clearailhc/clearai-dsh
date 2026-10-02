# python3 最小脚本判定

## 结论

- **被推翻:h-no(h-lw3zkq)**「python3 不能正常运行 `python3 -c "print(1+1)"`(不存在、或报错)」。
  其推翻条件「执行该命令退出码为 0 且标准输出恰为 2」被这次观测碰到。
- **被支持:h-ok(h-z3iv4e)**「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」。
  其推翻条件(python3 不存在 / 退出码非 0 / 标准输出不是 2)均未出现。

## 依据的观测

唯一一次观测,原始记录在 `lab/data/python3_run.txt`(2026-10-02T06:59:34Z,计划步 s1-observe):

| 项 | 观测值 |
|---|---|
| 命令 | `python3 -c "print(1+1)"` |
| python3 路径 | `/usr/bin/python3` |
| 版本 | Python 3.11.15 |
| 退出码 | 0 |
| stdout | `2` |
| stderr | (空) |

## 复查方法

在同一台机器上执行 `python3 -c "print(1+1)"; echo $?`,应输出 `2` 与 `0`。
