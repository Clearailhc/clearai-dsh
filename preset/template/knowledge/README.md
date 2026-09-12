# clear/knowledge — 领域知识与项目事实

本目录存放项目级的领域知识和已验证的事实。作为每次任务的高优先级事实源。

## 常见文件

- `business_rules.md` — 业务规则与约束
- `data_dictionary.md` — 数据字典与字段语义
- `entity_mapping.md` — 实体映射与拓扑关系
- `domain_facts.md` — 已验证的领域事实

## Fact 条目模板

```markdown
## Fact: <标题>
- Statement: <事实陈述>
- Evidence: <来源文件/实验结果/工具输出摘要>
- Scope: <适用范围>
- Last Verified: <YYYY-MM-DD>
```

## 写入时机

仅在经验经多次任务验证、上升为项目普遍事实时写入此处。
更新需谨慎，变更前应有明确的工具输出或实验结果作为证据。
