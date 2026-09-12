---
name: scientific-brainstorming
description: |
  【调研早期·发散探索】行业/工艺切入点的结构化头脑风暴。适用：刚接触新行业或新客户、意图模糊、需识别调研方向与 AI 优化机会。不适用：已有明确 SOP 任务（用 domain-presearch）；已有观测待形成假设（用 hypothesis-generation）。
license: MIT license
metadata:
  version: 1.0-clearai
  skill-author: K-Dense Inc. (adapted for ClearAI)
  tier: system
  origin: template
  created_at: '2026-06-12T02:47:05.410379+00:00'
---

# 科研头脑风暴 Skill

## 使用边界

- **适用**：调研最早期、尚无具体数据；需探索工艺优化切入点、行业 AI 应用机会、核心矛盾。
- **不适用**：企业/财务/行业格局系统预研 → `domain-presearch`；工艺参数深挖 → `process-presearch`；可证伪假设与实验设计 → `hypothesis-generation`。

## ClearAI 工具与路径映射

- 对话引导为主；要点落盘 → `write` 到 `lab/knowledge/brainstorm_notes.md`
- 需联网补充 → `web_search`（标注 sources）
- 示意图 → `bash` + matplotlib 落盘 `lab/diagrams/`
- 经验回写 → `clear/memory/brainstorming_lessons.md`

## 五阶段工作流

### Phase 1：理解上下文

- 行业、产品、工艺环节、现有痛点、数据可得性、约束（预算/时间/合规）
- 示例问题：「当前研究路径最大瓶颈在哪？」「哪些相邻领域已有方法可借鉴？」

### Phase 2：发散探索

1. **跨域类比**：其他学科/领域对同类问题的做法能否迁移？
2. **假设反转**：「如果瓶颈不在设备而在工艺参数呢？」
3. **尺度切换**：样本级 / 批次级 / 系统级 / 全局级
4. **技术猜想**：数字孪生、预测性维护、参数优化、软测量——哪些值得深入？

可参考 `references/brainstorming_methods.md`（SCAMPER、六顶思考帽等）。

### Phase 3：连接归纳

- 归纳主题：能耗、质量、产能、安全、数据治理……
- 标出 2–3 个最值得跟进的调研方向

### Phase 4：批判筛选

- 每个方向：需要什么证据？第一步调研动作是什么？
- 与 `scientific-critical-thinking` 衔接：哪些说法目前只是猜测？

### Phase 5：沉淀与交接

**交付物** `lab/knowledge/brainstorm_notes.md`：
- 3–5 个候选方向 + 理由
- 建议下一步加载的 Skill（enterprise / process / literature）
- 开放问题列表

## 原则

- 对话为主，用户至少承担一半思考；避免替用户下定论。
- 可验证性优先于纯发散；「最 radical 想法」需可落到可调研动作。
