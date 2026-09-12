"""
DOCX Raw Dump Extractor (Template)

目的：
- 用“代码”把复杂 DOCX 的段落 + 表格单元格按文档顺序转储为可检索的纯文本/Markdown（raw dump）
- 为 workflow01 的 `products/extracted/process_brief.md` 提供“逐字粘贴”的来源，避免大模型凭空生成

依赖：
  pip install python-docx

用法（示例）：
  python docx_raw_dump_extractor.py \
    --input "/path/to/file.docx" \
    --output "lab/raw_dumps/file.raw_dump.md"

说明：
- 输出文件会保留 block 顺序（paragraph/table），并标注 style 与索引
- 你可以在输出里搜索“流程叙述/流程概述/Process Description”等关键词，再逐字复制目标段落到 `products/extracted/process_brief.md`
"""

from __future__ import annotations

import argparse
import os
from typing import Iterator, List, Union

from docx import Document
from docx.oxml.table import CT_Tbl
from docx.oxml.text.paragraph import CT_P
from docx.table import Table
from docx.text.paragraph import Paragraph

Block = Union[Paragraph, Table]


def iter_block_items(doc: Document) -> Iterator[Block]:
    """
    Iterate over document blocks (paragraphs and tables) in order.
    Ref: python-docx does not provide a built-in ordered iterator.
    """
    body = doc.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, doc)
        elif isinstance(child, CT_Tbl):
            yield Table(child, doc)


def table_to_markdown(table: Table, max_cell_chars: int = 500) -> str:
    rows: List[List[str]] = []
    for r in table.rows:
        row: List[str] = []
        for c in r.cells:
            txt = "\n".join(p.text.strip() for p in c.paragraphs if p.text and p.text.strip())
            txt = txt.replace("|", "\\|")
            if len(txt) > max_cell_chars:
                txt = txt[: max_cell_chars - 3] + "..."
            row.append(txt)
        rows.append(row)

    if not rows:
        return ""

    col_count = max(len(r) for r in rows)
    for r in rows:
        if len(r) < col_count:
            r.extend([""] * (col_count - len(r)))

    header = rows[0]
    sep = ["---"] * col_count
    body = rows[1:] if len(rows) > 1 else []

    def fmt_row(r: List[str]) -> str:
        return "| " + " | ".join(r) + " |"

    lines = [fmt_row(header), fmt_row(sep)]
    lines.extend(fmt_row(r) for r in body)
    return "\n".join(lines)


def dump_docx(input_path: str) -> str:
    doc = Document(input_path)
    out: List[str] = []
    out.append("# DOCX Raw Dump\n")
    out.append(f"- source: `{input_path}`")
    out.append("")

    p_idx = 0
    t_idx = 0
    for b in iter_block_items(doc):
        if isinstance(b, Paragraph):
            text = (b.text or "").rstrip()
            if not text.strip():
                continue
            p_idx += 1
            style = getattr(getattr(b, "style", None), "name", "") or "UnknownStyle"
            out.append(f"## [P{p_idx:05d}] style={style}")
            out.append(text)
            out.append("")
        else:
            t_idx += 1
            out.append(f"## [T{t_idx:05d}] table")
            md = table_to_markdown(b)
            if md.strip():
                out.append(md)
            else:
                out.append("_<empty table>_")
            out.append("")

    return "\n".join(out).strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Input .docx path")
    ap.add_argument("--output", required=True, help="Output .md path")
    args = ap.parse_args()

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    content = dump_docx(input_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"OK: wrote raw dump to {output_path}")


if __name__ == "__main__":
    main()

