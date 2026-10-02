# 实体关系图

由 `clear/ontology/entities/` 自动生成(共 59 个实体、70 条对象关系)。图一画结果—方程—陈述—技术—机构;图二画人物—结果—机构。字面值关系(日期、外力条件、审稿状态)见各实体文件。

## 图一:结果、方程、Clay 陈述、技术

```mermaid
flowchart LR
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|对应| clay_ns_c["Clay NS 陈述 C"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|对应| clay_ns_d["Clay NS 陈述 D"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|机构| openai["OpenAI"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|建立在| cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|优先权争议| ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|技术| tech_anisotropic_selfsimilar_core["各向异性自相似涡核(相似变量 τ, q, X=r²/2q, η=z/q^D)"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|技术| tech_oscillatory_stress_realization["可容许应力锥的振荡实现与残余应力修正"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|技术| tech_lean4["Lean 4 形式化"]
  ckn_1982["Caffarelli–Kohn–Nirenberg 部分正则性"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  ckn_1982["Caffarelli–Kohn–Nirenberg 部分正则性"] -->|建立在| leray_1934["Leray 1934:弱解存在与爆破速率下界"]
  tao_averaged_ns_2016["Tao 平均化 NS 有限时间爆破"] -->|关于| averaged_ns["Tao 平均化 NS 方程"]
  deepmind_unstable_2025["DeepMind 等《Discovery of Unstable Singularities》"] -->|关于| boussinesq2d["2D Boussinesq 方程"]
  deepmind_unstable_2025["DeepMind 等《Discovery of Unstable Singularities》"] -->|关于| ipm2d["2D IPM 方程"]
  deepmind_unstable_2025["DeepMind 等《Discovery of Unstable Singularities》"] -->|机构| google_deepmind["Google DeepMind"]
  ba_boussinesq_forced_2026["Alpöge–Buckmaster 强迫 2D Boussinesq 爆破"] -->|关于| boussinesq2d["2D Boussinesq 方程"]
  ba_boussinesq_forced_2026["Alpöge–Buckmaster 强迫 2D Boussinesq 爆破"] -->|建立在| cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"]
  buckmaster_vicol_2019["Buckmaster–Vicol 弱解不唯一"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  chen_hou_2022["Chen–Hou 带边界 Boussinesq/Euler 稳定近自相似爆破"] -->|关于| boussinesq2d["2D Boussinesq 方程"]
  chen_hou_2022["Chen–Hou 带边界 Boussinesq/Euler 稳定近自相似爆破"] -->|关于| euler3d["3D 不可压 Euler 方程"]
  chen_hou_2022["Chen–Hou 带边界 Boussinesq/Euler 稳定近自相似爆破"] -->|技术| tech_interval_arithmetic["区间算术计算机辅助证明"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|关于| euler3d["3D 不可压 Euler 方程"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|建立在| cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|技术| tech_cmz_infinite_cascade["CMZ 无穷级联(背景流放大振荡波包)"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|技术| tech_lean4["Lean 4 形式化"]
  ba_ipm_forced_2026["Alpöge–Buckmaster 强迫 IPM 爆破(arXiv 2609.16470)"] -->|关于| ipm2d["2D IPM 方程"]
  ba_ipm_forced_2026["Alpöge–Buckmaster 强迫 IPM 爆破(arXiv 2609.16470)"] -->|建立在| cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"]
  abc_2022["Albritton–Brué–Colombo 强迫 Leray–Hopf 不唯一"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  civ_analytic_obstruction_2026["Constantin–Ignatova–Vicol 解析外力障碍(arXiv 2609.20803)"] -->|障碍| openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"]
  civ_analytic_obstruction_2026["Constantin–Ignatova–Vicol 解析外力障碍(arXiv 2609.20803)"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  openai_euler_blowup_2026["OpenAI 强迫 3D Euler 有限时间爆破(2026)"] -->|关于| euler3d["3D 不可压 Euler 方程"]
  openai_euler_blowup_2026["OpenAI 强迫 3D Euler 有限时间爆破(2026)"] -->|机构| openai["OpenAI"]
  cheskidov_dyadic_2008["Cheskidov 二进模型爆破/正则阈值"] -->|关于| dyadic_kp["Katz–Pavlović / Cheskidov 二进模型"]
  ess_2003["Escauriaza–Seregin–Šverák L³ 判据"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"] -->|关于| ipm2d["2D IPM 方程"]
  cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"] -->|技术| tech_cmz_infinite_cascade["CMZ 无穷级联(背景流放大振荡波包)"]
  leray_1934["Leray 1934:弱解存在与爆破速率下界"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  elgindi_2021["Elgindi C^{1,α} Euler 爆破"] -->|关于| euler3d["3D 不可压 Euler 方程"]
  nrs_1996["Nečas–Růžička–Šverák 排除 Leray 自相似爆破"] -->|关于| ns3d["3D 不可压 Navier–Stokes 方程"]
  nrs_1996["Nečas–Růžička–Šverák 排除 Leray 自相似爆破"] -->|障碍| leray_1934["Leray 1934:弱解存在与爆破速率下界"]
```

