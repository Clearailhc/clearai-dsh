结论:紧凑 JSON 更小。两份文件内容相同,紧凑写法 1212 字节,缩进写法 2109 字节。目标已结案(achieved),独立评估者逐段数过字节，确认三条判据都满足。

**① 路线 compact(route-compact,已交付)**
- 观测：用 `lab/scripts/gen_compact.py` 生成 @lab/compact/data.json(`separators=(',', ':')`),`wc -c` 量得 1212 字节，和 @lab/compact/size.txt 的读数一致。
- 判据对照：文件存在且是合法 JSON;size.txt 是整数，等于实际字节数。达标。

**② 路线 pretty(route-pretty,已交付)**
- 观测：用 `lab/scripts/gen_pretty.py` 生成 @lab/pretty/data.json(`indent=2`),`wc -c` 量得 2109 字节，和 @lab/pretty/size.txt 的读数一致。
- 判据对照：文件存在且是合法 JSON,解析后和 compact 版数据完全相等;size.txt 和实际字节数一致。达标。
- 两条路线共用 `lab/scripts/sample_data.py` 生成同一份数据，各写各的产物路径。本环境没有原生子任务，所以在同一条 Bash 命令里把两个脚本放到后台同时跑。

**③ 对照(compare,L2,已交付)**
- 观测:`lab/scripts/compare.py` 读两份 size.txt,写出 @lab/winner.txt:
  ```
  compact
  compact=1212 bytes, pretty=2109 bytes
  ```
- 判据对照：正好两行，第一行写的是字节数更小的那种写法，第二行的两个数和两份 size.txt 一致。达标。
- 假设结果:
  - h-compact(h-n502e9):成立(support)。1212 小于 2109,没有触发推翻条件。
  - h-pretty(h-y8a2c9):不成立(refute)。2109 大于等于 1212,触发了推翻条件。

**收尾**
- 计划已用 ClosePlan 收束，系统归档在 `clear/goals/plans/p-muqm4g9g7cql.md`。
- 结案时，评估者对多出的 897 字节逐项核对：冒号后的空格 87 个，换行 134 个，缩进空格 676 个，加起来正好是 897。
- h-compact 只到了 L2,没达到升格门槛(默认 L3),所以没有升格成事实。

### 交付物
- @lab/winner.txt:结论文件，第一行是更小的写法，第二行是两份文件的字节数
- @lab/compact/data.json、@lab/compact/size.txt:紧凑写法的 JSON 与字节数读数
- @lab/pretty/data.json、@lab/pretty/size.txt:缩进写法的 JSON 与字节数读数
- @lab/scripts/:生成和对照用的脚本，可以重跑复核
