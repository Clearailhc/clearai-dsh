# OpenRSI / Frontis-MA1 深度调研

写实现事实,不写理论,不做价值判断。对象是 FrontisAI 的 OpenRSI 仓库与技术报告《Frontis-MA1: Training an AI4AI Model towards Recursive Self-Improvement in Machine Learning Engineering》(arXiv 2607.28568 v1)。每节先写「论文怎么说」,再写「代码怎么做」,末尾集中记录论文表述与代码事实的差异。

**基线**

| 项目 | 值 |
|---|---|
| 仓库 | https://github.com/FrontisAI/OpenRSI,基线 commit `215bad9`(Merge PR #13 `fix/naturebench-eval-contract`) |
| 论文 | arXiv 2607.28568 v1,61 页,发布 2026-07-31 |
| 作者 | 24 人;机构 Horizon Research (Frontis.AI)、清华大学、浙江大学、上海交通大学、Georgia Tech;项目负责人 Junlin Yang、Che Jiang;通讯作者 Kaiyan Zhang |
| 许可证 | 仓库原创部分 CC BY-NC 4.0;vendored AIRA-Dojo 亦为 CC BY-NC 4.0;SLIME/Megatron/Qwen 为 Apache 2.0(见 `NOTICE`) |
| 模型 | Frontis-MA1-35B(主,基座 Qwen3.6-35B-A3B)、Frontis-MA1-30B(对照,基座 Qwen3-30B-A3B-Thinking-2507),BF16 与 GGUF 均发布于 HuggingFace |
| 数据 | OpenMLE-SFT-Traces(26,259 条)、OpenMLE-Tasks(1,415 个全量任务包 + 4,343 个仅 `prepare.py`/`metric.py` 重建脚本) |

**路径约定**:本文路径相对 OpenRSI 仓库根;`aira-evo/` 是 `OpenMLE-Evo/third_party/aira-evo/` 的简写。论文引用标注章节号(§x.y)、附录(A/B/C/D/E)、表号与公式号。

## 总览

| 层 | 名称 | 职责 | 代码位置 |
|---|---|---|---|
| 环境 | OpenMLE-Gym | 5,758 个可执行 MLE 任务的构建、质量门、元数据、本地评估 | `OpenMLE-Gym/openmle_gym/`、`builder_core/`、`metadata_pipeline/` |
| 执行 | OpenMLE Sandbox | 隔离执行候选程序并返回结构化反馈 | `OpenMLE-Gym/openmle-sandbox/` |
| 学习 | OpenMLE-ERL | SFT(执行验证的 rollout)+ RL(执行奖励) | `OpenMLE-ERL/SFT/`、`OpenMLE-ERL/RL/` |
| 搜索 | OpenMLE-Evo | 经验引导的长程演化搜索 harness | `OpenMLE-Evo/tts_search/` + `aira-evo/` |
| 模型 | Frontis-MA1 | 栈的产品,也是 Evo 的变异引擎 | HuggingFace(权重不入库) |

四个原子操作子 Draft / Improve / Debug / Crossover 是训练目标与推理接口的共享词汇:SFT 与 RL 训练它们,Evo 组合它们。

## 1. 项目定位与总体框架

**论文**(§1–2):AI4AI 指 AI 参与构建或改进 AI 系统;演化(Evolution)是过程,即按执行反馈反复修改候选系统;元演化(Meta-Evolution)再闭合一层学习循环,把演化轨迹用于训练提出修改的模型;递归自我改进(RSI)要求每一代升级的系统继续改进产生后继者的过程。OpenMLE 走的是「演化 → 元演化」这一步。机制阶梯四级:Evolution(工件演化,改进者冻结)、Self-Evolution(经验回流)、Meta-Evolution(改进者本身被训练,本工作)、RSI(极限目标)。

问题定义:任务 τ 含自然语言规范、可见数据、提交契约、任务专用评估器、沙箱。第 t 步搜索算法选操作子 a_t,从零或多个父程序及其执行反馈构造上下文 c_t,模型采样 p_t ~ g_θ(·|τ, a_t, c_t),沙箱执行得 s_t = R_τ(E(p_t, τ))。目标是有限预算内最高有符号分数的候选。SFT 与 RL 统一写成 L_evo(θ) = −E[w(s_i) log g_θ(p_i|τ_i, a_i, c_i)]:SFT 用质量过滤取正样本,RL 用处理后奖励与熵优势作权重。

**仓库**:`README.md`、`docs/{results,training,release}.md`、`docs/index.html`(项目页,含 RL 曲线数据与漏斗图)。`docs/release.md` 明确代码仓库只含 Gym 工具、SFT/RL 训练代码、Evo 搜索代码;训练语料、权重、任务包、沙箱镜像、评估资产全部外置。`NOTICE` 记录 SLIME pin 在 commit `680824dd`,Gym 源自 `wangweiz03/gym@72091255`,AIRA-Dojo 以 vendored 形式进入 `OpenMLE-ERL/SFT/third_party/aira-evo/` 与 `OpenMLE-Evo/third_party/aira-evo/` 两处。

项目页时间线:2026-06-23 NatureBench 发布;06-25 自改进代理综述;07-31 Frontis-MA1 首发;08-09 OpenMLE Sandbox 开源;08-25 EEMA 入选 EMNLP 2026。

## 2. OpenMLE-Gym:任务环境

### 2.1 环境契约与三源

**论文**(§3.1–3.2、附录 A.1):任务/状态 = 规范 + 公开数据 + 隐藏评估器 + 资源预算 + 工作区状态;动作 = 提交的程序与执行需求;转移 = 沙箱执行;观察 = 状态、分数、日志、错误类型、工件、运行元数据;奖励 = 评估器分数。三个来源在质量-规模上互补:

| 来源 | 数量 | 构建方式 |
|---|---:|---|
| Curated Anchors | 156 | 从论文与基准手工挑选,下载原始资产直接打包 |
| Kaggle Datasets | 3,362 | 扩展 MLE-Smith 数据集到任务管线,再做包级质量控制 |
| Kaggle Competitions | 2,240 | 自建爬取与构建管线,排除 MLE-Bench 重叠 |

漏斗(竞赛分支):Meta Kaggle 目录 ≈11,000 → 合格候选 3,972(36%)→ 可执行包 2,839(26%)→ 质量门通过 2,240(20%)。合计 5,758,模态分布 Tabular 44% / Image 18% / Time Series 13% / Multimodal 11% / Text 9% / Audio 2% / Video 1%;任务类型 Classification 56% / Regression 31%;包尺寸 <1 MiB 29%,≥1 GiB 9%。

**代码**:`docs/training.md` 只给出三源数字。`OpenMLE-Gym/openmle_gym/` 只实现 Kaggle Competition 一条路径(Kaggle 竞赛数据下载 API + Meta Kaggle 导出的 `builder_core/info.csv`),没有数据集 slug 或 anchor 的摄入代码。漏斗四个数字只出现在 `docs/index.html` 的 SVG 文本里,没有模块计算或持久化这些聚合值。

### 2.2 任务包格式

论文与代码一致(`builder_core/utils/struct.py::Structure`):

```
{task-slug}/
├── raw/                    # 原始竞赛资产(或 --delete-raw 后仅 raw.txt 清单)
├── data/
│   ├── public/             # description.txt, train.csv, test.csv, sample_submission.csv
│   └── private/            # test_answer.csv
└── utils/
    ├── prepare.py          # 确定性切分脚本
    └── metric.py           # 评分类,类名以 Metrics 结尾
```

`NodeExecutor.prepare_validation`(`builder_core/utils/nodes.py`)硬性要求五个文件存在:`public/description.txt`、`train.csv`、`test.csv`、`sample_submission.csv`、`private/test_answer.csv`。

### 2.3 竞赛任务构建管线

**论文**(§3.2、附录 A.1、Figure 20):下载并递归解压 → 工具辅助的文件感知(枚举目录、探查表格结构与样本行、读文档)→ 由本地证据 + Meta Kaggle 记录生成任务描述 → 生成并执行 `prepare.py`(确定性切分、公私分离、生成 schema 兼容的 sample submission)→ 生成 `metric.py` → 加载评估器对 sample submission 打分做校验;失败与断言错误作为反馈进入有界重试;不可构建或无法产出有限标量的包在语义质量过滤前剔除。

