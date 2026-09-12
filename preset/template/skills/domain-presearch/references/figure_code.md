# 领域背景预研可视化 — 完整代码与图示（按需加载）

通过 `bash` 跑 python 生成；图表统一落盘 `lab/diagrams/{topic_slug}_*.png`（**禁止**写入 `products/reports/` 或报告同目录），有数据才生成、不强求。将下方示例中的 `{topic_slug}` 替换为实际 slug（如 `protein-structure-prediction`）。

## ASCII 结构图兜底示例（无图像生成 API 时）
```
=== 领域结构图 (ASCII) ===
[理论基础A]──┐
             ├─→ [核心问题] ──→ [方法路线1] ──→ [基准评测] ──→ [下游应用]
[数据来源B]──┘        │
                 [方法路线2]
```

## matplotlib 图表代码（可直接套用，按需改数据）
```python
import sys
sys.path.insert(0, "lab/scripts")
from matplotlib_cjk import setup_cjk
setup_cjk()
import matplotlib.pyplot as plt

# === 方法占比饼图 ===
labels = ['Method A', 'Method B', 'Method C', 'Method D', 'Others']
sizes = [23, 18, 15, 12, 32]
colors = ['#003366', '#336699', '#6699CC', '#99CCFF', '#CCCCCC']
fig, ax = plt.subplots(figsize=(8, 6))
ax.pie(sizes, labels=labels, colors=colors, autopct='%1.1f%%', startangle=90)
ax.set_title('Method Share in Recent Publications (2025)', fontsize=14, fontweight='bold')
plt.savefig('lab/diagrams/{topic_slug}_method_share.png', dpi=150, bbox_inches='tight')
plt.close()

# === 发文趋势柱状图 ===
years = ['2020', '2021', '2022', '2023', '2024', '2025']
papers = [121, 145, 163, 166, 187, 210]
fig, ax = plt.subplots(figsize=(10, 5))
bars = ax.bar(years, papers, color=['#003366','#003366','#003366','#336699','#6699CC','#99CCFF'])
for bar, val in zip(bars, papers):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 2, f'{val}', ha='center')
ax.set_ylabel('Publications', fontsize=12)
ax.set_title('Publication Trend', fontsize=14, fontweight='bold')
ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
plt.savefig('lab/diagrams/{topic_slug}_publication_trend.png', dpi=150, bbox_inches='tight')
plt.close()

# === 瓶颈构成饼图 ===
cost_labels = ['Data Scarcity', 'Compute Cost', 'Reproducibility', 'Evaluation Gap', 'Theory Gap', 'Other']
cost_sizes = [42.8, 15.5, 18.0, 12.0, 5.5, 6.2]
fig, ax = plt.subplots(figsize=(8, 6))
ax.pie(cost_sizes, labels=cost_labels, colors=['#E69F00','#56B4E9','#009E73','#F0E442','#0072B2','#D55E00'], autopct='%1.1f%%')
ax.set_title('Bottleneck Composition', fontsize=14, fontweight='bold')
plt.savefig('lab/diagrams/{topic_slug}_bottleneck_composition.png', dpi=150, bbox_inches='tight')
plt.close()

# === 基准指标演进 ===
fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(years, [42.0,48.5,55.8,62.5,70.2,78.4], 'o-', color='#003366', linewidth=2, label='Benchmark Best(%)')
ax.plot(years, [15.0,18.2,20.5,21.5,22.4,24.1], 's-', color='#009E73', linewidth=2, label='Baseline(%)')
ax.set_ylabel('Score (%)', fontsize=12)
ax.set_title('Benchmark Progress', fontsize=14, fontweight='bold')
ax.legend(frameon=False)
ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
plt.savefig('lab/diagrams/{topic_slug}_benchmark_trend.png', dpi=150, bbox_inches='tight')
plt.close()
```

**生成规则**：有对应数据就生成对应图表，不强求。图表存入 `lab/diagrams/{topic_slug}_*.png`。

## 报告中引用图表

报告位于 `products/reports/{topic_slug}_domain_report.md` 时，引用 `lab/diagrams/` 下图表须使用 `../../lab/diagrams/` 前缀：

```
如图，该基准最优成绩从 42.0 提升至 78.4[1]。
![Benchmark Trend](../../lab/diagrams/protein-structure-prediction_benchmark_trend.png)
*图：基准最优成绩演进（2020-2025）[1]*
```

**禁止**使用 `../diagrams/`（会误指向 `products/diagrams/` 或报告子目录旁的 diagrams）。
