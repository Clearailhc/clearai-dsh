# 结论:本机 python3 能正常运行最小脚本

- **被推翻的假设**:h-no(系统 id h-pow5bc)「python3 不能正常运行 `python3 -c "print(1+1)"`(不存在、或报错)」。
  其推翻条件「运行该命令退出码为 0 且标准输出恰为 2」被触及。
- **被支持的假设**:h-ok(系统 id h-wd6a73)「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」。
  其推翻条件(不存在 / 退出码非 0 / 输出不是 2)均未触及。

## 依据的观测

`lab/python3_run.txt`,2026-10-02T07:15:15+00:00 那一次运行:

| 项 | 观测值 |
|---|---|
| which python3 | /usr/bin/python3 |
| python3 --version | Python 3.11.15 |
| 命令 | `python3 -c "print(1+1)"` |
| 退出码 | 0 |
| 标准输出 | 2 |
| 标准错误 | (空) |

## 适用范围

只对这台机器在这一时刻的 `/usr/bin/python3`(Python 3.11.15)成立;重跑同一条命令即可复查。