## 图二:人物与机构

```mermaid
flowchart LR
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|发表于| pub_openai_ns_paper["OpenAI《Finite Time Blowup for Navier–Stokes》(166 页)"]
  openai_ns_blowup_2026["OpenAI 强迫 3D NS 有限时间爆破(2026)"] -->|发表于| pub_openai_lean_repo["OpenAI NS/Euler Lean 4 仓库"]
  pub_buckmaster_statement["Buckmaster 声明 statement.pdf"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  terence_tao["Terence Tao"] -->|任职| ucla["UCLA"]
  tao_averaged_ns_2016["Tao 平均化 NS 有限时间爆破"] -->|作者| terence_tao["Terence Tao"]
  deepmind_unstable_2025["DeepMind 等《Discovery of Unstable Singularities》"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  deepmind_unstable_2025["DeepMind 等《Discovery of Unstable Singularities》"] -->|作者| javier_gomez_serrano["Javier Gómez-Serrano"]
  ba_boussinesq_forced_2026["Alpöge–Buckmaster 强迫 2D Boussinesq 爆破"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  ba_boussinesq_forced_2026["Alpöge–Buckmaster 强迫 2D Boussinesq 爆破"] -->|作者| levent_alpoge["Levent Alpöge"]
  buckmaster_vicol_2019["Buckmaster–Vicol 弱解不唯一"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  buckmaster_vicol_2019["Buckmaster–Vicol 弱解不唯一"] -->|作者| vlad_vicol["Vlad Vicol"]
  chen_hou_2022["Chen–Hou 带边界 Boussinesq/Euler 稳定近自相似爆破"] -->|作者| jiajie_chen["Jiajie Chen"]
  chen_hou_2022["Chen–Hou 带边界 Boussinesq/Euler 稳定近自相似爆破"] -->|作者| thomas_hou["Thomas Y. Hou"]
  tristan_buckmaster["Tristan Buckmaster"] -->|任职| nyu_courant["纽约大学 Courant 研究所"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|作者| levent_alpoge["Levent Alpöge"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  ba_euler_forced_2026["Alpöge–Buckmaster(–Coiculescu)强迫 3D Euler 爆破"] -->|作者| matei_coiculescu["Matei P. Coiculescu"]
  ba_ipm_forced_2026["Alpöge–Buckmaster 强迫 IPM 爆破(arXiv 2609.16470)"] -->|作者| tristan_buckmaster["Tristan Buckmaster"]
  ba_ipm_forced_2026["Alpöge–Buckmaster 强迫 IPM 爆破(arXiv 2609.16470)"] -->|作者| levent_alpoge["Levent Alpöge"]
  civ_analytic_obstruction_2026["Constantin–Ignatova–Vicol 解析外力障碍(arXiv 2609.20803)"] -->|作者| peter_constantin["Peter Constantin"]
  civ_analytic_obstruction_2026["Constantin–Ignatova–Vicol 解析外力障碍(arXiv 2609.20803)"] -->|作者| mihaela_ignatova["Mihaela Ignatova"]
  civ_analytic_obstruction_2026["Constantin–Ignatova–Vicol 解析外力障碍(arXiv 2609.20803)"] -->|作者| vlad_vicol["Vlad Vicol"]
  levent_alpoge["Levent Alpöge"] -->|任职| anthropic["Anthropic"]
  diego_cordoba["Diego Córdoba"] -->|任职| icmat_csic["ICMAT-CSIC"]
  vlad_vicol["Vlad Vicol"] -->|任职| nyu_courant["纽约大学 Courant 研究所"]
  pub_openai_lean_repo["OpenAI NS/Euler Lean 4 仓库"] -->|机构| openai["OpenAI"]
  cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"] -->|作者| diego_cordoba["Diego Córdoba"]
  cmz_ipm_blowup_2024["Córdoba–Martínez-Zoroa 强迫 IPM 奇点(arXiv 2410.22920)"] -->|作者| luis_martinez_zoroa["Luis Martínez-Zoroa"]
  pub_clay_2026_09_11["Clay 研究所 2026-09-11 声明"] -->|机构| clay_math_institute["Clay 数学研究所"]
  pub_openai_ns_paper["OpenAI《Finite Time Blowup for Navier–Stokes》(166 页)"] -->|机构| openai["OpenAI"]
```

两图共覆盖 54 个实体。

## 读图要点

- `openai_ns_blowup_2026` 对应 Clay 陈述 C 与 D(宣称),与 `ba_euler_forced_2026` 之间有优先权争议;`civ_analytic_obstruction_2026` 对它构成障碍(解析外力不可行)。
- 强迫爆破一族(CMZ 2024 → Alpöge–Buckmaster 三篇 → OpenAI)都指向 CMZ;OpenAI 指向 CMZ 的那条边只据综合摘要(S25),可信度低于其余边。
- 无外力路线(Chen–Hou、DeepMind 2025)与强迫路线在图上是两簇,中间只靠 Buckmaster 一个人连接。
