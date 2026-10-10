# PR #23继续开发：本机真实测试复现

使用本机DeepSeek Harness 0.2.0-rc.2及Node24。主代理、独立评估者和盲评固定abhome/deepseek-flash/medium。命令从仓库根目录执行。每轮用新的绝对临时目录；不覆盖日常profile，不复用旧产品样本。

## 安装与工程门禁

```sh
node tools/build-package.mjs
node tools/verify-package.mjs
node tools/native-headless/setup.mjs /private/tmp/clearai-new-home native52-pr23
DSH_HOME=/private/tmp/clearai-new-home DSH_PROFILE=native52-pr23 CLEARAI_REQUIRE_INSTALLED_TESTS=1 bash test/run.sh
node tools/native-headless/native-contract.mjs /private/tmp/clearai-new-contract
node tools/native-headless/lifecycle.mjs /private/tmp/clearai-new-lifecycle
node tools/native-headless/recheck-probe.mjs /private/tmp/clearai-new-home native52-pr23 /private/tmp/clearai-new-recheck
node tools/native-headless/faults.mjs /private/tmp/clearai-new-home native52-pr23 /private/tmp/clearai-new-faults
node tools/native-headless/ablation-probe.mjs /private/tmp/clearai-new-home native52-pr23 /private/tmp/clearai-new-ablation
node tools/native-headless/grading-probe.mjs /private/tmp/clearai-new-home native52-pr23 /private/tmp/clearai-new-grading
```

setup使用原生CLI安装tarball，并逐文件核对安装内容，installation.json记录包、运行时摘要及固定模型。测试命令不修改已安装应用。Windows Node24须在同一提交的CI通过，不能用macOS路径测试替代。ui-setup.mjs从隔离home安装另一web profile，用真实界面检查实体事实、经验、负向项、复核原因、文件证据和评估卡，并留截图及包摘要。

所有工程探针都是合成测试，不能算产品收益样本。故障记录保存注入点、主/子会话日志、实际usage和终止原因。注入发生在provider调用之前的请求明确单列；真实请求缺usage为未知。任何失败保留原目录；修改候选后创建新轮次。

## 冻结与分阶段运行

源码和资产先提交，保持工作树干净；工程门禁全通过后，使用installation.json中的准确tarball路径：

```sh
node tools/native-headless/freeze.mjs /absolute/candidate.tgz /private/tmp/clearai-new-campaign
node tools/native-headless/all-stages.mjs /private/tmp/clearai-new-home native52-pr23 /private/tmp/clearai-new-campaign /absolute/gates.json
```

每项gate receipt形如`{passed:true,candidateDigest:"完整包sha256",evidence:"绝对证据文件路径",sha256:"证据文件sha256"}`。只为实际通过的同候选证据填写，不将旧版本passed直接搬入。键见matrix.mjs的REQUIRED_GATES；smoke-six由all-stages在6场全部通过后自动生成。UI证据应包括截图哈希和实际安装摘要；Windows证据绑定提交SHA及成功CI。其余门禁引用实际日志或result.json。

驱动先运行6场冒烟，然后按24开发、48正式、36补充、48消融推进；每个阶段失败立即停止扩大。主/子代理的处理token计入相同预算，盲评另计。每题新会话，同组同世界工作区持续，组间隔离。每题结束先冻结声明材料快照再进入下题，真值和评分在工作区外；读隔离以实际read、shell、符号链接、扫描及工作区正例验证。

manifest冻结候选、源码提交、工具与题目资产、预算、模型、序列和隐藏world key承诺。正式开始后不修改候选或冻结文件；需要修复则终止该轮，保留现场，新候选另开一轮。阶段进度写`<stage>-progress.json`，结果写`<stage>-results.json`，停止原因写`<stage>-stopped.json`。SIGTERM用于受控取消，驱动只取消一次，等待关联评估者并刷新日志。

## 解释结果

先检查目标持久状态、机制停止原因和usage，再看数值评分。失败、超预算和未完成均进入评分，不能用中途产物宣称成功。仅已分类基础设施错误允许原配置重跑一次，恢复题前快照，原记录和额外成本保留。正式统计以四题世界为配对单位，质量和实验节省分别报告97.5%置信区间；不得挑选补样。收益及成本阈值以预注册为准。
