# 来源表(检索日期 2026-10-02)

## 访问方式说明(先读这一节)

- 本次环境的网络策略拦截了几乎所有网页全文抓取:arxiv.org、openai.com、cdn.openai.com、cims.nyu.edu、terrytao.wordpress.com、mathstodon.xyz、en.wikipedia.org、claymath.org、cnbc.com、cnn.com、quantamagazine.org、physicsworld.com、the-decoder.com、johndcook.com、scienceabc.com、lilting.ch、andrewwu.substack.com 均返回 `EGRESS_BLOCKED`(WebFetch)或连接失败(curl 返回码 000);GitHub API 仅限会话绑定仓库,无法检索 OpenAI 的 Lean 仓库。
- 因此下表中凡标「仅检索摘要」的,内容来自搜索引擎对该页的摘要/片段,**不是我读过的原文**;摘要可能失真或张冠李戴。凡标「背景知识」的,是 2026 年以前的经典文献,来自模型既有知识,本次未联网复核。
- 访问方式取值:`全文`(本次读到原文,本表中没有任何一条)/`仅检索摘要`/`被拦截`(尝试抓取被拒,内容只来自摘要)/`背景知识`。

## A. 2026 年 9 月事件的一手/准一手来源

| 编号 | 来源 | 链接 | 日期 | 访问方式 | 要点(摘要所述) |
|---|---|---|---|---|---|
| S1 | OpenAI 公告《On the Navier–Stokes Millennium Prize Problem》 | https://openai.com/index/navier-stokes-solution/ | 2026-09-08 | 被拦截;仅检索摘要 | 内部多智能体系统(约 1 万个 agent)约 88 小时得到证明(9-01 启动,9-05 得到);附 Lean 形式化(另 17 小时,GPT-6 Astra);「不打算申领千禧年奖」;自称对应 Clay 陈述 C,并称也有 D |
| S2 | OpenAI 论文《Finite Time Blowup for Navier–Stokes》PDF | https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf | 2026-09-08 | 被拦截;仅检索摘要 | 166 页;Theorem 1.1:对任意 ν>0,存在空间与时间上紧支、光滑的外力,使从静止出发的光滑解动能一致有界、在有限时间(t→1)速度无界;目录含「Realizing the admissible stress cone」「oscillatory realization」「correction of the residual stress」 |
| S3 | OpenAI 论文《Finite Time Blowup for the Euler Equation》PDF | https://cdn.openai.com/pdf/315b36cd-ec98-4023-8342-93345194ece1/euler.pdf | 2026-09-08 | 被拦截;仅检索摘要 | 57 页 Euler 版本 |
| S4 | OpenAI Lean 4 仓库(经 thenextweb、remio.ai、p.codekk.com 转述) | https://thenextweb.com/news/openai-navier-stokes-proof-published-millennium-prize ;https://www.remio.ai/post/openai-navier-stokes-proof-adds-lean-4-but-verification-is-not-finished | 2026-09 | 仅检索摘要 | 形式化两条:R³ 上存在光滑初值与外力使不存在动能一致有界的全局光滑解;T³ 上存在光滑周期初值与外力使不存在全局光滑解;仓库元数据自报 0 个 sorry,仅用 propext、Classical.choice、Quot.sound 三条标准公理——这是作者自报,不是独立核验 |
| S5 | Buckmaster 声明 statement.pdf | https://cims.nyu.edu/~tristanb/statement.pdf | 2026-09-07/08 | 被拦截;仅检索摘要 | 「Today, Levent Alpöge and I have made public three results: finite-time blowup with smooth forcing for incompressible porous media, for Boussinesq, and for 3d incompressible Euler.」并叙述 OpenAI 曾告诉他内部模型有约 100 页的强迫 NS 爆破证明,他未见过 |
| S6 | Buckmaster–Alpöge(–Coiculescu)三篇预印本:euler.pdf、ipm.pdf(arXiv 2609.16470「Extending the Córdoba–Martínez-Zoroa IPM Blow-Up to Uniformly Space-Time Smooth Forcing」)及 Boussinesq 篇 | https://cims.nyu.edu/~tristanb/euler.pdf ;https://cims.nyu.edu/~tristanb/ipm.pdf ;https://arxiv.org/abs/2609.16470 | 2026-09-07 | 被拦截;仅检索摘要 | 112 页强迫 3D Euler(轴对称带旋转,支撑在固定实心环内,力在奇点时刻仍光滑,涡量无界)、76 页 Boussinesq、57 页 IPM;均附 Lean 形式化 |
| S7 | Tao 博文《Finite time blowup with smooth forcing term for the IPM, Boussinesq, and incompressible Euler equations》 | https://terrytao.wordpress.com/2026/09/07/finite-time-blowup-with-smooth-forcing-term-for-the-incompressible-porous-medium-boussinesq-and-incompressible-euler-equations/ | 2026-09-07 | 被拦截;仅检索摘要 | 称 Alpöge–Buckmaster 工作「a remarkable achievement」,是把 Córdoba–Martínez-Zoroa 路线推到 Euler;CMZ 机制=多尺度归纳,每一层解作为背景流快速放大新加入的振荡波包;「很有可能也能推广到 Navier–Stokes」 |
| S8 | Tao 在 Mathstodon 的帖子 | https://mathstodon.xyz/@tao/117234157753860650 | 2026-09 | 被拦截;仅检索摘要 | 「By sheer coincidence, another …」(只见开头) |
| S9 | Clay 研究所 2026-09-11 声明(经 the-decoder、X@Math_files 转述) | https://the-decoder.com/clay-mathematics-institute-says-the-navier-stokes-millennium-prize-problem-has-apparently-been-settled/ ;https://x.com/Math_files/status/2099208844295757854 | 2026-09-11 | 被拦截;仅检索摘要 | 「shares in the excitement … the Navier-Stokes problem has apparently been settled」;评估与认定署名「deliberately unhurried」;未正式宣布解决 |
| S10 | Quanta《AI Has Solved One of Math's $1 Million Millennium Prize Problems》 | https://www.quantamagazine.org/ai-has-solved-one-of-maths-1-million-millennium-prize-problems-20260908/ | 2026-09-08 | 被拦截;仅检索摘要 | 用「无穷级联」比喻:涡里套更小更快的涡,每级用时递减,无穷多级装进有限时间;各层单独用光滑外力,但拼起来外力可能不好——这是「早先的解」没达到千禧年判据的原因;Clay 奖页仍写未解决 |
| S11 | Scientific American《Did OpenAI solve the wrong Navier-Stokes problem?》 | https://www.scientificamerican.com/article/did-openai-solve-the-wrong-navier-stokes-problem/ | 约 2026-09-21 | 仅检索摘要 | Luis Silvestre:「They essentially prove that the formulation with an external force was different from the problem we really wanted to solve.」;三位数学家证明 OpenAI 的方法不能推广到完整问题(去掉外力爆破就消失) |
| S12 | Constantin–Ignatova–Vicol, arXiv 2609.20803《Regularity of asymptotically axisymmetric solutions to the 3D NS equations with analytic forcing》 | https://arxiv.org/abs/2609.20803 | 2026-09 | 被拦截;仅检索摘要 | 在爆破成立的前提下,外力必违反某正则条件,且在奇点周围任何圆柱上都不恒为零;即 OpenAI 类构造不能用实解析外力实现(作者归属来自检索摘要,未核原文) |
| S13 | Wikipedia「Navier–Stokes priority controversy」 | https://en.wikipedia.org/wiki/Navier%E2%80%93Stokes_priority_controversy | 2026-09 | 被拦截;仅检索摘要 | 时间线:Buckmaster 声明约早于 OpenAI 公告 12 小时;OpenAI 否认直接利用其工作,称 Euler 情形证明方法「显著」不同,并称调查确认 Buckmaster 过去两个月的 Codex 提示不可能影响系统 |
| S14 | Wikipedia「Navier–Stokes existence and smoothness」 | https://en.wikipedia.org/wiki/Navier%E2%80%93Stokes_existence_and_smoothness | 2026-09 | 被拦截;仅检索摘要 | 2026-09-08 OpenAI 宣称解决「带光滑外力」版本;截至 2026-09-12 无经审稿的独立验证 |
| S15 | Fortune、TheNextWeb、Unite.AI、CyberNews、TechRepublic、Technology.org 等新闻 | https://fortune.com/2026/09/08/openai-says-it-cracked-navier-stokes-math-grand-challenge-buckmaster-accusation-cheating-intimidation-tao-lament/ ;https://thenextweb.com/news/openai-navier-stokes-claim-verification-credit ;https://www.unite.ai/buckmaster-and-alpoge-post-ai-fluid-blowup-proofs-dispute-openai-contact/ ;https://cybernews.com/ai-news/openai-navier-stokes-theft-accusations/ | 2026-09-08 至 09-12 | 仅检索摘要 | 争议细节:Buckmaster 称被要求在联合署名安排中去掉 Alpöge;OpenAI 称「did not see any of their work」;有报道称算力约 2200 万美元、6 天(数字口径不一,未核) |
| S16 | IBM Think《Will AI solve math too fast?》及 Fortune 对 Tao 的转述 | https://www.ibm.com/think/news/will-ai-solve-math-too-fast-navier-stokes-terence-tao | 2026-09 | 仅检索摘要 | Tao 9-03 发六部分案例;9-08 后批评:看重可消化的洞见、担心大规模 AI 追赶挫伤分享方向的意愿、呼吁公开失败尝试 |
| S17 | Tufts Daily《Mathematicians still checking the Navier-Stokes proof…》;webnovis.com 状态汇总 | https://www.tuftsdaily.com/article/2026/09/mathematicians-still-checking-the-navier-stokes-proof-that-openai-claims-to-have-solved ;https://www.webnovis.com/blog/en/openai-navier-stokes-what-was-actually-proven.html | 2026-09 下旬 | 仅检索摘要 | 状态:公开预印本 + Lean,接受审视中;期刊审稿与 Clay 两年期均未完成 |
| S18 | arXiv 2609.17642《Self-similar swirl between contracting porous walls: the GD1998 exact NS solution revisited in the similarity variables of the OpenAI 2026 forced blow-up construction》 | https://arxiv.org/abs/2609.17642 | 2026-09 | 被拦截;仅检索摘要 | 转述 OpenAI 构造的相似变量:τ=1−t,坍缩尺度 q(长度平方量纲),X=r²/2q(粘性相似半径),η=z/q^D(轴向),径向宽度收缩快于轴向长度;外力各分量之和及其各阶导数可光滑延拓过奇点时刻 |
| S19 | Medium(dharmakirti)、theneuron.ai、dev.to(axrisi)对证明机制的通俗转述 | https://medium.com/@dharmakirti/openai-found-a-navier-stokes-singularity-why-nature-still-cannot-reach-it-d34477a3498c ;https://www.theneuron.ai/news/inside-openais-navierstokes-claim-the-proof-the-ai-effort-and-the-credit-fight/ ;https://dev.to/axrisi/navier-stokes-solved-what-openais-proof-shows-and-why-its-disputed-4a31 | 2026-09 | 仅检索摘要 | 收缩涡、宽度比长度收缩更快、「像意大利面一样越来越细长」;振荡脉冲与修正抵消奇异误差使外力保持光滑 |
| S20 | Quomodocumque(Ellenberg)博文《Finite-time blowup》 | https://quomodocumque.wordpress.com/2026/09/07/finite-time-blowup/ | 2026-09-07 | 仅检索摘要(只见标题与日期) | — |
| S21 | Silicon Reckoner(Harris)、Computational Complexity 博客《Navier-Stokes and Lean》 | https://siliconreckoner.substack.com/p/if-you-dont-want-me-to-be-nice-then ;https://blog.computationalcomplexity.org/2026/09/navier-stokes-and-lean.html | 2026-09 | 仅检索摘要 | 讨论 Lean 0-sorry 只说明形式化陈述被证明,不说明形式化陈述忠实于非形式问题 |
| S22 | Córdoba–Martínez-Zoroa, arXiv 2410.22920《Finite time singularities of smooth solutions for the 2D IPM equation with a smooth source》 | https://arxiv.org/abs/2410.22920 | 2024-10-30 | 仅检索摘要 | 光滑有限能量解 + 紧支一致光滑源,有限时间奇点;53 页 |
| S23 | Wang, Lai, Gómez-Serrano, Buckmaster 等(Google DeepMind)arXiv 2509.14185《Discovery of Unstable Singularities》 | https://arxiv.org/abs/2509.14185 | 2025-09-17 | 仅检索摘要 | CCF、IPM(带边界)、Boussinesq 的不稳定自相似奇点,残差达 1e-8~1e-7 级,经验公式联系爆破率与不稳定阶;无外力方程的首个光滑不稳定自相似解(数值) |
| S24 | 其它 2026-09 arXiv 跟进(标题级):2609.33033(2D NS Galerkin 构造的 Lean 形式化)、2609.10262(紧支强迫 NS 爆破的奇异数据分布)、2609.10269(全空间奇异外力)、2608.18802(强迫 2D NS 有限时间爆破) | https://arxiv.org/abs/2609.33033 等 | 2026-08/09 | 仅检索摘要(只见标题) | 只作为「后续活动很多」的旁证,内容未核 |
| S25 | implicator.ai《Clay Institute Won't Call Navier-Stokes Solved by OpenAI》、dev.to(javieraguilarai)《Navier–Stokes Blows Up, and the Blow-up Is a Vortex You Can Picture》、mindstudio.ai 综述 | https://www.implicator.ai/clay-institute-navier-stokes-openai-proof-claim/ ;https://dev.to/javieraguilarai/navier-stokes-blows-up-and-the-blow-up-is-a-vortex-you-can-picture-38oi | 2026-09 | 仅检索摘要(且为搜索引擎对多页的综合) | 「无穷级联」是 Martínez-Zoroa 对 CMZ 技术的说法;Fefferman 称 Córdoba 与 Martínez-Zoroa 是「the heroes of the story」;两路工作都建立在 CMZ 上;OpenAI 是以内旋拉伸涡为中心的构造 |

