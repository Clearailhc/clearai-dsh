"""Summarise experiments/results.json into experiments/summary.md (tables + pre-registered checks)."""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(os.path.join(HERE, "results.json")))["records"]
CFGS = ["jepa_ema", "jepa_noema", "jepa_sigreg", "recon_ae", "recon_next"]
CONDS = ["iid", "fixed"]


def vals(cfg, cond, key):
    return np.array([r[key] for r in R if r["config"] == cfg and r["distractor"] == cond])


def ms(a, fmt="{:.3f}"):
    return (fmt + " ± " + fmt).format(a.mean(), a.std(ddof=1) if len(a) > 1 else 0.0)


L = ["# 玩具 JEPA 实验结果汇总", "",
     f"由 `experiments/summarize.py` 从 `experiments/results.json`({len(R)} 条记录)自动生成。均值 ± 样本标准差,n = 3 个种子。", "",
     "## 1. 全表", "",
     "| 干扰 | 配置 | probe_r2 | emb_std | eff_rank | final_loss |", "|---|---|---|---|---|---|"]
for cond in CONDS:
    for cfg in CFGS:
        L.append(f"| {cond} | {cfg} | {ms(vals(cfg, cond, 'probe_r2'))} | {ms(vals(cfg, cond, 'emb_std'), '{:.4g}')} | "
                 f"{ms(vals(cfg, cond, 'eff_rank'), '{:.2f}')} | {ms(vals(cfg, cond, 'final_loss'), '{:.3g}')} |")

L += ["", "## 2. 预先登记的检查(判据写于运行之前)", ""]
# (a) collapse
e = vals("jepa_ema", "iid", "emb_std").mean(); n = vals("jepa_noema", "iid", "emb_std").mean()
ratio = n / e
L += ["### (a) 无EMA会坍缩", "",
      f"- iid 干扰下 emb_std:jepa_noema = {n:.4g},jepa_ema = {e:.4g},比值 = **{ratio:.4%}**(阈值 10%)。",
      f"- 逐种子比值:" + ", ".join(f"{x / y:.4%}" for x, y in zip(vals('jepa_noema', 'iid', 'emb_std'), vals('jepa_ema', 'iid', 'emb_std'))),
      f"- 推翻条件「比值 ≥ 10%」:{'触发 → 推翻' if ratio >= 0.10 else '未触发 → 支持'}。",
      f"- 旁证:jepa_noema 的 probe_r2 = {ms(vals('jepa_noema', 'iid', 'probe_r2'))},final_loss ≈ {vals('jepa_noema', 'iid', 'final_loss').mean():.2g}(预测损失平凡地趋零)。"
      " 注意 eff_rank 在坍缩时反而高:剩下的是近乎各向同性的极小噪声,标准化后有效秩不能当作'没坍缩'的证据。", ""]
# (b) sigreg vs ema
re_ = vals("jepa_ema", "iid", "probe_r2").mean(); rs = vals("jepa_sigreg", "iid", "probe_r2").mean()
rel = (rs - re_) / re_
L += ["### (b) 正则可替代EMA", "",
      f"- iid 干扰下 probe_r2:jepa_sigreg = {ms(vals('jepa_sigreg', 'iid', 'probe_r2'))},jepa_ema = {ms(vals('jepa_ema', 'iid', 'probe_r2'))}。",
      f"- 相对差 (sigreg − ema)/ema = **{rel:+.2%}**(推翻阈值:低于 −10%)。",
      f"- 推翻条件「正则版低超过 10%」:{'触发 → 推翻' if rel < -0.10 else '未触发 → 支持'}。",
      f"- 旁证:fixed 干扰下 jepa_sigreg = {ms(vals('jepa_sigreg', 'fixed', 'probe_r2'))},jepa_ema = {ms(vals('jepa_ema', 'fixed', 'probe_r2'))}(不在判据内)。", ""]
# (c) iid: jepa vs recon
rj = vals("jepa_ema", "iid", "probe_r2"); ra = vals("recon_ae", "iid", "probe_r2"); rn = vals("recon_next", "iid", "probe_r2")
L += ["### (c) 潜空间抗干扰(iid 逐帧变化干扰)", "",
      f"- probe_r2:jepa_ema = {ms(rj)};recon_ae(主比较对象)= {ms(ra)};recon_next(补充)= {ms(rn)}。",
      f"- 推翻条件「recon_ae ≥ jepa_ema(3 种子均值)」:{'触发 → 推翻' if ra.mean() >= rj.mean() else '未触发 → 支持'}。",
      f"- 补充:recon_next {'≥' if rn.mean() >= rj.mean() else '<'} jepa_ema。", ""]
# (d) drop iid -> fixed
dj = rj.mean() - vals("jepa_ema", "fixed", "probe_r2").mean()
da = ra.mean() - vals("recon_ae", "fixed", "probe_r2").mean()
dn = rn.mean() - vals("recon_next", "fixed", "probe_r2").mean()
L += ["### (d) 静态干扰骗JEPA(iid → fixed 的下降)", "",
      f"- fixed 下 probe_r2:jepa_ema = {ms(vals('jepa_ema', 'fixed', 'probe_r2'))};recon_ae = {ms(vals('recon_ae', 'fixed', 'probe_r2'))};recon_next = {ms(vals('recon_next', 'fixed', 'probe_r2'))}。",
      f"- 下降量:jepa_ema = **{dj:.3f}**;recon_ae = **{da:.3f}**;recon_next = {dn:.3f}。",
      f"- 推翻条件「jepa_ema 下降 ≤ recon_ae 下降」:{'触发 → 推翻' if dj <= da else '未触发 → 支持'}。",
      f"- 补充:相对 recon_next,jepa_ema 下降 {'更大' if dj > dn else '不更大'}。",
      "- **地板效应警示**:fixed 下三者的 probe_r2 都在 0.02–0.04 之间(接近 0),jepa_ema 下降更大主要是因为它在 iid 下起点更高(0.961 vs 0.726)。"
      "按预先写下的判据这条不被推翻,但这次观测**区分不了**'JEPA 特有的慢特征失败'与'静态纹理占满 16 维瓶颈、所有方法一起失败'。"
      "要区分需加大嵌入维度或减弱纹理幅度,看重建模型能否恢复而 JEPA 不能(见 reports/final.md 未来方向)。", ""]
L += ["## 3. 解读边界", "",
      "- 16×16 合成图像、3 层 MLP、16 维嵌入、3000 步;结论只说明机制倾向,不外推到 ViT/真实视频规模。",
      "- fixed 条件下所有方法的 probe_r2 都可能很低:16 维瓶颈被低频静态纹理(4×4 粗网格插值,≈16 个自由度)占满时,重建与 JEPA 都会受害——这一点要和'JEPA 特有的慢特征失败'分开看。",
      "- SIGReg 为本脚本的简化实现(17 点 t 网格、32 个随机方向、λ=0.05),不是 LeJEPA 官方代码。",
      "- 冒烟测试中最初把 SIGReg 统计量多除了一次 batch size(与 LeJEPA 的 N·EP 缩放不符),导致正则过弱、也坍缩;已修正为 LeJEPA 的缩放后才做正式运行。此修正发生在正式运行之前,正式结果只有一份。", ""]
open(os.path.join(HERE, "summary.md"), "w").write("\n".join(L))
print("\n".join(L))
