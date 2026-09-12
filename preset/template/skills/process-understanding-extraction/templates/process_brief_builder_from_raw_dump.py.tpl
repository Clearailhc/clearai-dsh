"""
Process Brief Builder (Template)

目标：
- 从 docx raw dump（由 `lab/scripts/docx_raw_dump_extractor.py` 生成）中按 range 抽取原文块
- 自动生成 `products/extracted/process_brief.md`，把“原文摘录”区域由代码填充
- 从机制上避免大模型在对话中“逐字输出原文”

依赖：
  Python 3.x (标准库即可)

用法（示例）：
  python process_brief_builder_from_raw_dump.py \
    --raw-dump "lab/raw_dumps/sop.raw_dump.md" \
    --range "P00376-P00420" \
    --source-file "input/xxx.docx" \
    --target-section "5.2.2 流程叙述（第24页）" \
    --output "products/extracted/process_brief.md"

说明：
- raw dump block 的标题格式来自 `docx_raw_dump_extractor.py`：`## [P00001] style=...` 或 `## [T00001] table`
- range 支持：
  - P 起止：P00376-P00420
  - T 起止：T00012-T00019
  - 单点：P00376
  - 混合范围暂不支持（需要时可拆两次追加或扩大范围）
"""

from __future__ import annotations

import argparse
import os
import re
from dataclasses import dataclass
from typing import List, Optional, Tuple


BLOCK_RE = re.compile(r"^## \[(?P<kind>[PT])(?P<idx>\d{5})\].*$")


@dataclass
class Block:
    kind: str  # 'P' or 'T'
    idx: int
    header_line: str
    lines: List[str]


def parse_raw_dump(md_text: str) -> List[Block]:
    lines = md_text.splitlines()
    blocks: List[Block] = []
    cur: Optional[Block] = None

    for line in lines:
        m = BLOCK_RE.match(line.strip())
        if m:
            if cur is not None:
                blocks.append(cur)
            cur = Block(
                kind=m.group("kind"),
                idx=int(m.group("idx")),
                header_line=line,
                lines=[],
            )
            continue
        if cur is not None:
            cur.lines.append(line)

    if cur is not None:
        blocks.append(cur)
    return blocks


def parse_range(rng: str) -> Tuple[str, int, int]:
    s = rng.strip()
    if "-" in s:
        a, b = s.split("-", 1)
        kind_a, idx_a = a[0].upper(), int(a[1:])
        kind_b, idx_b = b[0].upper(), int(b[1:])
        if kind_a != kind_b:
            raise ValueError("Mixed kind range is not supported. Use Pxxxxx-Pyyyyy or Txxxxx-Tyyyyy.")
        if idx_b < idx_a:
            raise ValueError("Range end must be >= start.")
        return kind_a, idx_a, idx_b
    kind, idx = s[0].upper(), int(s[1:])
    return kind, idx, idx


def extract_blocks(blocks: List[Block], kind: str, start: int, end: int) -> List[Block]:
    selected = [b for b in blocks if b.kind == kind and start <= b.idx <= end]
    if not selected:
        raise ValueError(f"No blocks matched range {kind}{start:05d}-{kind}{end:05d}.")
    return selected


def build_process_brief(
    *,
    source_file: str,
    target_section: str,
    raw_dump_path: str,
    raw_dump_range: str,
    extraction_method: str,
    excerpt_blocks: List[Block],
) -> str:
    excerpt_lines: List[str] = []
    for b in excerpt_blocks:
        excerpt_lines.append(b.header_line)
        excerpt_lines.extend(b.lines)
        excerpt_lines.append("")

    excerpt_text = "\n".join(excerpt_lines).strip()

    return f"""# 流程简介 (Process Brief)

<!-- GENERATED_BY: process_brief_builder_from_raw_dump.py -->

## 1. 定位信息

- **目标文件**：{source_file}
- **目标章节**：{target_section}
- **代码抽取产物（raw dump）路径**：{raw_dump_path}
- **raw dump 定位范围**：{raw_dump_range}
- **抽取方式**：{extraction_method}
- **定位证据**：见 raw dump block 标题（P/T 编号 + style/table）

---

## 2. 原文摘录（由代码填充，禁止手工改写）

> **硬规则**：本区域为“代码从 raw dump 抽取的逐字原文”。禁止大模型在对话中逐字输出原文、禁止人工改写替换。

```text
{excerpt_text}
```

---

## 3. AI 摘要（可选）

（可选，需明确标注为摘要；禁止与原文混排）

---

## 4. 疑点清单

| 序号 | 疑点/缺口 | 影响范围 | 建议下一步 |
|------|-----------|----------|-----------|
| 1 |  |  |  |

---

## 5. 补充证据 / 控制逻辑摘要（可选）

（允许，但必须标注来源与性质：补充证据，非流程叙述）

---

## 6. 确认记录（闸门）

- **确认日期**：
- **确认人**：
- **"原文摘录"是否由代码生成**：[ ] 是 / [ ] 否（若否，不合格，必须回退用代码生成）
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dump", required=True, help="Path to raw dump markdown")
    ap.add_argument("--range", required=True, help="Block range, e.g. P00376-P00420")
    ap.add_argument("--source-file", required=True, help="Original doc path")
    ap.add_argument("--target-section", required=True, help="Target section name/page")
    ap.add_argument("--output", required=True, help="Output process_brief.md path")
    ap.add_argument("--extraction-method", default="code_raw_dump", help="Extraction method label")
    args = ap.parse_args()

    raw_dump_path = os.path.abspath(args.raw_dump)
    with open(raw_dump_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    blocks = parse_raw_dump(md_text)
    kind, start, end = parse_range(args.range)
    excerpt_blocks = extract_blocks(blocks, kind, start, end)

    content = build_process_brief(
        source_file=args.source_file,
        target_section=args.target_section,
        raw_dump_path=args.raw_dump,
        raw_dump_range=args.range,
        extraction_method=args.extraction_method,
        excerpt_blocks=excerpt_blocks,
    )

    out_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"OK: wrote {out_path}")


if __name__ == "__main__":
    main()

