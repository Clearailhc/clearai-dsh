# 流程预研可视化 — 完整代码与图示（按需加载）

通过 `bash` 跑 python 生成；图表统一落盘 `lab/diagrams/{system_slug}_*.png`（**禁止**写入 `products/reports/` 或报告同目录）。将下方示例中的 `{system_slug}` 替换为实际 slug（如 `single-cell-seq`）。

## ASCII 流程图兜底示例（无图像生成 API 时）
```
=== [系统名] 流程图 ===
[样本]──┐
        ├→ [解离/预处理 37C] → [建库 标准protocol] → [测序 5万reads/细胞] → [分析产出]
[试剂]──┘   酶消化15-30min       质检RIN>7             双端150bp
              │                     │
          [质控留样]            [废液回收]
```

## matplotlib 图表代码（可直接套用，按需改数据）
```python
import sys
sys.path.insert(0, "lab/scripts")
from matplotlib_cjk import setup_cjk
setup_cjk()
import matplotlib.pyplot as plt
import numpy as np

# === 消耗性资源衰减曲线 ===
hours = np.arange(0, 8760, 100)
activity_bad = 100 * np.exp(-hours / 2000)
activity_good = 100 * np.exp(-hours / 5000)

fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(hours, activity_bad, 'r-', linewidth=2, label='Poor storage, half-life~1400h')
ax.plot(hours, activity_good, 'b-', linewidth=2, label='Good storage, half-life~3500h')
ax.axhline(y=70, color='gray', linestyle='--', alpha=0.5, label='Replacement threshold')
ax.set_xlabel('Elapsed Hours', fontsize=12)
ax.set_ylabel('Resource Activity (%)', fontsize=12)
ax.set_title('Resource Decay Curve Comparison', fontsize=14, fontweight='bold')
ax.legend(frameon=False)
ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
plt.savefig('lab/diagrams/{system_slug}_resource_decay.png', dpi=150, bbox_inches='tight')
plt.close()

# === 产出 vs 参数关系图（双 Y 轴） ===
param = np.linspace(110, 160, 50)
yield_main = 95 - 0.05 * (param - 135)**2
side_effect = 2 + 0.02 * (param - 135)**2

fig, ax1 = plt.subplots(figsize=(10, 5))
ax1.plot(param, yield_main, 'b-', linewidth=2, label='Main Output Quality(%)')
ax1.set_xlabel('Key Parameter Value', fontsize=12)
ax1.set_ylabel('Output Quality (%)', color='b', fontsize=12)
ax1.tick_params(axis='y', labelcolor='b')
ax2 = ax1.twinx()
ax2.plot(param, side_effect, 'r-', linewidth=2, label='Side Effect(%)')
ax2.set_ylabel('Side Effect (%)', color='r', fontsize=12)
ax2.tick_params(axis='y', labelcolor='r')
ax1.axvline(x=135, color='gray', linestyle='--', alpha=0.5, label='Optimal Value 135')
ax1.set_title('Parameter vs Output and Side Effect', fontsize=14, fontweight='bold')
lines1, labels1 = ax1.get_legend_handles_labels()
lines2, labels2 = ax2.get_legend_handles_labels()
ax1.legend(lines1 + lines2, labels1 + labels2, loc='upper right', frameon=False)
plt.savefig('lab/diagrams/{system_slug}_output_vs_param.png', dpi=150, bbox_inches='tight')
plt.close()

# === 资源消耗分布图 ===
stages = ['Collection', 'Preprocessing', 'Transformation', 'Validation', 'Support']
cost = [8, 22, 18, 40, 12]
colors = ['#003366', '#336699', '#6699CC', '#99CCFF', '#E69F00']

fig, ax = plt.subplots(figsize=(10, 5))
bars = ax.barh(stages, cost, color=colors)
for bar, val in zip(bars, cost):
    ax.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height()/2, f'{val}%', va='center', fontsize=11)
ax.set_xlabel('Cost Share (%)', fontsize=12)
ax.set_title('Resource Consumption by Stage', fontsize=14, fontweight='bold')
ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
plt.savefig('lab/diagrams/{system_slug}_cost_distribution.png', dpi=150, bbox_inches='tight')
plt.close()

# === 多维雷达对比图 ===
N = 6
angles = [n / float(N) * 2 * np.pi for n in range(N)]
angles += angles[:1]
categories = ['Input Cost', 'Time', 'Maintenance', 'Labor', 'Compliance', 'Consumables']
values_a = [4, 5, 3, 4, 3, 5]; values_a += values_a[:1]
values_b = [3, 3, 4, 5, 4, 3]; values_b += values_b[:1]

fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
ax.fill(angles, values_a, alpha=0.25, color='#003366', label='Route A')
ax.plot(angles, values_a, 'o-', color='#003366', linewidth=2)
ax.fill(angles, values_b, alpha=0.25, color='#E69F00', label='Route B')
ax.plot(angles, values_b, 'o-', color='#E69F00', linewidth=2)
ax.set_xticks(angles[:-1]); ax.set_xticklabels(categories, fontsize=11)
ax.set_title('Multi-Dimensional Route Comparison', fontsize=14, fontweight='bold', pad=20)
ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.0))
plt.savefig('lab/diagrams/{system_slug}_radar_comparison.png', dpi=150, bbox_inches='tight')
plt.close()
```

## 报告中引用图表

报告位于 `products/reports/{system_slug}_process_report.md` 时，引用 `lab/diagrams/` 下图表须使用 `../../lab/diagrams/` 前缀：

```
![Resource Decay](../../lab/diagrams/single-cell-seq_resource_decay.png)
*图：不同保存条件下资源活性对比[推断]*
```

**禁止**使用 `../diagrams/`（会误指向 `products/diagrams/` 或报告子目录旁的 diagrams）。
