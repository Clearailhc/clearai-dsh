# 画一张拓扑图

流程与空间拓扑图这一门类的具体工艺。目标是让关系可读到足以评审与建模讨论，不是复刻一张
完整的 PFD——每条 DCS 管线、每个阀门、每种公用介质都画上去，反而没人能看出接错了哪一根。

## 布局契约是 ELK JSON

```text
工艺理解 → ELK 输入 JSON → ELK 输出 JSON → 单文件 HTML
```

不要先去设计一套完美的通用图 schema。先把这张拓扑画得能看懂；等几张图之后稳定的结构自己
浮现出来，再谈抽象。中间的输入与输出 JSON 都留盘，这样布局质量的问题和渲染的问题能分开
定位——图不好看时，先看是 ELK 排得不好，还是渲染器画错了。

```bash
node scripts/render_topology.js \
  --elk-input  topo.json \
  --elk-output topo.laid.json \
  --out        topo.html \
  --title "蒸发工段拓扑检查" \
  --source topo.json \
  --proves "设备间的物料与公用工程连接关系" \
  --not-proves "阀门、控制回路与管径"
```

## 参数基线

工业流程链走 `layered`，从左到右，正交走线：

```json
{
  "id": "root",
  "layoutOptions": {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.unnecessaryBendpoints": "true",
    "elk.spacing.nodeNode": "34",
    "elk.spacing.edgeNode": "22",
    "elk.spacing.edgeEdge": "14",
    "elk.spacing.labelNode": "8",
    "elk.layered.spacing.nodeNodeBetweenLayers": "62"
  },
  "children": [
    {"id": "feed", "width": 150, "height": 46,
     "labels": [{"text": "过滤来精液"}, {"text": "Inlet"}],
     "properties": {"位号": "V-101"}},
    {"id": "plate", "width": 150, "height": 46,
     "labels": [{"text": "板换组"}, {"text": "HeatExchanger"}]}
  ],
  "edges": [
    {"id": "m01", "sources": ["feed"], "targets": ["plate"],
     "labels": [{"text": "精液"}],
     "properties": {"role": "main", "medium": "精液", "relation": "主物料"}}
  ]
}
```

`labels[0]` 是节点主名，`labels[1]` 渲染成副标题。`properties` 里除 `role` 与 `elk.*`
之外的键会原样透传到侧栏——位号、设计参数、出处、备注都可以放，渲染器不挑。

## 关系分类

每条可见的边都该声明 `properties.role`，它是边的颜色与线型的唯一来源：

| role | 含义 |
|---|---|
| `main` | 主物料/主工艺链 |
| `branch` | 次要物料支线或旁路去向 |
| `seed` | 晶种、料浆一类的返回关系 |
| `recycle` | 母液、滤液、溢流、循环回用 |
| `utility` | 水、汽、风、清洗、冷却、控制等公用介质 |
| `unknown` | 有意义但尚未确认的关系 |

**工业拓扑图里缺 role 是缺陷**：一张图上分不出主链与公用管线，评审的人得逐条问你。生成器
遇到缺 role 的边会给出提示，并按中性样式渲染——它不会替你伪造成 `unknown`，因为「作者说这
条不确定」和「这张图不用关系分类」是两回事，混在一起会让极简图整张报成存疑。

拿不准某条关系时，显式写 `role: "unknown"`，把不确定留在 `properties.note` 里。这些边会被
自动汇总进页面顶部的入口区，专家一打开就先看它们。

## 排序规则

主链清楚时：

1. `children` 里主链节点排在最前，按工艺顺序。
2. `edges` 里主链边排在最前，按工艺顺序。
3. 旁系、返回、支线节点排在主链之后。
4. 保留 `considerModelOrder.strategy: NODES_AND_EDGES`。
5. 有回路把主链顺序搅乱时，用 `cycleBreaking.strategy: MODEL_ORDER`。

这不只是好看的问题。工业图里回路很常见，而 ELK 默认会优先考虑断环，断出来的顺序未必符合
工艺上的心智顺序。model order 是把「你认为的主链是哪条」这件事告诉 ELK 的唯一途径。

若某条返回边在视觉上压过了主链，可以只为布局把它反向，同时在渲染出的元数据里保留真实
流向——用了就在 `properties.note` 里写明，别让后来者以为工艺反了。

## 密度只调 ELK

标签贴到节点、走线挤在一起时，调 spacing，不要去改坐标：

- `elk.layered.spacing.nodeNodeBetweenLayers` — 横向段落的长短
- `elk.spacing.edgeNode` — 线离节点太近时
- `elk.spacing.edgeEdge` — 并行边挤在一起时
- `elk.spacing.labelNode` — 标签离线或节点太近时

先从紧凑值起步，撞上了再放。

## 节点里放什么

克制。概览图的节点只放两行：

```text
设备名
简短类型
```

变量表、DCS 点位、长假设、会撑大节点的徽标，都不要塞进节点——它们让每个盒子尺寸不可预测，
布局随之抖动。这些内容放侧栏，通过 `properties` 透传过去，点选时再看。

## 边标签

短，面向介质：`精液`、`冷却精液`、`精液+细晶种`、`附聚料浆`、`粗种子`、`母液/滤液`。

解释性的长句放侧栏，不放线上。一条线上挂一句话，图就没法看了。

## 验证

生成后在浏览器里确认（用 http origin，`file://` 下某些宿主不跑 requestAnimationFrame）：

```js
window.__RENDERED__          // {nodes, edges, labels} —— 与源数据计数比对
document.querySelectorAll('.node').length
document.querySelectorAll('.edge').length
document.querySelectorAll('.legend label').length   // 关系类别数
```

要看的是：页面不空白、控制台无错误、节点与边的数量对得上、多种关系并存时图例里能分辨、
缩放平移只影响画布而不动页面其他部分。

## 以后再抽象

几张图跑顺之后，再考虑把工艺事实抽成 `graph.yaml`、把视觉意图抽成 `view.yaml`、把点位绑定
抽成 `data_bindings.yaml`，以及一个从它们生成 ELK JSON 的转换器。在那之前，ELK JSON 保持
显式且可检查——它现在就是布局契约。
