# clear/memory — 经验沉淀目录

本目录存放每个 Skill 在当前项目下的经验教训（Lessons）。按能力主题组织，不按日期切分。

## 文件命名规范

`<skill_name>_lessons.md`，例如：
- `data_cleaning_lessons.md`
- `feature_engineering_lessons.md`
- `model_training_lessons.md`
- `troubleshooting.md`（通用故障排查经验）

## Lesson 条目模板

```markdown
## Lesson: <简短标题>
- Context: <任务背景/触发条件>
- Symptom: <现象>
- Root Cause: <根因>
- Fix: <采取动作>
- Validation: <验证方法与结果>
- Reuse Hint: <下次何时应优先应用>
```

## 写入时机

- `ClosePlan` 前：若本次任务产生新经验（工具报错修复、边界条件发现、业务规则确认），必须追加到对应文件。
- Compact 后摘要中出现 `### 待落地记忆 (Pending Lessons):` 段落时，在下次 `CreatePlan` 前落地写入。

## 晋升规则

满足以下任一条件，可将 Lesson 提升至 `clear/skills/*.md`：
- 同类任务可直接复用，与具体数据弱相关
- 具备明确的条件-动作-预期结果三元组