## B. 背景经典文献(背景知识,本次未联网复核)

| 编号 | 文献 | 要点 |
|---|---|---|
| B1 | J. Leray, Acta Math. 63 (1934) | 弱解(Leray–Hopf)全局存在;若光滑解在 T 爆破则 ‖u(t)‖_∞ ≥ c·(ν/(T−t))^{1/2};提出自相似爆破设想 |
| B2 | Caffarelli–Kohn–Nirenberg, CPAM 35 (1982) | 适当弱解的奇异集一维抛物 Hausdorff 测度为零 |
| B3 | Nečas–Růžička–Šverák, Acta Math. 176 (1996);Tsai, ARMA 143 (1998) | 排除 L³ 类(及局部能量有限)的 Leray 型后向自相似爆破 |
| B4 | Escauriaza–Seregin–Šverák, Russ. Math. Surveys 58 (2003) | L^∞_t L³_x 有界则无爆破 |
| B5 | T. Tao, JAMS 29 (2016) 601–674「Finite time blowup for an averaged three-dimensional NS equation」 | 保留能量恒等式的平均化非线性下有限时间爆破;提出用「流体计算机」级联式实现的设想,表明仅凭能量方法无法证明正则性 |
| B6 | Buckmaster–Vicol, Annals 189 (2019) | 凸积分得到有限能量弱解不唯一 |
| B7 | Albritton–Brué–Colombo, Annals 196 (2022) | 带外力时 Leray–Hopf 解不唯一(利用不稳定自相似涡环) |
| B8 | T. Elgindi, Annals 194 (2021) | C^{1,α} 速度的 3D Euler 有限时间爆破 |
| B9 | Chen–Hou, arXiv 2210.07191(及 PNAS 2023 / 后续) | 带边界 2D Boussinesq 与轴对称 3D Euler 光滑初值稳定近自相似爆破,计算机辅助证明(Hou–Luo 场景) |
| B10 | Hou, arXiv 2107.06509 等(2021–2023) | 3D 轴对称 NS 潜在爆破的数值证据 |
| B11 | Katz–Pavlović, TAMS 357 (2005);Cheskidov, 2008 | 二进(dyadic)级联模型的有限时间爆破与耗散阈值 |
| B12 | C. Fefferman, Clay 官方问题陈述(2000/2006) | 四款陈述 A(R³ 无外力存在光滑)、B(T³ 无外力存在光滑)、C(R³ 破坏:存在光滑速降初值与满足衰减条件的光滑外力使无光滑有限能量解)、D(T³ 破坏:存在光滑周期初值与外力) |
