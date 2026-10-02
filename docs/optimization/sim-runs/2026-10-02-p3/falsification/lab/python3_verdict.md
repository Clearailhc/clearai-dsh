# python3 最小脚本判定

## 结论

**被推翻的假设:h-no**(h-qp31il:「python3 不能正常运行 `python3 -c "print(1+1)"`(不存在、或报错)」)。

**得到支持的假设:h-ok**(h-gznu88:「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」)。

## 依据的观测

唯一一次观测:`lab/obs/python3_run.txt`(2026-10-02T06:33:42Z,在 bash 中执行)。

| 项目 | 观测值 |
|---|---|
| 命令 | `python3 -c "print(1+1)"` |
| 解释器 | /usr/local/bin/python3(Python 3.11.15) |
| 退出码 | 0 |
| stdout | `2` |
| stderr | (空) |

## 对照推翻条件

- h-no 的推翻条件:「运行该命令退出码为 0 且标准输出恰为 2」——观测到退出码 0、stdout 恰为 `2`,**条件命中,h-no 被推翻**。
- h-ok 的推翻条件:「python3 不存在、退出码非 0,或标准输出不是 2」——python3 存在、退出码 0、输出为 2,**条件未命中,h-ok 得到支持**。

## 复查方式

在同一台机器上重跑 `python3 -c "print(1+1)"; echo "exit=$?"`,应得到 `2` 与 `exit=0`。
