# python3 最小脚本判决

## 结论

- **被推翻:h-no**(h-16hwqu)「python3 不能正常运行 `python3 -c "print(1+1)"`(不存在、或报错)」。
- **被支持:h-ok**(h-oc7e49)「python3 能正常运行 `python3 -c "print(1+1)"` 并输出 2」。

## 依据的观测

唯一一次观测,原始记录在 `lab/python3_observation.txt`(2026-10-02T07:03:11Z UTC):

| 项 | 观测值 |
|---|---|
| 命令 | `python3 -c "print(1+1)"` |
| python3 路径 / 版本 | `/usr/bin/python3` / Python 3.11.15 |
| 退出码 | 0 |
| stdout | `2`(字节 `32 0a`,即 "2" 加换行) |
| stderr | 空 |

## 对照推翻条件

- h-no 的推翻条件「退出码为 0 且标准输出恰为 2」:**命中**(退出码 0,stdout 为 `2`)→ h-no 被推翻。
- h-ok 的推翻条件「python3 不存在、退出码非 0,或标准输出不是 2」:**未命中** → h-ok 成立。

## 复查方法

在同一台机器上重跑 `python3 -c "print(1+1)"; echo "exit=$?"`,应得到 `2` 与 `exit=0`。
