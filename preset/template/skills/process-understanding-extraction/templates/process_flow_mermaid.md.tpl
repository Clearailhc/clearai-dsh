# 流程图模板（Mermaid）

## 模板说明
建议输出两张图：
1. 主流程（只画对象/物料流）
2. 能量/资源视角（补充蒸汽/冷却水/电等支撑介质）

---

# 1) 主流程（对象/物料流）

```mermaid
flowchart LR
  Feed["Feed"] --> UnitA["UnitA"]
  UnitA --> UnitB["UnitB"]
  UnitB --> Product["Product"]
  UnitB --> Recycle["Recycle"]
  Recycle --> UnitA
```

## 关键流股说明
- Feed：${FEED_DESC}（代表测点/字段：${FEED_TAG}）
- Product：${PRODUCT_DESC}（代表测点/字段：${PRODUCT_TAG}）
- Recycle：${RECYCLE_DESC}（是否计入净输出：${RECYCLE_POLICY}）

---

# 2) 能量/资源视角（公用支撑系统）

```mermaid
flowchart LR
  Steam["Steam"] --> Heater["Heater"]
  Heater --> UnitB["UnitB"]
  UnitB --> Condenser["Condenser"]
  Condenser --> CW["CoolingWater"]
  Vacuum["VacuumSystem"] --> UnitB
```

## 能量口径说明
- 蒸汽计量点：${STEAM_TAGS}（单位：${STEAM_UNIT}）
- 电耗计量点：${POWER_TAGS}（单位：kW）
