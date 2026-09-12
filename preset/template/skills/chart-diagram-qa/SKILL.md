---
name: chart-diagram-qa
description: |
  【图表·视觉验收】matplotlib 落盘 lab/diagrams/ 后的 Chart QA 与 CJK 文字验收。适用：含中文标签的图表、信息图、PFD、截图 OCR。不适用：纯文本/代码文件（用 read）；结构化文档（用 read）。
version: 1.0
metadata:
  tier: system
  origin: template
---

# 图表与信息图视觉验收

## 流程

```
setup_cjk（预防） → matplotlib（渲染） → lab/diagrams/*.png → read_image（检测）
```

- **预防**：matplotlib 含中文时先 `setup_cjk()`（`lab/scripts/matplotlib_cjk.py`；代码模板见各 presearch `references/figure_code.md`）。
- **检测**：`read_image`；`prompt` 必填且须具体，禁止 “describe this image”。

## 何时加载

- 刚用 `bash` + matplotlib/seaborn 落盘 `lab/diagrams/`
- 需验收中文标签、排查 □/乱码；若处理 PDF，必须先用 `read`，仅在其明确返回扫描/图片型 PDF 提示且正文为空后，才用 `read_image(page=...)` OCR

## 调用 read_image

| 字段 | 要求 |
|------|------|
| `path` | workspace 相对路径，如 `lab/diagrams/{slug}_revenue_trend.png` |
| `prompt` | 必填；Chart QA 以 `"Chart QA: …"` 开头，列出 transcribe/verify 项并附 **Expected** 标签（标题/轴/图例/实体名） |

Chart QA / CJK 细则与示例句式见工具 schema 中 `read_image` 的 `prompt` 参数说明（与 TOOL_PROTOCOL「精准指令」互补，此处不重复清单）。

## 验收后

| 结果 | 动作 |
|------|------|
| 全部可读 | 报告中引用 PNG，继续下游 |
| □ / 乱码 / 缺字 | matplotlib：查 `setup_cjk()` 后重跑；版式问题：调 figsize/布局后重新生成 |
| 布局截断 | 调 figsize、`bbox_inches='tight'` 或版式参数 |
| 多张图 | 同一轮并行多个 `read_image`（不同 `path`） |
