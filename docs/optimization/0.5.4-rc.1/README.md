# 0.5.4-rc.1：审计等待与恢复

本候选基于 0.5.3。独立评估仍使用宿主一次性子代理；交付调用等待原生结果，诊断计时器不取消、不结算失败、不触发模型重试。

## 接口与迁移

- `auditTimeoutMs`：一次慢评估日志提醒，默认 240000 ms，不是运行预算。
- `auditHardTimeoutMs`：兼容读取但忽略，启动时报告废弃；测试运行预算由测试驱动设置，生产取消由宿主管理。
- 正常结果、原生结束事件和冷日志恢复共用写卡／持久收尾入口。`audit/settled` 保存结算时间，`audit/notified` 记录原调用丢失后的一次原生通知。
- 投影版本 22 从原账本重建。历史超时记录保留；不自动恢复历史目标。用户暂停、取消、修改目标后，迟到裁决仅保存证据。
- 复跑期间材料变化会阻止使用旧裁决完成；相同材料复用原裁决，实质修订需重新审查。

## 验证与复现

工程命令：`npm test`、`npm run build`、`npm run verify`。宿主与客户端测试必须设置指向隔离候选的 `DSH_HOME`、`DSH_PROFILE`，跳过不算通过。

真实宿主探针：

```sh
node tools/native-headless/setup.mjs /tmp/clearai-rc1-home rc1
node tools/native-headless/audit-wait-probe.mjs /tmp/clearai-rc1-home rc1 /tmp/clearai-audit-slow 305
node tools/native-headless/audit-wait-probe.mjs /tmp/clearai-rc1-home rc1 /tmp/clearai-audit-fast 0
```

固定使用本机 DSH 0.2.0-rc.2，abhome / deepseek-flash / medium；每题包含主／子代理的 5,000,000 处理 token 和 90 分钟上限。仅合成材料，不含日常研究资料。305 秒是人为测试延迟，不作为性能收益。

报告应核对原生子会话实际命令结果、派发材料摘要、等待期间主模型请求数，以及持久目标结局。修订材料引发的再次审计必须与相同材料重复派发区分。

发布前仍须完成最终候选的真实慢评估、取消／恢复、Windows CI 和包一致性核对；本文件的说明不替代验收结果。