**代码**:入口 `openmle-task = openmle_gym.cli:main`,子命令 `build | overview | metric-check | evaluate | leaderboard`。`openmle_gym/build.py::build_tasks` 做预检(任务名正则 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`、路径逃逸、重复、MLE-Bench 排除),默认 dry-run,`--execute` 才真跑;每个 slug 经 `run_task_process("build", …)` 在独立子进程(或隔离容器)中执行,`asyncio.Semaphore(max_concurrency)` 限并发。

`builder_core/design.py::Graph` 是 LangGraph 状态机:

```
START → download → copy → web_info → perceive ⇄ tool → describe → prepare ⇄(retry) → metric → next → END
```

`builder_core/utils/nodes.py::NodeExecutor` 各阶段:
- `download`:HTTP Basic Auth 调 `https://www.kaggle.com/api/v1/competitions/data/download-all/{slug}`,120 s 超时。
- `copy`:递归解压 zip/7z,zip-slip 校验,拒绝归档内符号链接;写 `rawtree.txt`(深度 ≤6,超 30 项的目录折叠)。
- `web_info`:不是爬虫,是查 `info.csv` 写 `webinfo.json`。
- `perceive`:LLM 工具循环,最多 40 次工具调用;工具在 `builder_core/tools/tools.py`:`list_directory_contents`、`get_csv_summary`、`read_txt_md`、`save`;读路径被限制在 `raw/` 内,唯一可写目标是本任务的 `fileinfo.txt`;`save` 返回成功字符串即退出循环。
- `describe`:写 `description.txt`。
- `prepare`:生成 `prepare.py` → `compile()` → 原子写 → 执行 → 校验五文件 → 复制到 `utils/`;失败减 `todo["retry"]`,错误文本以 `HumanMessage` 回灌下一轮。
- `metric`:由处理后的 `description.txt` 与两个 CSV 的 2 行预览生成 `utils/metric.py`。
- `next`:六阶段全真才算成功;`--delete-raw` 时把 `fileinfo.txt` 复制为 `raw.txt` 后删 `raw/`。

六个构建 prompt 在 `builder_core/utils/prompts.py`。`prepare.py` 契约(`gen_prepare_script`):只对有标签的原始数据做确定性 80/20 切分并忽略无标签的原始测试集;媒体文件随 CSV 一起切;`public/` 不得泄露标签;必须 `assert`;为处理后的包重生成 `description.txt`;`sample_submission.csv` 填随机但合法的标签;只复制不软链;不改 `raw/`;重命名暴露标签的文件名。`metric.py` 契约:类名以 `Metrics` 结尾,声明 `higher_is_better`,能对 `sample_submission.csv` 与 `test_answer.csv` 打分,守卫 nan/inf。代码抽取 `_clean_code_output` 优先 `<code>…</code>`,其次最后一个 ```` ```python ```` 围栏,否则抛解析错误进重试。

LLM 客户端:`openmle_gym/llm_config.py` 分 build 与 eval 两套 OpenAI 兼容配置(`OPENMLE_BUILD_LLM_*` / `OPENMLE_EVAL_LLM_*`,回退 `OPENAI_API_KEY`/`OPENAI_API_BASE`/`MODEL`);build 侧 `ChatOpenAI(max_tokens=5000)` 绑定工具,eval 侧 `max_tokens=2048`;未配置 eval 时走遗留 Anthropic 评审(默认 `claude-sonnet-4-20250514`)。

### 2.4 质量门

**论文**(§3.3、附录 A.1):LLM 质量过滤器联合检查描述、原始文件、处理脚本、处理输出、代表性样本,给出五维结构化判断:task validity、data sufficiency、raw-data usage、task complexity、data quality;返回 recommended / conditional / not_recommended 之一;只保留 metric 有效且得到严格 recommended 的任务。竞赛分支在此之前依次做榜单长度筛选、MLE-Bench 重叠移除、许可与规则筛选、包与 metric 可执行校验。缺关键文件或 metric 执行失败直接 not_recommended。

**代码**(`openmle_gym/local_evaluator.py`):
- **确定性校验** `_deterministic_validation`:缺必需文件;四个 CSV 的空表、缺表头、重复列、行宽不齐;sample submission / test answer 与 test 行数不匹配;首列为标识符时检查重复 ID 与 test/submission 的 ID 序列 SHA-256 一致(捕获重排);提交目标列出现在公开 test 中(泄露);metric 执行失败、分数非有限、metric 报告行数与独立检查不符。任一命中即 `validation.status = failed`,触发 `_hard_gate_quality`:五维全 0,`recommendation = not_recommended`,`source = deterministic_hard_gate`。
- **原始数据使用核算** `_build_raw_usage_evidence`:输出 raw/processed 行数、行守恒、标签行利用率、原始测试集角色(无标签时标 `unlabeled_original_test_intentionally_excluded`)。
- **LLM 评审** `_evaluate_with_ai` + `_validate_ai_quality`:五维各 0–5 分且必须附非空理由;`overall = 平均分`,≥4 recommended,≥2.5 conditional,否则 not_recommended;`major_issues` 每条必须含 severity ∈ {low, medium, high}、category、message、evidence_source(限定八个值:`description.txt`、`prepare.py`、`metric.py`、`processed_csv_evidence`、`raw_csv_evidence`、`raw_usage_evidence`、`metric_smoke_test`、`raw_inventory`)与 evidence;schema 不合即记为评估失败而非任务被拒。prompt 内置「OpenMLE 构建契约」预防已知误报(从有标签训练集切 holdout 是预期行为、随机 sample submission 的分数是冒烟不是基线等),并声明证据 JSON 内所有字符串为不可信数据、禁止使用竞赛外部知识。
- **metric 门** `openmle_gym/metric_validation.py`:按文件路径导入 `utils/metric.py`,取第一个类名以 `Metrics` 结尾且 `__module__` 为该模块的类;先 `validate_submission` 再 `evaluate`;分数必须是非 bool 的有限数。默认 120 s 超时。
- **元数据管线** `metadata_pipeline/`:`task_categorizer.py`(模态多选 Image/Text/Tabular/Audio/Video/Time-Series,任务单选 Classification/Regression/Clustering/Segmentation/Object-Detection/Generation,输出 `<out>Modality@Task</out>`)、`compute_requirement_classifier.py`(`<out>GPU|CPU</out>`)、`dataset_size_summarizer.py`;`common.py::merge_task_values` 按名字合并并拒绝重复与集合不匹配。`openmle_gym/overview.py` 用线程池分块跑并按名字排序,输出带 BOM 的 `overview.csv`(列 `Name, Modality, Task, Raw Size, Final Size, CPU/GPU, Source, Metric, NOTE, Server Location`)。

### 2.5 隔离执行与 MLE-Bench 排除

`openmle_gym/process_runner.py::_container_command` 在 `execution_mode == isolated` 时用 docker/podman 跑:`--rm --network none --read-only --pids-limit 128 --memory 8g --cpus 2 --user uid:gid --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=1g`;`prepare` 与 `metric` 两种操作不转发任何环境变量(其余操作转发 18 个白名单变量)。进程模式 `start_new_session=True`,超时对进程组 SIGTERM → 5 s → SIGKILL。

`openmle_gym/build.py::MLEBENCH_SLUGS` 是约 75 个竞赛 slug 的字面名单(如 `aerial-cactus-identification`、`spooky-author-identification`、`AI4Code`),默认 `skip_mlebench=True`,`--include-mlebench` 关闭;dry-run 显式列出 `skipped_mlebench`。只有名字级排除,没有内容级去重,也没有 NatureBench 对应名单。

### 2.6 公开冒烟包

三个公开任务包 `titanic`、`spaceship-titanic`、`house-prices-advanced-regression-techniques`(`examples/slugs.txt`)。`examples/real-run-3-concurrency/` 保留一次 `--max-concurrency 3` 的真实端到端产物:`task_package/`(含 raw 与处理后数据)、`builder_forge/`(description/fileinfo/rawtree/webinfo/prepare/prepares.json)、`metadata/overview.csv`(三行,Metric 列约 0.50 为随机提交的冒烟分)、`evaluation/`(三任务 4.6 / 4.4 / 4.4 分,均 recommended)。`titanic/utils/prepare.py` 是契约范本:断言 891 行、`train_test_split(test_size=0.2, random_state=42)` 分层、按 `PassengerId` 排序、公开 test 去掉 `Survived`、`RandomState(42)` 生成合法随机提交。

## 3. OpenMLE Sandbox:执行后端

### 3.1 架构

**论文**(§3.4、附录 A.2、Figure 21):中心调度器接收 API 请求、记录作业、跟踪 worker 可用性、按资源需求派发到 CPU/GPU Docker worker;worker 物化隔离工作区、挂载任务数据与评估器、执行程序、把日志/提交/工件写回共享存储;控制、执行、存储三分离。组件:Nginx 网关、FastAPI 作业 API、Redis 队列与状态、PostgreSQL 持久化、作业派发器、弹性 worker 集群、共享 NFS。

**代码**(`OpenMLE-Gym/openmle-sandbox/`):四个部署角色 `node_controller/`(`api_server/api_server.py`、`task_dispatcher/task_dispatcher.py`、`database/`、`nginx/`、`docker-compose.yaml`)、`node_workers/`(`read_and_metric.py` 评估器、`sandbox_builder/start_sandboxes.sh`)、`node_router/`(`gateway.py`,多控制器入口)、`node_client/test_titanic/`(三个测试客户端)。链路:client → [router :6591] → Nginx :6580 → FastAPI :8000 → PostgreSQL + Redis → dispatcher → AIO Sandbox worker(`/v1/shell/*` HTTP)→ NFS + worker 本地 NVMe。worker 不自注册,dispatcher 启动时从 `task_dispatcher/config/sandbox_config.json` 读静态清单。

### 3.2 作业生命周期

`api_server.py::create_job_entry`:`X-API-Key` 校验(仓库内置引导密钥 `mlsandbox-oss-…`,README 要求公开前替换)→ 幂等键(13 字段规范 JSON 的 SHA-256;同键不同哈希返回 409)→ `job_{uuid4[:16]}`,信封目录 `STORAGE_PATH/jobs/{日期}/{dataset_label}/{job_id}/{code,outputs}` → 代码写 `code/main.py` 并记录 SHA-256 → 注入 `DATA_DIR`、`SANDBOX_DATA_DIR`、`RESOURCE_TYPE`、`PRIORITY`、`TRACE_ID`、`JOB_*` 等 env → 信封 chmod 0777 → INSERT `queued` → `rpush` 到队列。

Dispatcher:四条 Redis 队列 `job_queue_{cpu,gpu}_p{1,2}`(1 高 2 低),两个 worker 池 `available_workers_{gpu,cpu}`;`execute_job` 检查取消 → 可选把代码暂存到本地 NVMe(`df` 剩余 ≥ `LOCAL_SCRATCH_MIN_FREE_BYTES` 100 GiB,否则退出码 75)→ `export DATA_DIR={data_dir}/data/public` 运行用户命令 → 等 `submission.csv` → 运行评估器 → 解析分数(正则 `##SCORE##` 取最后一个匹配)→ 写结果。worker 故障前未标 running 的作业重回原队列。

worker 隔离与恢复:`quarantine_worker` 移出池并标 `quarantined`,`WORKER_QUARANTINE_SECONDS` 60 s;`_worker_recovery_loop` 每 15 s 探测,GPU worker 跑 CUDA 冒烟(`torch.cuda.is_available()` + 设备张量 + `synchronize`),CPU worker 跑 `bash -lc 'true'`。假成功防护:done-marker 最多重试 10 次,提交/marker 可见性等待 5 s(吸收 NFS 延迟),未确认即 `sandbox_unconfirmed`;评估命令包一个后台心跳循环(`[HB] … [HB]` 每 20 s)规避 AIO Sandbox 的 `no_change_timeout`。每次作业前清理 `/home/gem/.*` 下 15 个缓存路径;评估时 `PYTHONNOUSERSITE=1`、`unset PYTHONPATH PYTHONHOME`。

### 3.3 反馈模式

**论文**(§3.4、Table 3):六种反馈模式 success / runtime error / missing code / missing submission / scoring failed / timeout,每条保留触发条件、状态、分数(若有)、日志、错误类型、运行元数据、工件。附录 A.2 给出一个 GPU 作业的端到端 transcript(`BCEWithLogitsLoss(label_smoothing=0.1)` 触发 `TypeError`,返回 `error_type: code_execution_error`、`exit_code: 1`、`shell_runtime: 11.88s`、`evaluation: skipped`)。

**代码**(`task_dispatcher.py`)定义八个嵌套结果状态:

| 常量 | 值 |
|---|---|
| `RESULT_SUCCESS` | `success` |
| `RESULT_NO_CODE` | `code_missing` |
| `RESULT_CODE_ERROR` | `code_execution_error` |
| `RESULT_NO_SUBMISSION` | `submission_missing` |
| `RESULT_MISSING_EVAL_RESOURCE` | `metric_or_answer_missing` |
| `RESULT_SCORING_ERROR` | `scoring_failed` |
| `RESULT_TIMEOUT` | `timeout` |
| `RESULT_SANDBOX_UNCONFIRMED` | `sandbox_unconfirmed` |

顶层作业状态 `queued / running / completed / failed / cancelled`;`final_status = completed` 当且仅当结果为 `success`。存储的 `result` JSON 为 `{score, run_log, result}`。

评估器 `node_workers/read_and_metric.py`:导入 `{data_dir}/utils/metric.py`,接受任何同时实现 `evaluate` 与 `validate_submission` 的模块内类(类名含 `metrics` 者优先),先 validate 再 evaluate,打印 `##SCORE##{score}`;评估前有一个无条件 `time.sleep(3)`。

### 3.4 API、路由与存储

| 方法 | 路径 | Controller | Router |
|---|---|---|---|
| POST | `/api/v1/jobs` | ✓ | ✓ |
| POST | `/api/v1/jobs/submit_and_wait` | ✓ | 501 |
| GET | `/api/v1/jobs/{job_id}`、`/logs` | ✓ | ✓ |
| GET | `/api/v1/jobs`、`/api/v1/workers/status` | ✓ | ✓(聚合) |
| DELETE | `/api/v1/jobs/{job_id}` | ✓ | ✓ |
| POST | `/api/v1/uploads` | ✓ | 501 |
| GET/POST | `/admin/config`、`/admin/reload` | — | `X-Gateway-Admin-Token` |

`node_router/gateway.py`:`backends.yaml` 配后端列表,策略 `idle_gpu_first`(并发拉各后端 `/workers/status`,`score = gpu_idle − virtual_load`,选中后虚拟负载 +1,状态刷新时归零),失败回退 `round_robin`;`RouteStore` 用 SQLite 记 `job_id → backend_id`,未知作业逐后端探测一次;配置按 mtime 热重载;router 不校验作业 API key,只透传 `X-API-Key`。README 声明策略以 GPU 为中心,CPU 作业仍按 GPU 空闲数选控制器。

存储分离:NFS(`/mnt/pubdatasets2`,数据集、作业信封、评估代码)与 worker 本地 NVMe(`/mnt/local_sandbox_workdir`,活动代码、`submission.csv`、stdout);`data_dir` 必须是容器可见路径。

`docker-compose.yaml`:API `uvicorn --workers 8`、`DB_POOL_MAX 25`、`SUBMIT_MAX_INFLIGHT_PER_PROCESS 8`、幂等与观测开关;Postgres `max_connections=300`;镜像默认前缀 `ccr.ccs.tencentyun.com/frontisai-openmle`,GHCR 兜底;worker 镜像约 20 GB 压缩,要求 cgroup v1。`start_sandboxes.sh` 交互式启动每个 worker 容器:`--security-opt seccomp=unconfined --cpus 6.0 --memory 200g --shm-size 16g`,NFS 根只读挂载、指定子目录可写,`HF_ENDPOINT=https://hf-mirror.com`。

### 3.5 安全边界(README 原话)

`private/` 目录是评估约定不是安全边界(默认 worker 挂载对共享文件系统只读,选定路径可写);worker `seccomp=unconfined`;引导 API key 与 router 管理 token 硬编码在源码与三个测试客户端中;无 TLS,要求在可信代理终止 TLS 并保持 5432/6380/8000/worker 端口私有。

### 3.6 各消费者接入

| 消费者 | Base URL 变量 | Key 变量 |
|---|---|---|
| Evo 标准 | `SANDBOX_URL` | `SANDBOX_CPU_API_KEY` / `SANDBOX_GPU_API_KEY`(按任务元数据) |
| Evo 多 GPU | `SANDBOX_ROUTER_URL` | 同上 |
| ERL RL | `SANDBOX_BASE_URL`(`SANDBOX_MODE=remote`) | `SANDBOX_API_KEY` |
| ERL SFT rollout | `OPENMLE_SANDBOX_GPU_URL`、`OPENMLE_SANDBOX_CPU_URL` | `SANDBOX_GPU_API_KEY`、`SANDBOX_CPU_API_KEY` |

## 4. OpenMLE-ERL:SFT

### 4.1 采样两路

**论文**(§4.2、附录 B.1、Figure 7):
- **并行路**(full responses):教师独立采样多个 Draft 并全部执行。第一批 GLM-4.7,同任务去掉重复分数后按分排序取 Top-4,11,519 条;第二批 GLM-4.7 + Qwen3-30B-A3B-Thinking-2507 联合排名,GLM 进联合 Top-4 即保留,Qwen 只在总第一时保留,5,726 条(5,075 GLM + 651 Qwen);合计 17,245。
- **演化路**(trajectory steps):GLM-4.7 驱动 AIRA-Evo 搜索。局部段从 Draft/Improve/Crossover 节点起,沿真实父子边跟随连续 Debug 后代,遇到下一个非 Debug 节点结束。门槛:Draft 段终点正分;Improve 段胜父;Crossover 段胜两父中较优者;终点至少铜牌。单步段且根为奖牌终点直接保留;多步段由 DeepSeek-V4-Pro(温度 0,最长 4,096 tokens,固定 JSON schema)按「因果继承」判定每步是否保留:某步的核心策略、必要中间状态或关键修复被后续步继承并对终点有具体贡献才保留;装饰性修改、盲目重试、仅为规避资源限制而缩减训练规模、失败的环境修改或外网访问一律丢弃;附录 B.1 给出完整系统 prompt 与输入模板。贡献 9,014 条。
- **预算自适应收集**:每任务达到接受配额或耗尽执行预算即停,简单任务早停,稀疏成功任务多试。
- **装配**:统一为 system/user/assistant 消息,按规范化全文精确去重,套目标模型 chat template 后剔除 >32,768 tokens。最终 26,259 条:full responses 17,245(65.7%)、trajectory steps 9,014(34.3%);Draft 19,436(74.0%)、Improve 1,741(6.6%)、Crossover 742(2.8%)、Debug 4,340(16.5%);中位长度 8,407 / 14,051 tokens。

**代码**(`OpenMLE-ERL/SFT/`):
- 并行路:`tts_search/evaluate_pass_k.py`,启动 `scripts/evaluate_pass_k_glm-47_4-valid.sh`,配置 `configs/experiment/parallel_glm47.yaml`(`max_steps 4`、`task_concurrency 16`、`llm_concurrency 64`、`loop_success_target 4` 递增到 32、`rejection_policy accept_scored`);服务 `services/{generator,evaluator,scheduler,generation_loop,rejection,result_persistence}.py`。教师配置 `configs/litellm/glm-4.7.yaml`(`zai/glm-4.7`,温度 0.7,32768,10 次重试)。
- 演化路:`scripts/run_evolutionary_rollout.sh` → `scripts/evaluate_airaevo.py` → vendored `examples/mle_bench/runner.py`;`configs/experiment/evolutionary_glm47.yaml` + `configs/search/evolutionary.yaml`(`max_steps 64`、`candidates_per_step 5`、`task_concurrency 200`、`crossover_prob 0.5`、`max_debug_depth 10`、`max_debug_time 21600`、`execution_timeout 14400`)。
- 拒绝策略族 `services/rejection.py`:`AcceptAll`、`AcceptScored`、`Medal`、`ScoreThreshold`、`RewardThreshold`、`BetterThanReference`、`MixedLeaderboardBaseline`,外包一层 `BaselinePostprocessPolicy`(先应用 32,768 token 门与 0.12 相对验证/测试 gap 门)。
- 筛选脚本 `scripts/sft_data_selection/`:`select_parallel.py`(策略 `glm-top4-unique-score` 与 `joint-top4`,后者 Qwen 仅总第一保留且第 5 名不补位)、`select_evolutionary.py`(`ROOT_OPERATORS = {draft, improve, crossover}`,BFS 找 Debug 后代,`class_flags` 检查正分/胜父/奖牌,多步段读 `--annotations`;系统 prompt 文件 `causal_inheritance_prompt.txt`)、`finalize_messages.py`(`dedup` 按消息 JSON 的 SHA-1;`token-filter` 套 `apply_chat_template` 后按 `--max-tokens 32768` 过滤)、`exclude_reserved_tasks.py`(抽 `Task Description:` 段做 SHA-256 与保留集比对,缺描述即拒)。
- 数据格式(`data_produce/collect.py`、`alignment.py`):每行 `{"id", "messages"}`,system 由 `prompt_builder.build_pass_k_draft_system_prompt` 重建,assistant 内容为 `<think>\n{reasoning}\n</think>\n\n```python\n{code}\n````;操作子作为行字段而非消息内标签。

### 4.2 训练配置

**论文**(附录 B.2、Table 4):全参 SFT,SLIME + Ray + Megatron-LM;30B 用 `qwen3` loss mask,35B 用 `qwen3_5` 兼容 mask,均保留 `<think>` 监督;上下文 32,768;bf16;全局 batch 128;每设备 batch 1 动态合批;梯度累积 64(30B)/ 32(35B)微批;lr 3.0e-5,cosine 衰减到 0,warmup 0.1;3 epoch。

**代码**:`slime_scripts/qwen3_30b/train.sh` 与 `qwen3_6_35b/train.sh` 只设环境变量后 `exec slime_scripts/common/run_slime_sft.sh`。SFT 以 SLIME 的退化 rollout 跑:`--rollout-function-path slime.rollout.sft_rollout.generate_rollout --loss-type sft_loss --loss-mask-type ${LOSS_MASK_TYPE} --calculate-per-token-loss --disable-compute-advantages-and-returns --debug-train-only`;步数由 `DATASET_ROWS / GLOBAL_BATCH_SIZE × NUM_EPOCH` 推导,只存最终 checkpoint。两模型差异:

| | Qwen3-30B-A3B-Thinking-2507 | Qwen3.6-35B-A3B |
|---|---|---|
| 模型脚本 | `qwen3-30B-A3B-Thinking-2507.sh` | `qwen3.5-35B-A3B.sh`(兼容 spec) |
| loss mask | `qwen3` | `qwen3_5`,`QKV_FORMAT=thd` |
| `MAX_TOKENS_PER_GPU` | 32768 | 8192 |
| TP / EP | 4 / 8 | 2 / 8 |
| 其它 | — | 优化器 CPU offload、`flex` 分发器、DeepEP |

共同默认:`NUM_EPOCH 3`、`LR 3e-5`、`WEIGHT_DECAY 0.1`、Adam β 0.9/0.95、`GLOBAL_BATCH_SIZE 128`、`ROLLOUT_MAX_CONTEXT_LEN 32768`、8 GPU/节点。`pyproject.toml` 把 `rollout`、`train-qwen3-30b`(transformers 4.x)、`train-qwen3-6-35b`(transformers 5.x)设为互斥 extras。

## 5. OpenMLE-ERL:RL

### 5.1 目标与三项机制

**论文**(§4.3、附录 B.3–B.6):RL 在 SFT 分布内把概率推向更优候选。三项机制:
1. **异构结果可比**:先把原始分转为「越大越好」的有符号分 z(Eq. 6),静态界 B_static = max(理论最大, 榜单最大)、W_static = min(理论最小, 榜单最小)(Eq. 7);基础奖励 r_base = clip(((s̃ − b_worst)/(b_best − b_worst))^α, 0, 1)(Eq. 1)。静态界常远宽于当前策略分数区间,故用自适应界:合并历史成功程序与当前组分数降序 x(1) ≥ … ≥ x(K),B_dyn = x(1),W_dyn = x(min(16, K)),再 W_dyn ← W_dyn − 0.25·max(B_dyn − W_dyn, 0);与静态界取交 B = min(B_dyn, B_static)、W = max(W_dyn, W_static),无效则回退静态;r_proc = r_base(z; B, W),低于 W 的分数得 0。
2. **上尾集中**:熵优势替代 GRPO 组归一化。组内处理奖励按最大值中心化 c_i = r_i − max_j r_j,q_i(β) = softmax(β c_i);二分求 β 使 KL(q_β ‖ Unif(K)) ≈ log 2(上限 10^6,60 次迭代);优势 A_i = e_i / Z_{−i} − 1,其中 e_i = exp(β c_i),Z_{−i} = (1/(K−1)) Σ_{j≠i} e_j(Eq. 8–9)。Figure 8:熵加权把最佳候选的平均处理优势从 1.58 提到 6.39(4.0×),自适应界 + 熵加权使 Group Best Reward 峰值 0.666(+0.089),早期 harness 上的测试奖牌率 24.2±5.7 → 34.8±4.3。
3. **异步 rollout**:生成-执行组独立启动,训练器从队列消费完成的组;40 个匹配步上同步 97.0 min/步 vs 异步 50.8 min/步(1.91×);任务曝光均衡(每任务步数在中位 ±2 内,变异系数 1.56%/2.06%)。

**父状态选择**(Eq. 3、附录 C.1):F(p) = norm(R_p) + norm(Var_{c∈child(p)} R_c) + norm(C_p),三项分别是父奖励、子奖励方差、访问冷却;链接子集合含 `parent(c) = p` 与 `p ∈ crossover_parents(c)`;方差项缺失取中性 0.5;Improve/Crossover 候选限正奖励程序,Debug 限非正奖励程序;轮盘赌无放回采样,Crossover 顺序抽两父。

**超参**(Table 5):SLIME + Ray + SGLang;操作子采样 Draft 0.50 / Improve 0.17 / Debug 0.17 / Crossover 0.16;每 rollout 16 prompt × 16 样本,全局 batch 128,2 优化步;温度 1.0,最长响应 24,576;GSPO + TTT-Discover 式奖励后处理,clip ε = 3.5e-4,TIS;Adam lr 1.0e-6 恒定,wd 0.1,β 0.9/0.98。

**Reward hacking**(附录 B.6):早期小模型在难任务上奖励迅速停滞,案例是把 sample submission 打乱后提交;对策是 o3-mini 评审在沙箱执行前检查,命中即跳过执行并给 −0.5。

**训练曲线**(Figure 6、项目页):221 次更新,rollout 基础奖励 0.180 → 0.400,验证基础奖励 0.404(峰),验证奖牌数峰值 31/176。

### 5.2 代码:入口链与四种启动模式

```
configs/<mode>.env → scripts/run_openmle_rl_<mode>.sh → RL/train_with_patch.py | train_async_with_patch.py → SLIME train.py | train_async.py
```

`train[_async]_with_patch.py` 钉住本地 `sys.path`,在任何 slime 模块前导入 `patch_eval_logger` 与 `patch_rollout`,再 `exec` SLIME 入口。`patch_rollout.py` 猴补 `_log_rollout_data`(按操作子分桶的 W&B 指标)与 `save_db_snapshot`(`program_database_iter_<id>.db`);`patch_eval_logger.py` 猴补评估日志;`generate_mle.py` 提供 `--custom-generate-function-path generate_mle.generate` 与 `--custom-rm-path generate_mle.reward_func`;`fully_async_rollout.py` 提供异步 rollout 函数(同步模式改用 `--colocate`)。

| 模式 | 脚本 | 模型配置 | 拓扑 |
|---|---|---|---|
| 单机同步 | `run_openmle_rl_sync_single_node.sh` | 30B | 8 GPU colocate,TP2/CP2/EP2,SGLang DP-attention 4 |
| 单机异步 | `run_openmle_rl_async_single_node.sh` | 30B | 4 训练 + 4 rollout,TP2/EP2 |
| 多机同步 | `run_openmle_rl_sync_multi_node.sh` | 35B | 2×8 colocate |
| 多机异步 | `run_openmle_rl_async_multi_node.sh` | 35B | 8 训练 + 8 rollout,CP2/EP8 |

每个脚本支持 `PRECHECK_ONLY=1`(校验路径、网卡、数据集元数据、榜单、checkpoint、Ray 端口与 tmpdir 长度);`SAVE_INTERVAL` 必须为 10 否则硬失败;`GLOBAL_BATCH_SIZE` 必须等于 `ROLLOUT_BATCH_SIZE × N_SAMPLES_PER_PROMPT ÷ NUM_STEPS_PER_ROLLOUT`。`model_configs/qwen3.6-35B-A3B.sh` 是 4 行文件,source `qwen3.5-35B-A3B.sh`。README 记录的已验证冒烟:1 节点 8×H200,单机异步,4 prompt × 4 样本,128 token 上限,从 step 669 恢复跑到 671;多机 profile 标注为未验证。

### 5.3 代码:每样本流程

`generate_mle.generate`:Program DB 选操作子与父(同 `group_index` 的 16 个样本共享一次选择,`_parent_selection_cache` 用满即删)→ `prompt_builder` 构 prompt → SGLang 生成 → `reward_func`。

**操作子采样**:`MLE_CONFIGS` 读 `DRAFT/IMPROVE/DEBUG/CROSSOVER_PROBABILITY`,启动脚本覆盖为 0.5/0.17/0.17/0.16;`AIRAEvoSearch.select()` 用 `random.choices`,回退链 improve→debug→draft、debug→improve→draft、crossover→improve→debug→draft;DB 为空或评估模式强制 draft 且用原始 prompt。

**prompt**(`RL/prompt_builder.py`):两族。`build_prompt()`(`SEARCH_ALGORITHM=evo`,单机异步模板默认)与 `build_airaevo_prompt()`(`airaevo`,加记忆/经验块)。系统 prompt 与论文 C.2 一致(Kaggle Grandmaster;Improve 加 "improves upon an existing solution";Crossover 是独立的"synthesize the strengths of two provided solutions… A simple merge won't suffice");Debug 指引含超时降算力一句。`evo` 路径里 `improve` 与 `debug` 共用 Improve 模板,只有 `airaevo` 路径有独立 Debug 模板。父反馈由 `format_sandbox_feedback` 渲染为 `## Execution Result`(Status / Score / Result / Execution Log,日志 >2000 字符取首尾各 1000)。

**Program DB**(`RL/program_database.py`):SQLite,`Program` 字段含 `score, reward, fitness, base_reward, exploit_coefficient, explore_coefficient, cooling_coefficient, visit_count, child_base_reward_variance, parent_id, generation_mode, hack, metadata`;每次插入后 `_recompute_task_fitness`:exploit = 归一化 base_reward,explore = 归一化子 base_reward 方差(无子为 None),cooling = 归一化 `1 − visit_count/max_visit`,`fitness = 三者之和`;父链接同时看 `parent_id` 与 `metadata["crossover_parent_ids"]`。`_sample_improve_parent` 取 `reward > 0` 者按 fitness 无放回加权采样,`_sample_crossover_parents` 取 2,`_sample_debug_parent` 取 `reward <= 0` 者。`AIRAInferenceEvoSearch` 改用 `airaevo_experience.compute_parent_utilities`(权重 1.0/0.4/0.25,novelty = 1/√(1+family_count))+ softmax,岛 `id % num_islands`。

### 5.4 代码:奖励

`generate_mle.reward_func` 先做类别短路(不进沙箱):

| 类别 | base/final reward | 触发 |
|---|---:|---|
| `empty` | −1.0 | 抽不出代码 |
| `no_verify` | −0.5 | `ENABLE_SELF_VALIDATION=1` 时缺 `print(f'Final Validation Score: …')` |
| `hack` | −0.5 | 评审判定猜测/常数/硬编码/无训练/无数据 |
| `hack_verify` | −0.5 | 验证分不是来自真实 hold-out |
| `generation_abort` | −1.0 | SGLang `finish_reason == abort`,整组重排 |

其余进沙箱。沙箱 503、非终态、`score is None` 均得 0.0(失败与超时不给负分)。

映射链:`signed_score` → 组屏障 `_resolve_group_reward_mapping`(同 `(task, group)` 的成员到齐后由最后一个计算共享界)→ `compute_adaptive_bound_pair(mode=top1_top16)`(best = top-1,worst = 第 16 名,`worst −= 0.25·(best − worst)`;支持 `top1_top8 / top1_all_mean / top1_all_median / theoretical`)→ `_sanitize_bound_pair` 用静态界裁剪并保证 `best > worst`(min_span 1e-6),`_apply_max_range` 封顶 1e6;单个有限分数时奖励 1.0 → `score2reward(mode=power_clip)`:`((s − worst)/range)` 裁到 [0,1] 再取 α 次方,发布配置 `POWER_CLIP_ALPHA=1`(代码默认 2.0);其它模式 `logistic / margin_tanh / online_percentile / linear_sign / leaderboard_medal_binary / leaderboard_rank` → 验证/测试 gap 惩罚 `apply_validation_test_gap_penalty`(单机异步模板默认关闭)→ `compute_mode_rewards`:非 Draft 操作子若 base 为 0 或代码与父完全相同则全 0;`delta = max(base − 父奖励, 0)`,`final = shaped_base + 0.5·delta`(`IMPROVE_DELTA_BONUS_COEF`);策略 `base / gate_parent / diff_parent`。三套奖励视图并存:`dynamic_*`(训练用)、`static_*`、`metric_static_base_reward`(W&B 上报)。

熵优势 `RL/ttt_reward_postprocess.py::post_process_rewards`(`USE_TTT_DISCOVER_ADVANTAGE=1` 时注册为 `--custom-reward-post-process-path`)调用 `compute_ttt_entropic_advantages(target_kl=log 2, beta_max=1e6, iters=60)`:二分 β,leave-one-out 权重 `w_i = e_i / ((Σe − e_i)/(k−1))`,`A_i = w_i − 1`;组内全等或 K<2 时全 0。与论文 Eq. 8–9 一致。`compute_gspo_group_advantages` 为不启用时的均值-标准差归一化。

GSPO 参数(`ALGO_VARIANT=gspo`):`--advantage-estimator gspo --use-kl-loss --kl-loss-coef 0.00 --kl-loss-type low_var_kl --entropy-coef 0.00 --eps-clip 3.5e-4 --use-tis`;`ROLLOUT_BATCH_SIZE 16`、`N_SAMPLES_PER_PROMPT 16`、`NUM_STEPS_PER_ROLLOUT 2`、`--rollout-max-response-len 24576`、`--rollout-temperature 1`、lr 1e-6 恒定、wd 0.1、β 0.9/0.98、`NUM_ROLLOUT 3000`。

Hack 评审 `reward_func_utils.hack_check_async`:OpenAI 兼容端点(`GPT_BASE_URL`/`GPT_API_KEY`,默认模型 `o3-mini`,温度 0),8 条作弊规则,返回 `{is_valid, category, reason}`;并发 `HACK_CHECK_CONCURRENCY`(配置 128);评审响应为空或解析失败时按 valid 放行。

### 5.5 代码:异步 rollout、沙箱、评估

`fully_async_rollout.py`:单个后台 `AsyncRolloutWorker` 线程跑 `continuous_worker_loop`,从 SLIME 数据缓冲逐组拉取并 `generate_and_rm_group`,in-flight 上限 `rollout_batch_size`(注释明确不用 `sglang_server_concurrency × engines` 以免淹没 SGLang);完成组进 1000 槽队列,`generate_rollout_async` 凑够 `rollout_batch_size` 组后按 `group[0].index` 排序返回;abort 组由 `_reset_sample_for_generation_retry` 清空后放回缓冲,不进训练;评估时 `pause_and_wait_idle` → `eval_rollout` → `resume`,评估 abort 最多重试 60 次;abort 样本仍走 `reward_func`(得 −1.0)以免组屏障死锁。

沙箱客户端 `reward_func_utils.get_sandbox_result`:`POST /api/v1/jobs`(`resource_type: gpu`,`environment: {EXECUTION_MODE: shell, DATA_DIR, SANDBOX_DATA_DIR, HF_ENDPOINT}`)+ 轮询 `GET /api/v1/jobs/{id}`;提交与轮询各最多 20 次重试(502/503/504/429 与传输错误);`JOB_TIMEOUT 3600`、`WAIT_TIMEOUT 7200`,评估 7200/10800,受 `SANDBOX_MAX_*` 封顶;超 wait 返回 504 `wait_timeout exceeded`;并发 `SANDBOX_CONCURRENCY`(配置 128/256)由每事件循环的 `asyncio.Semaphore` 控制。`reward_func` 两个分支都用 `GPU_BASE_URL`。`get_clear_log` 只取 `--- OUTPUT START/END ---` 与 `--- SANDBOX STDOUT START/END ---` 之间内容并剥 `[HB]` 心跳;`FINAL_VALIDATION_SCORE_VALUE_RE` 抓验证分。程序只在 `status_code == 200` 或类别为 hack/no_verify/hack_verify 时入库。

评估:`EVAL_NAME=validation_tts_draft176`(176 任务,Draft 单发,原始 prompt),`EVAL_INTERVAL 5`、`N_SAMPLES_PER_EVAL_PROMPT 1`、`EVAL_MAX_RESPONSE_LEN 32768`、温度 0.7、top_p 0.95;`patch_eval_logger.get_medal_for_score` 按 Kaggle 阈值(<100 队 top 10%/20%/40%;100–250 队 top 10/20%/40%;250–1000 队 `10+0.2%`/50/100;≥1000 队 `10+0.2%`/5%/10%)计奖牌,按样本计数,上报 `eval/{key}-medal_{gold,silver,bronze}_count`、`medal_rate` 等。checkpoint `--save-interval 10`;`RESUME_MODEL_PATH` + `RESUME_CKPT_STEP` 成对;`LOAD_OPTIMIZER=0`/`LOAD_RNG=0` 用于 SFT→RL 或跨拓扑加载;`MANUAL_DB_PATH` 可复用已有 Program DB。日志 `logging_utils.TrainingLogger` 按组整体写 `train_log_ops.csv`(scores/rewards/三系数/modes/hacks/code_categories 等 30 列)。

## 6. OpenMLE-Evo:搜索 harness

### 6.1 论文的四个组件

**论文**(§5、附录 C):在 AIRA-Evo 的种群循环上重做「如何使用执行证据」。原 AIRA-Evo 存自由文本记忆、对每个评估节点立即调 LLM 摘要、主要按标量适应度选父、各操作子拿相似历史;OpenMLE-Evo 改为:

1. **结构化经验累积**(§5.1、C.3、Table 6–7):每次沙箱评估后确定性生成节点级经验卡,字段六组:身份与谱系(`schema_version, node_id, step_id, operator, parents, parent_node_ids, generation_id`)、观测结果(`score, fitness, reward, status, status_code, is_buggy, error_signature`)、资源核算(沙箱/模型时间、cost、token 三计数)、方法刻画(`imports, method_family_auto, family_count_before`)、派生搜索信号(`delta_vs_parent, novelty_score, is_new_direction, rank, current_best, selection_utility`)、语义证据(`plan, analysis`,可选 `rich_summary{method_overview, parent_comparison_experience}`)。全部卡片聚合为任务级经验板:全局在位者、方法族覆盖(`method_family_stats, family_best_nodes, underexplored_families`)、进展与失败(`score_history, recent_delta_trend, repeated_errors, status_count, operator_counts`)、拓扑与节点状态(`parent_graph, novelty_by_node, rank_by_node, current_best_by_node`)、资源与审计(`runtime_stats, parent_selection_weights`)。文件名沿用历史的 `strategy_board.json`。
2. **经验引导父选择**(§5.2、C.4、Eq. 4):U_i = λ_s s̃_i + λ_Δ Δ̃_i + λ_n ν_i,P(i|I) = softmax(U/τ)。s̃ 是方向感知 min-max 归一化验证分(全等取 0.5);Δ_i = max(0, s_i − s_i^par)(按方向),Δ̃ 按组内最大正增益归一化,无父取 0;ν_i = 1/√(1 + N_{f_i}),N 为同方法族已记录卡数。Crossover 顺序无放回抽两父;最终提交不采样,确定性取最佳可执行候选。
3. **操作触发的记忆合成**(§5.3、C.5):不再对每个节点立即摘要;Improve/Crossover/Debug 选定父与检索节点后,只对无缓存摘要的检索节点调记忆模型,输入任务描述、当前与父的元数据、双方 plan/代码/执行输出、分数/delta/运行时/状态/错误签名,输出恰好两个 JSON 字段 `method_overview`(2–5 句)与 `parent_comparison_experience`(2–5 句),缓存到节点与卡片。附录 C.5 给出完整 prompt。
4. **操作条件上下文**(§5.4、Table 8):Draft 无继承记忆;Improve 取选定父 + 3 个最近祖先(垂直)+ 3 个按同一效用排序的直接兄弟(水平)+ 经验板字段;Crossover 对两父各取 2 祖先 2 兄弟,加方法族互补线索;Debug 取当前 buggy 节点,优先同错误签名的先前节点,其次最近尝试,默认共 3 个相关节点,含重复错误计数。prompt 同时给出剩余预算、剩余步数、单次执行上限。

附录 C.3 的落地记录:leaf-classification 一个成功 Improve 节点的卡片记 `step_id=10`、log loss `fitness=0.012080`、`delta_vs_parent=0.753352`、`method_family_auto=ensemble+xgboost+neural_net+cv`、`novelty_score=0.57735`、`rank=1`、`current_best=true`、沙箱 178.58 s、24,564 tokens;生成前经验板显示 `neural_net+cv` 在位者 0.031825、三次超时、近期平均父相对增益 0.01649。

### 6.2 代码:两层与进程拓扑

`OpenMLE-Evo/tts_search/` 是 Hydra 配置面、沙箱 HTTP 客户端、指引注入器、跨进程并发原语;搜索循环在 vendored `aira-evo/src/dojo/solvers/evo/evo.py`。入口:

| 场景 | 脚本 |
|---|---|
| MLE-Bench 标准 | `scripts/run_standard.sh` → `scripts/evaluate_airaevo.py --config-name experiment/openmle_evo execution=standard` |
| MLE-Bench 异步 | `scripts/run_multi_gpu.sh` → 同上 `execution=multi_gpu`,`AIRAEVO_WORKERS` 默认 8 |
| NatureBench | `scripts/run_naturebench.sh`,`NATUREBENCH_SEARCH_PROFILE=standard|multi_gpu` |
| NatureBench 本地单任务 | `scripts/run_naturebench_local.py` |

`evaluate_airaevo.py::main`:可选改写评估 parquet 注入验证划分指引与任务技能指引 → 写 `.hydra/airaevo_prepare_config.yaml` 与 `airaevo_runner_config.yaml` → 子进程跑 `aira-evo/examples/mle_bench/build_tasks.py`(每任务写 `config.yaml` + `task_metadata.json`)→ 子进程跑 `examples/mle_bench/runner.py`。`runner.py::main` 起 `SharedConcurrencyServer`(跨进程信号量 `llm_concurrency` / `sandbox_concurrency`),每 (task, epoch) 一个 `single_task_runner.py` 子进程,写 `runner_failures.json`、`summary.csv`、`global_stat`、`runner_manifest.json`。`single_task_runner.py::main`(1,785 行)合并三层配置成 `EvolutionarySolverConfig`,构造任务适配器与 `Evolutionary` solver,猴补 `log_journal` 与四个操作子方法,跑搜索,做最终选点与提交。

### 6.3 代码:节点、种群、调度、恢复

`aira-evo/src/dojo/core/solvers/utils/journal.py::Node`(`code, plan, step, id, parents, children, operators_used, operators_metrics, _term_out, exec_time, exit_code, analysis, metric, is_buggy`),运行时动态挂 `experience_card`、`rich_summary`、`experience_parent_selection`、`async_work_metadata`。`Journal` 是平面列表加父子链;`SolutionsDatabase` + `Island`(`evo.py`)管种群:所有发布配置 `num_islands 1`、`max_island_size 500`(NatureBench 160)、`migration_prob 0.0`、`num_generations_till_migration 999`,岛与迁移实际关闭;`add_nodes_to_islands` 只接纳 `fitness >= 岛均值` 的节点并淘汰最差者。

两种调度(`Evolutionary.search`):
- `generation`(同步):`num_generations 100` × `individuals_per_generation 5`;第 0 代全部 Draft 并播种岛;每个个体:建节点 → `task.step_task` → `parse_eval_result` → buggy 则 `debug_cycle` → 入岛 → `save_checkpoint`;`worker_count != 1` 拒绝。
- `async_steady_state`:N 个 `_async_worker_loop` 协程;`sample_lock` 守分配,`asyncio.to_thread` 生成,`task.step_task_async(sandbox_base_url=worker.sandbox_url)` 执行,`commit_lock` 下单写提交;`AsyncWorkItem` 带 `attempt_id, generation_id = attempt_id // individuals_per_generation, operator, parent_nodes, parent_selection_trace, worker`;`WorkerSpec` 由 `tts_search/airaevo_async_resources.py::build_worker_specs` 按沙箱 URL 轮询生成,`gpu_index` 仅为元数据。

恢复:`checkpoint/journal.jsonl` + `state.json`(`current_step, current_generation, running_time`);`_restore_solution_database_from_journal` 对同步与异步共用;经验卡由 `load_experience_cards` 按节点 id 回挂;`strict_resume=true` 跳过已完成的 task/epoch。

### 6.4 代码:操作子

| 操作子 | 实现 | MLE-Bench prompt |
|---|---|---|
| Draft | `core/solvers/operators/draft.py` | `configs/solver/operators/mlebench/aira_operators/draft.yaml` |
| Improve | `improve.py` | `improve.yaml` / `improve_experience.yaml` |
| Debug | `debug.py` | `debug.yaml` / `debug_experience.yaml` |
| Crossover | `crossover.py` | `crossover.yaml` / `crossover_experience.yaml` |
| Analyze | `analyze.py` | `mlebench/aide_operators/analyze.yaml` |
| Rich memory summary | `rich_memory_summary.py` | `aira_operators/rich_memory_summary.yaml` |

`experience.enabled` 为真时 `_operator_paths_for_benchmark` 把 Improve/Debug/Crossover 换成 `*_experience.yaml` 并加入 `rich_memory_summary`;Draft 无 experience 变体。prompt 骨架与论文 C.2 相同;`*_experience.yaml` 只改记忆段落的框架语句(如 Improve:"Use the selected parent memory to preserve what already works. / Use vertical ancestor memory … / Use horizontal sibling memory … / Use board stats only as weak global guidance")。超时降算力一句仅 Debug 有(有测试钉住)。NatureBench prompt 换成科学编码框架与 `DATA_DIR`/`OUTPUT_DIR` 契约,加 `Verified Visible-Data Analysis` 块与领域提示。

**操作子选择**(`SolutionsDatabase.sample_in_context`)是固定随机规则:无节点 → draft;`request_fresh_draft()` 被调或以 `fresh_draft_prob`(MLE 0.0,NatureBench 0.2)→ draft;否则 `improve` 若 `random() >= crossover_prob` 否则 `crossover`(0.5 即各半);`generation_id < num_generations_till_crossover`(2)或无岛达 `few_shot["crossover"]`(2)时 crossover 关闭并回退 improve(trace 记 `crossover_parent_shortage`)。**Debug 不被采样**,由 `parse_eval_result` 置 `is_buggy` 后 `debug_cycle`/`_debug_cycle_async` 反应式触发,上限 `max_debug_depth` 10(NatureBench 2)与 `max_debug_time` 21600 s(NatureBench 1200)。岛选择按归一化岛均值 softmax,温度 `initial_temp → final_temp` 线性衰减(发布配置均为 1.0)。

上下文变量:`task_desc, data_description, visible_data_analysis, public_system_prompt, public_user_prompt, packages`(每次打乱)、`time_remaining, steps_remaining, execution_timeout = min(cfg, 剩余)`、`memory, data_overview`;Improve/Debug 加 `prev_code` 与经 `sanitize_execution_output_for_prompt` 处理的终端输出;Crossover 两份。记忆解析:`prompt_memory.use_base_memory: false`(默认)时经验记忆**替换**而非追加基础记忆;基础记忆处理器在 `operators/memory.py`(`simple_memory`、`ancestral_memory`、`sibling_memory`、`no_memory`)。

输出解析(`operators/core.py::execute_op_plan_code`,最多 `max_llm_call_retries` 3 次):`parse_thinking_tags` 剥 `<think>`;`extract_code` 正则取 ```` ```python ```` 块,兜底整段视为代码,`compile()` 过滤后 `black` 格式化;`extract_text_up_to_code` 取代码前文字为 plan;全部失败时原文作为 code 交沙箱。`trim_long_string(5100, 2500)` 头尾截断终端输出。Analyze 与 rich memory summary 走 function calling + JSON schema,后端拒绝时回退纯文本。

### 6.5 代码:经验系统

全部在 `aira-evo/src/dojo/solvers/evo/experience.py`(1,279 行)。

`build_experience_card` 产出与论文 Table 6 同构的字典(`schema_version 1`);`imports` 用 `ast` 抽取;`method_family_auto` 由 `detect_method_family` 按固定顺序拼 `{ensemble, catboost, lightgbm, xgboost, transformers, neural_net, cv, nlp, sklearn}` 标签;`novelty_score = 1/sqrt(1 + family_count_before)`;`delta_vs_parent` 为方向修正的正增益;`detect_error_signature` 七类 `{timeout, submission_missing, import_error, column_mismatch, metric_parse_failed, sandbox_error, scoring_failed}`。`single_task_runner.mirror_latest_node` 写 `step_<n>/experience_card.json` 并追加 `experience_cards.jsonl`。`build_strategy_board` 每步重建 `strategy_board.json`,字段与 Table 7 对应,`repeated_errors` 只对失败卡计数(有回归测试)。

`compute_parent_utilities`:

```python
utility = w["score"]*score_c + w["delta"]*delta_c + w["novelty"]*novelty_c - official_score_missing_penalty
probabilities = softmax(utilities, temperature)
```

默认 `DEFAULT_PARENT_UTILITY_WEIGHTS = {score: 1.0, delta: 0.4, novelty: 0.25, official_score_missing_penalty: 2.0}`;归一化模式 `minmax`(默认)/ `rank` / `hybrid`;分数只用 journal 的自验证指标,注释写明"using it here would leak test feedback into the search controller";`official_score_missing_penalty` 在使用点被硬编码为 0.0。调用点 `sample_in_context` 在 `experience.enabled` 且 `parent_selection.enabled` 时启用,`previous_cards` 取所有岛的卡,结果概率喂 `numpy.random.choice`,完整 `utility_items` 存为 `parent_selection_trace` 并回写卡片 `selection_utility`;否则回退原 AIRA-Evo 的归一化分数采样。

`collect_operator_memory_nodes`:improve → `primary=[parent]`、`vertical=_recent_ancestors(k=3)`、`horizontal=_horizontal_siblings(...)[:3]`(共父节点按同一效用排序);crossover → 两父各 `ancestor_k=sibling_k=2`;debug → 同 `error_signature` 优先、其次最近,上限 `max_related_cards`(debug 8)。渲染成 `Targeted Memory Context for IMPROVE/CROSSOVER/DEBUG` 块,每节点一行 `node_id (family, score, delta_vs_parent, runtime_seconds)` + rank/current_best/is_new_direction + `rich_summary`(压到 420 字符)或 `legacy_analysis`(360 字符);Crossover 加 `family_complementarity` 与 `crossover_hint`。`rich_summary` 由 `Evolutionary._prepare_operator_rich_memory → _ensure_node_rich_summary` 懒生成,每检索节点一次 LLM 调用,缓存到 `rich_summaries/<node_id>.json`,每节点 `threading.Lock`。

分数脱敏 `response.py::sanitize_execution_output_for_prompt`(`experience.enabled` 且 `prompt_score_sanitization.enabled`):删 `Final Score:`、`##SCORE##`、grader `**Score**:` 行,首处替换为 `[Official sandbox score redacted; use Final Validation Score for search.]`,`Final Validation Score` 保留。

配置(`tts_search/configs/search/airaevo.yaml`,MLE 与 NatureBench 相同):

```yaml
experience:
  enabled: true
  prompt_score_sanitization: {enabled: true}
  parent_selection:
    enabled: true
    weights: {score: 1.0, delta: 0.4, novelty: 0.25}
    component_normalization: {score: minmax, delta: minmax, hybrid_minmax_weight: 0.5}
  prompt_memory:
    enabled: true
    use_base_memory: false
    max_related_cards: 3
    sibling_ranking: {weights: {score: 1.0, delta: 0.4, novelty: 0.25}}
    improve:   {ancestor_k: 3, sibling_k: 3}
    crossover: {ancestor_k: 2, sibling_k: 2}
    debug:     {max_related_cards: 8}
```

### 6.6 代码:LLM 客户端

LiteLLM(`litellm==1.65.7`),`LiteLLMClient`(`core/solvers/llm_helpers/backends/lite_llm.py`)给模型名加 `openai/` 前缀,SGLang/vLLM/托管 API 同路。配置链:`configs/litellm/sglang_qwen3_30b_a3b_thinking_2507.yaml` → `_generation_kwargs_from_litellm_params`(20 键白名单 + `extra_body`)→ `single_task_runner.build_operator_config` 三层合并(`extra_body` 深合并)→ `GenericLLMConfig.generation_kwargs`。默认:模型 `Qwen/Qwen3-30B-A3B-Thinking-2507`,`SGLANG_BASE_URL`(须以 `/v1` 结尾),温度 0.6 / top_p 0.95(analyze 与 crossover 0.5),`max_tokens 32768`,`timeout 600`,`num_retries 1`,`extra_body: {top_k: 20, min_p: 0.0, chat_template_kwargs.enable_thinking: true}`。三层重试:LiteLLM `num_retries`(`AIRA_LITELLM_NUM_RETRIES`,模块默认 10)、`AIRA_LITELLM_TIMEOUT` 1500 s、操作子级重抽取 3 次。thinking 三处处理:请求 `enable_thinking`,响应抓 `reasoning_content | reasoning | thinking`(含 `provider_specific_fields.reasoning_details`),`parse_thinking_tags` 剥标签并写 `step_<n>/reasoning_content.md`。用量:后端缺 `usage` 时 `count_tokens = len(text.split())`;`_calculate_cost` 各分支均返回 0.0。流式在 selfhosted + localhost 自动开启,有 function spec 时关闭;function calling 被 400 拒绝时剥 `functions` 重试为纯文本;MiniMax 把仅 system 的对话并成 user。所有调用经 `tts_search/airaevo_concurrency.py::acquire_llm_slot` 跨进程信号量。`tts_search/config_security.py::redact_sensitive_config` 把落盘配置中 `api_key/token/secret/password` 类键置空,真实 key 只经 `OPENMLE_LLM_API_KEY` 环境变量。

### 6.7 代码:沙箱接入与评分协议

MLE-Bench 只有远程沙箱路径(`aira-evo/examples/mle_bench/base_task.py::SandboxMLEBenchTask`)。`tts_search/reward_func_utils.py::get_sandbox_result`:`POST /api/v1/jobs`(`name, code, data_dir, timeout=job_timeout, resource_type, priority, idempotency_key=uuid4, environment{EXECUTION_MODE: shell, DATA_DIR, SANDBOX_DATA_DIR}`,头 `X-API-Key`、`X-Trace-ID`),提交最多 50 次重试(`1.5^attempt` + 抖动,尊重 `Retry-After`),按 `poll_interval` 10 s 轮询;`API_KEY` 按 CPU/GPU 资源重绑;`httpx.AsyncClient(trust_env=False, verify=verify_tls)`,TLS 校验默认开。超时:`job_timeout 7200`、`wait_timeout 86400`、最终提交 14400/28800;并发 `SANDBOX_CONCURRENCY 66`。资源旋钮只有 `resource_type` 与 `priority`,GPU 分配归沙箱 router;12 GB VRAM / RTX 4090 是部署属性,不在代码中。

评分协议 `_annotate_eval_scores`:`self_valid`(默认)/ `legacy` / `method1` / `method2`。始终记录 `model_final_validation_score`(正则 `Final Validation Score:\s*(float)` 取最后匹配)与 `sandbox_score / sandbox_valid_score / sandbox_test_score`;`self_valid` 验证阶段 `selection_score = sandbox_valid_score if not None else sandbox_score`(`trust_model_validation_score` 默认 false 时不信模型自报分),该值成为 `node.metric`。`score2reward(mode=power_sigmoid)` 用理论/榜单界做 sigmoid(T=0.50,α=2.0)。错误分类两套:`parse_eval_result.deterministic_failure`(状态集或 `status_code >= 400`;experience 模式下验证分缺失直接短路,不调 analyze LLM)与经验卡的七类签名。

预算(`configs/experiment/openmle_evo.yaml`):`time_budget 43200`(12 h 沙箱验证时间)、`model_plus_sandbox_time_budget 64800`(→ `solver.time_limit_secs`)、`max_wall_time_secs 0`(NatureBench 21600)、`execution_timeout 7200`、`max_steps 800`、`n_samples_per_task 3`、`llm_concurrency 66`、`seed 42`、`submit_repeats 1`。四个操作子被 `guard_operator_call` 包裹,`should_stop_search()` 为真时在 LLM 调用前抛 `StopSearch`,`main` 捕获后仍做 checkpoint、导出、选点、最终提交(测试钉住提交不在 `finally` 里)。NatureBench 的 GPU 等待经 `get_budget_exempt_wait_seconds` 从预算中豁免。重复失败逃生:`_repeated_debug_failure_reason` 比较最近两次 Debug 的失败签名,相同则 `request_fresh_draft`。

最终选点 `_select_best_available_node`:优先有验证分的节点取 `max(node.metric)`(标 `validation`),否则用 `random.Random(f"{seed}:{task}:{sample}:final_select")` 从稳定候选确定性随机取(标 `random_no_valid`)。提交:`valid_code_final.py` → `task.build_submit_code` → `submit_code.py` → `evaluate_code(phase="test")` × `submit_repeats`;评级 `tts_search/eval_utils.py`(`load_leaderboard`、`get_grade_for_score` = rank/len,即 Human Rank;`_medal_positions`、`get_medal_for_score`)。

### 6.8 OpenMLE-Evo-Max

**论文**(§6.1):两处扩展——用通用管线从公开竞赛工件蒸馏可复用的跨任务先验(蒸馏前排除所有 MLE-Bench 相关来源);启用异步多 GPU 并行搜索,总沙箱算力不变(沿 AIRA2 的思路)。

**代码**:`OpenMLE-Evo/` 内没有 "Evo-Max" 字样;根 `README.md` 与 `docs/results.md` 定义它为 Evo 内的异步多 GPU profile 加 MLE-Bench 无关的经验先验。对应两个开关:`execution=multi_gpu`(`configs/execution/multi_gpu.yaml`:`execution_mode: async_steady_state`、`async_workers: ${AIRAEVO_WORKERS, 8}`、`async_sandbox_urls: [${SANDBOX_ROUTER_URL}]`)与任务技能指引注入(`tts_search/task_skill_guidance.py`:`load_task_skill_map` 读 `<task_name>.md`,`TaskSkillGuidanceInjector.inject` 在 user 消息追加 `Task-Specific Skill Reference:` + 引言 + 技能正文,幂等;配置 `task_skill_guidance.{enabled: false, skills_dir: null, recursive, heading, intro, strict}`)。技能语料本身不在仓库中。标准 `openmle_evo` profile 已经 `experience.enabled: true`,经验系统是 Evo 基线而非 Evo-Max 的增量;关闭路径只在 NatureBench 消融配置 `search/airaevo_naturebench_original_tts.yaml`。

### 6.9 验证划分指引与 NatureBench 适配器

`docs/mlebench_validation_split_instructions_22.md`:22 个任务各一节,含 `Recommended prompt instruction:` 围栏块与 Rationale;`tts_search/validation_split_guidance.py::patch_eval_data_with_guidance` 把 `Validation Split Guidance:` 块插在最后一条 user 消息的 `**FINAL OUTPUT**` 标记前,幂等,`strict` 时缺任务即报错。内容固定切分单位、比例/折数、`random_state=42`、精确指标、泄露约束,并写明"Do not choose the final solution by hidden/test/sandbox score"。

NatureBench(`aira-evo/examples/nature_bench/base_task.py::NatureBenchTask`,1,877 行):`execution_mode ∈ {docker, scm_docker, local}`;预检(AST 解析、禁止 `pip install`、在真实运行时探测 import 可用性,失败返回 `status_code 422 / preflight_failed` 不耗容器);GPU 池 `gpu_mode ∈ {none, exclusive, shared}` 锁文件实现,等待时长从日志标记解析出来做预算豁免;评分走 NatureBench evaluator HTTP,`X-NatureBench-Control-Token` 只用于控制端点,`score = aggregate_improvement`,`selection_score` 裁到 ±1.0;候选 env 白名单不继承密钥。Lite v2 固定 10 任务(`benchmarks/naturebench_lite_v2/tasks.txt`),每任务可见数据分析在 `tts_search/data/naturebench_lite_v2_eda/<task_id>.md`(只抽 `## 5. Empirical EDA Addendum` 节,缺失即报错);`submit_repeats: 0`,最终分取搜索阶段最佳 aggregate。配置 `search/airaevo_naturebench.yaml`:`step_limit 160`、`max_debug_depth 2`、`max_debug_time 1200`、`fresh_draft_prob 0.2`、`max_wall_time_secs 21600`、`execution_timeout 14400`、`time_budget 14400`。本地快速路径 `scripts/run_naturebench_local.py` + `environments/naturebench-local.yml`(conda 隔离,单任务 `s42256-023-00611-x`,README 声明 conda 是依赖隔离不是安全沙箱)。

### 6.10 测试不变量

`tests/`(9 文件)+ `aira-evo/tests/`(6 文件),`pyproject.toml` 两套一起跑。要点:`test_execution_profiles.py`(默认 `execution: standard`;搜索配置不得含执行键;`execution=multi_gpu` 翻转模式/worker/URL)、`test_public_release.py`(内部路径/IP/密钥禁用子串扫描;三个启动脚本钉 `PYTHONPATH`;Lite v2 恰好 10 个唯一任务)、`test_naturebench_integration.py`(30 个测试)、`test_review_regressions.py`(最终提交不在 `finally`;持久 4xx 立即返回)、`test_experience_memory.py`(13 个:卡片抽取、板统计、效用组件、只用自验证分、归一化模式切换、三个记忆渲染器、`prompt_memory` 总开关)、`test_async_steady_state.py`(17 个:同步与异步共用恢复路径、重试复用 attempt id、单 worker 异步不退化为 generation)、`test_validation_fitness_bugfix.py`(11 个:experience 模式跳过 analyze、`trust_model_validation_score` 默认 false、TLS 默认校验)、`test_prompt_score_sanitization.py`、`test_final_node_selection.py`、`test_aira_operator_prompt_budget.py`(七个 MLE 操作子 prompt 都含预算与提交守卫,超时降算力仅 Debug,`execution_timeout: 7200`)。

## 7. 实验与结果

### 7.1 协议

**论文**(§6.1):MLE-Bench Lite 官方 22 任务;每配置 3 次独立运行;每任务 12 h 沙箱预算,单张 RTX 4090 限 12 GB VRAM(脚注:按 MLE-Bench runs registry 的加速器分配与墙钟对比,不折算 FLOPs,不计模型推理成本)。Valid Rate = 产出合法提交的任务数均值(x/22);Medal Average = 获任意 Kaggle 奖牌的任务比例均值;Human Rank = 被提交方案超越的人类榜单参与者比例,按任务与运行平均。

### 7.2 MLE-Bench Lite(Table 1、Table 9)

A. 受控比较(均值 ± 标准差来自 Table 9):

| 模型 | Harness | Valid Rate | Medal Average | Human Rank |
|---|---|---:|---:|---:|
| Qwen3.6-35B-A3B | OpenMLE-Evo | 19.67±0.47 | 39.39%±5.67 | 0.5828±0.0278 |
| Frontis-MA1-35B | OpenMLE-Evo | 21.67±0.47 | 60.61%±7.73 | 0.7647±0.0376 |
| Frontis-MA1-35B | OpenMLE-Evo-Max | 22.00±0.00 | 71.21%±8.57 | 0.8126±0.0388 |
| Qwen3-30B-A3B-Thinking-2507 | OpenMLE-Evo | 17.33±0.47 | 34.85%±2.14 | 0.5573±0.0074 |
| Frontis-MA1-30B | OpenMLE-Evo | 21.67±0.47 | 53.03%±4.29 | 0.7055±0.0505 |
| Frontis-MA1-30B | OpenMLE-Evo-Max | 22.00±0.00 | 66.67%±5.67 | 0.8053±0.0236 |
| Frontis-MA1-35B | 原版 AIRA-Evo | — | 53.03% | — |
| GLM-5.2 | Claude Code / Evo / Evo-Max | 21.00 / 19.67 / 22.00 | 59.09% / 62.12% / 66.67% | 0.7948 / 0.7069 / 0.8164 |
| MiniMax M3 | Codex / Evo / Evo-Max | 22.00 / 22.00 / 22.00 | 54.55% / 59.09% / 65.15% | 0.7099 / 0.7994 / 0.8007 |
| Kimi K2.6 | Claude Code / Evo | 18.00 / 21.67 | 59.09% / 66.67% | 0.7062 / 0.7859 |
| MiniMax M2.7 | Claude Code / Evo | 18.00 / 22.00 | 45.50% / 50.00% | 0.5547 / 0.7039 |

B. 其它模型在 OpenMLE-Evo 下的 Medal Average:Grok-4.5 65.15%、LongCat-2.0 56.06%、Doubao Seed 2.1 Pro 56.06%、Qwen3.7 Plus 54.55%、DeepSeek-V4-Pro 54.55%、DeepSeek-V4-Flash 51.52%、GLM-4.7 51.52%、MiMo-V2.5-Pro 40.91%、Step-3.7 Flash 27.27%。

C. 通用编码代理参照:GPT-5.6 Sol + Codex 72.73%(HR 0.8891)、Kimi K3 + Claude Code 72.73%(0.8574)、GPT-5.5 + Codex 68.18%(0.7833)、Claude Opus 4.8 + Claude Code 63.64%(0.8219)、Gemini 3.5 Flash + Gemini CLI 63.64%(0.7499)、Claude Sonnet 5 + Claude Code 59.09%、Claude Sonnet 4.6 + Claude Code 54.55%。这些参照只评估一次(附录 D.1)。

论文对结果的三层表述:模型层(同 harness 下 35B 提升 21.22 pp、30B 提升 18.18 pp)、harness 层(同模型下 OpenMLE-Evo 优于 Claude Code/Codex 四个前沿模型的匹配比较,优于原版 AIRA-Evo)、系统层(35B + Evo-Max 71.21% 超过 GPT-5.5 + Codex 3.03 pp)。`docs/results.md` 强调这些是模型-harness 结果,Evo-Max 行是端到端系统结果。

### 7.3 长程自改进与机制(§6.3–6.5)

- Figure 12:12 h 累计沙箱时间的 Medal Rate 阶梯曲线,35B + Evo-Max 验证 68.2% → 测试 71.2%。
- leaf-classification(Figure 13):Debug 修 CV 与图像分支 → Improve 多模态 → 两次 Crossover 融合 → Improve 换 ConvNeXt-Tiny(log loss 0.02990),验证 HR 0.7713,留出 HR 0.9455 铜牌;后期 Improve/Crossover 贡献 85.0% 验证增益;最强对照验证 0.6303 无奖牌。
- mlsp-2013-birds(Figure 14):Debug 修提交 → Improve 音频融合 → Crossover 鲁棒音频 → Crossover 类平衡 → Improve focal + TTA → Crossover 记忆胜者(AUC 0.88576),验证 HR 0.7284,留出 0.8889 银牌;Improve/Crossover 贡献 91.9%;对照最高 0.2963。
- 效率(Figure 16,同 checkpoint、同种子、12 h、66 task-run):总 token 129.3M → 75.3M(−41.7%),prompt token 83.5M → 41.5M(−50.3%),评估节点 3,430 → 3,004(−12.4%),new-best 更新 229 → 246(+7.4%),每 1M token 的 new-best 1.77 → 3.27(+84.3%),Improve 命中新最优 44/931(4.73%)→ 72/769(9.36%);Improve prompt 均长 102.8K → 35.7K 字符(−65.3%),P99 389.0K → 54.3K(−86.1%);Crossover 均长 140.4K → 55.3K,P99 419.2K → 78.4K。
- nomad2018(Figure 17):原版 AIRA-Evo 单谱系连续 7 次 Debug,验证 RMSE 0.06633 / 留出 0.06096;OpenMLE-Evo 第 81 步用物理特征父(0.06309)与鲁棒解析父(0.06573)做定向 Crossover,水平记忆把 RDF 缓存 TypeError 与 3328×94 维度不匹配标为负证据,得 0.06087 / 0.05410(−8.2% / −11.3%)。
- right-whale(Figure 18):父 A 分数第一(AUC 0.99187),父 B 分数第六但增益第一(0.98773,+0.00568);权重 Score/Gain/Novelty 1.0/0.6/0.3 下 B 的选中概率从 10.47% 升到 17.09%(+63.2%),其 Improve 子节点验证 0.99203 / 留出 0.99386。论文注明端到端差异不应只归因于三个权重。
- 奖牌层级(Figure 15):训练与 Evo-Max 都把成功方案推向 Gold;35B + Evo-Max 的 Gold 率与 Kimi K3 相当。
- 模态分层(Figure 19):五组 Human Rank 全部上升,奖牌率不降;新增 14 枚奖牌分布 image/text/tabular/audio/multimodal = +2/+4/+1/+4/+3。

### 7.4 NatureBench Lite(§6.6、Table 2)

g = dir·(m − m_SOTA)/|m_SOTA|(Eq. 5);Match-SOTA 计 g ≥ 0,Surpass-SOTA 计 g > 0.1。Lite 固定 10 任务(六个领域、六种输入模态、四类 ML 任务,Table 10),保留隐藏评估器、禁网、每任务 4 h。

| 模型 | Harness | Surpass-SOTA | Match-SOTA |
|---|---|---:|---:|
| Frontis-MA1-35B | Evo NB adapter | 30.0% (3/10) | 70.0% (7/10) |
| Qwen3.6-35B-A3B | Evo NB adapter | 20.0% (2/10) | 50.0% (5/10) |
| Qwen3.6-35B-A3B | 原版 AIRA-Evo | 10.0% (1/10) | 20.0% (2/10) |

参照代理:Claude Opus 4.7 + Claude Code 80% S;GLM-5.2、Gemini 3.5 Flash 70% S / 100% M;GPT-5.5 60% S;GPT-5.4、GLM-5.1、MiniMax-M3 30% S / 70% M。蛋白变异效应案例:35B 在 11 个蛋白测定实例上 g = 0.1161(基座 0.0243),三因子选择器回访 0.0955 分支后由 Improve 达到最优。论文说明十任务规模下每个任务改变 10 个百分点。

### 7.5 公开发布面(附录 E、Table 11)

审计 19 项工作在 Data / Sandbox / Train code / RL method / Eval / Weights 六列的公开可得性:未发布训练模型的 14 项(AIDE、AutoMLGen、ML-Master 2.0、MLE-STAR、MLZero、AIRA-dojo、Famou-Agent 2.0、MLEvolve、AIBuildAI、MLAgentBench、MLGym、MLE-Dojo、MLE-Smith、R&D-Agent)与后训练代理 4 项(RL-MLE、ML-Agent、MLE-RL、AceGRPO);OpenMLE 六列全勾,MLE-Bench Lite Medal Rate 71.21%,运行设置 12h · RTX 4090(12G VRAM)。表中其它系统的最高分为 AIRA-dojo / Famou-Agent 2.0 的 80.30%(24h · 1×A800 / 12h · 1×H200,Gemini-3-Pro-Preview)。

## 8. 相关工作与局限

**相关工作**(§7)四条线:AutoResearch 系统与评估目标(AI Scientist、RE-Bench、PostTrainBench、MLGym、AIRS-Bench、MLRC-Bench、PaperBench、NatureBench、MLE-Bench、MLS-Bench);可执行 MLE 环境与可扩展任务资源(AutoML 系、MLAgentBench、DSBench、MLE-Dojo、MLE-Smith、SandMLE);推理时脚手架与演化搜索(多代理分解、结构化搜索、AIDE/AIRA 系、AlphaEvolve/ShinkaEvolve、ThetaEvolve/TTT-Discover);从可执行经验学习 MLE 代理(RLVR 系、RL-MLE、ML-Agent、MLE-RL、AceGRPO)以及 AI-for-AI 与可训练改进者(Meta-harness、HyperAgents、Harnessing agentic evolution)。

**局限**(§8)五条:改进者的目标只来自执行结果,不表达假设质量、推理过程、可迁移策略;演化搜索与通用编码代理分离,限制模型自主发起的动作范围;代理只参与外部 ML 工件改进,未涉及语言模型自身的改进;演化系统本身固定,未成为演化对象;父选择只用三个因子,卡片中大量确定性证据未利用,权重固定而非任务相关。

## 9. 论文表述与代码事实的差异

以下为逐条对照,仅陈述。

| # | 论文 / 文档 | 代码 |
|---|---|---|
| 1 | 三个任务来源(Anchors / Datasets / Competitions) | `OpenMLE-Gym/` 只实现 Kaggle Competition 构建路径 |
| 2 | 漏斗 ≈11,000 → 3,972 → 2,839 → 2,240 | 数字仅在 `docs/index.html` SVG 文本,无模块计算或持久化 |
| 3 | 六种沙箱反馈模式 | `task_dispatcher.py` 八个结果状态,多出 `metric_or_answer_missing` 与 `sandbox_unconfirmed` |
| 4 | `metric.py` 类名以 `Metrics` 结尾 | Gym `metric_validation.py` 严格 `endswith("Metrics")`;沙箱 `read_and_metric.py` 接受任何实现两方法的类,仅优先 `metrics` 后缀 |
| 5 | Figure 8「4.0× stronger upper-tail signal」 | `OpenMLE-ERL/` 无 4.0 常数;发布的上尾机制是 `power_clip`(α=1)+ `top1_top16` 界(下扩 0.25)+ KL=log 2 的熵优势 |
| 6 | Debug 有独立 prompt(附录 C.2) | RL `prompt_builder.build_prompt()`(`evo` 路径)把 improve 与 debug 映射到同一 Improve 模板;仅 `airaevo` 路径有独立 Debug 模板 |
| 7 | 任务按 CPU/GPU 需求分派 | RL `reward_func` 两个分支都用 `GPU_BASE_URL`,`CPU_BASE_URL` 无效 |
| 8 | o3-mini 评审检测 reward hacking | 评审响应为空或 JSON 解析失败时按 valid 放行 |
| 9 | right-whale 案例权重 1.0/0.6/0.3 | 代码与配置默认 1.0/0.4/0.25 |
| 10 | 父选择效用含 official-score-missing 惩罚项(默认权重 2.0) | 使用点硬编码为 0.0,旋钮无效 |
| 11 | 岛/迁移机制(FunSearch 风格) | 所有发布配置 `num_islands 1`、`migration_prob 0.0`,实际单池 |
| 12 | Evo-Max 的跨任务先验 | 注入机制 `task_skill_guidance.py` 存在,`skills_dir` 默认 `null`,语料未随仓库发布 |
| 13 | Program Database(Figure 5) | Evo 侧 `tts_search/program_database.py` 无生产调用路径;实际种群是 `Journal` + `SolutionsDatabase`;RL 侧 `RL/program_database.py` 是生产路径 |
| 14 | 经验卡记录 cost 与 token | Evo `_calculate_cost` 恒返回 0.0;后端缺 `usage` 时 token 按空格数估算 |
| 15 | 操作子由搜索算法选择 | Evo 中 Draft/Improve/Crossover 按固定随机规则选,Debug 只由 `is_buggy` 反应式触发 |
| 16 | 12 GB VRAM / RTX 4090 预算 | 代码只传 `resource_type` 与 `priority`,GPU 与显存限制由沙箱部署决定 |
| 17 | MLE-Bench 重叠排除 | `MLEBENCH_SLUGS` 约 75 个 slug 的名字级名单,无内容级去重 |
| 18 | 沙箱隔离执行 | README 声明 `private/` 非安全边界,worker `seccomp=unconfined`,引导密钥硬编码 |

## 术语表

| 术语 | 含义 |
|---|---|
| AI4AI | AI 参与构建或改进 AI 系统的活动;MLE 是其可执行、可验证的任务域 |
| Evolution / Self-Evolution / Meta-Evolution / RSI | 机制阶梯四级;本工作在 Meta-Evolution(改进者本身被训练) |
| Meta-evolution Agent (MA) | Frontis-MA1 名称由来:被训练并部署为演化 harness 变异引擎的模型 |
| Operator | Draft(从零生成)/ Improve(改进一个父)/ Debug(修复失败父)/ Crossover(重组两父);训练目标与推理接口共享 |
| Experience card | 节点级确定性经验记录(Table 6) |
| Experience board / `strategy_board.json` | 任务级聚合状态(Table 7),文件名沿用历史 |
| Three-factor utility | U = λ_s s̃ + λ_Δ Δ̃ + λ_n ν(质量 / 进展 / 新颖) |
| Operation-triggered memory synthesis | 仅对被选父与检索节点懒调用 LLM 生成 `method_overview` 与 `parent_comparison_experience` |
| Vertical / Horizontal memory | 祖先链 / 共父兄弟 |
| Valid Rate / Medal Average / Human Rank | 合法提交任务数 / 获奖牌任务比例 / 超越的人类参与者比例 |
| Match-SOTA / Surpass-SOTA | NatureBench 上 g ≥ 0 / g > 0.1 的任务比例 |
| Adaptive bounds (B, W) | 由 top-1 与第 16 名分数构成并与静态界取交的奖励归一化区间 |
| Entropic advantage | KL 预算下指数倾斜的 leave-one-out 组优势 |
| GSPO / TIS | 序列级策略优化目标 / 截断重要性采样 |
| Budget-adaptive SFT | 每任务达接受配额或耗尽执行预算即停的采样 |
| Parallel path / Evolutionary path | 独立 Draft 采样 / AIRA-Evo 搜索树段回收 |
| Causal inheritance | 多步段筛步准则:步骤的核心策略、必要中间状态或关键修复被后续继承并贡献终点 |
| `self_valid` | Evo 评分协议:用沙箱验证分(或模型自报的 Final Validation Score)做选点,官方分脱敏 |
| OpenMLE-Evo-Max | 异步多 GPU profile + MLE-Bench 无关的任务技能先验 |
| AIRA-Evo / AIRA-Dojo | vendored 的上游演化 harness 与运行时(CC BY-NC 4.0) |
| SLIME | THUDM 的 RL/SFT 训练框架(Ray + Megatron + SGLang) |
| Six feedback modes | success / code_execution_error / code_missing / submission_missing / scoring_failed / timeout |
