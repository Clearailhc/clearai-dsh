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

## 实际验证结果

DSH 0.2.0-rc.2 / Electron Node 24.18.1，模型 abhome / deepseek-flash / medium。各场用量均可核对，包含缓存输入；崩溃恢复用量分别报告，不能当作独立性能样本。

| 场景 | 结果 | 处理 token | 审计派发 / 等待期主请求 |
| --- | --- | ---: | --- |
| 快速完整闭环 | 完成，63.742 秒 | 289,960 | 1 / 0 |
| 默认命令延迟 305 秒 | 完成，345.679 秒 | 221,621 | 1 / 0 |
| 评估中取消 | 用户取消，未错误结案 | 106,104 | 见原始记录 |
| 连接故障 | 连续失败后阻塞 | 250,430 | 见原始记录 |
| 子裁决写出后父进程崩溃 | 原裁决恢复，完成，无同材料重派 | 原运行 263,044；恢复 1,342,975 | 见原始记录 |

慢评估核对了实际命令输出 `mean=2, quick=false, elapsed_seconds>=305`，通过一次原生 `job_output` 收取后台结果。不是以等待时长替代执行证据；人为延迟不用于性能比较。

结果摘要：[快速](fast.json)、[慢评估](slow.json)、[故障](faults.json)、[生命周期](lifecycle.json)。完整本机原始日志保留在 `/private/tmp/v054-audit-{fast,slow}-jobs` 和 `/private/tmp/v054-faults-jobs`。仅提交无凭据的摘要，不将宿主配置放入仓库。

现有全部本机回归通过，包括 653 项 kernel、38 项 host、169 项 client；本机 host/client 未跳过。Linux 和 Windows Node 24 审计回归见 [CI 38044847240](https://github.com/Clearailhc/clearai-dsh/actions/runs/38044847240)，两 job 均成功。0.5.2、0.5.3 到候选的原生安装、账本回放、卸载重装通过，历史账本摘要未变。

真实测试对应安装包 SHA-256 `fa9f5f894ab0ba2967a8d09e965e12b39a1c0367c27a55df9c68a7f7e2ca8074`；发布前补入文档后重新核对运行代码逐文件摘要。安装环境和运行时摘要包含在各 JSON 中。

### 保留的失败与限制

旧候选缺少后台任务读取工具，慢评估测试被停止，记录保留在 `/private/tmp/v054-audit-slow-1`、`/private/tmp/v054-audit-slow-final`；旧断连测试暴露了失败计数重置问题，记录保留在 `/private/tmp/v054-faults-final`。这些均不计为新候选通过。一次通用安装验收错误地使用缓存 DSH 0.1.5-rc.2，因宿主 API 不兼容失败；另用支持版本重新验证。

本轮仅验证审计机制，无隐藏业务真值、无性能对照，不证明产品收益。原生团队与跨任务配对长测属于 rc.2。

