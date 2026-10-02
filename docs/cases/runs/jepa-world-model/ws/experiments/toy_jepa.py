"""Toy JEPA vs pixel-reconstruction world models on synthetic 16x16 frames.

Latent state: (x, y) position of a target blob. Action: displacement (dx, dy).
Each training sample is a transition (frame_t, action_t, frame_{t+1}).

Distractor conditions
  iid   : distractors re-sampled independently in every frame (unpredictable):
          3 small bright dots at random positions + Gaussian pixel noise (std 0.3)
  fixed : a smooth random texture (amplitude ~1) shared by frame_t and frame_{t+1}
          (a "slow feature", predictable across time) + small pixel noise (std 0.1)

Configs (same encoder MLP 256->256->256->D for all)
  jepa_ema    : predictor(z_t, a) -> EMA target encoder(frame_{t+1}), stop-grad on target
  jepa_noema  : target = online encoder (gradients flow into both branches), no regulariser
  jepa_sigreg : same as jepa_noema + SIGReg-style isotropic-Gaussian regulariser
                (Epps-Pulley characteristic-function test on random 1-D projections,
                after LeJEPA, Balestriero & LeCun 2025)
  recon_ae    : autoencoder: decoder(z_t) -> frame_t pixels (MAE-style pixel reconstruction)
  recon_next  : generative world model: decoder(predictor(z_t, a)) -> frame_{t+1} pixels

Metrics (computed on 4000 held-out frames, distractor drawn per the condition)
  emb_std  : mean over dims of the std of raw encoder outputs
  probe_r2 : ridge-regression linear probe from standardised embeddings to (x, y);
             fitted on 3000 frames, R^2 averaged over x and y on the remaining 1000
  eff_rank : exp(entropy of normalised singular values) of centred embeddings

Usage: python3 experiments/toy_jepa.py  [--steps N] [--seeds 0 1 2] [--out experiments/results.json]
"""
import argparse, copy, json, math, os, time
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

H = W = 16
D = 16  # embedding dim
GRID_Y, GRID_X = torch.meshgrid(torch.arange(H, dtype=torch.float32),
                                torch.arange(W, dtype=torch.float32), indexing="ij")


def blob(px, py, sigma, amp=1.0):
    # px, py: (B,) -> (B, H, W)
    dx = GRID_X[None] - px[:, None, None]
    dy = GRID_Y[None] - py[:, None, None]
    return amp * torch.exp(-(dx ** 2 + dy ** 2) / (2 * sigma ** 2))


def smooth_texture(B, g):
    # low-frequency random texture, amplitude ~1
    coarse = torch.randn(B, 1, 4, 4, generator=g)
    tex = F.interpolate(coarse, size=(H, W), mode="bilinear", align_corners=False)[:, 0]
    return tex / (tex.flatten(1).std(1)[:, None, None] + 1e-6)


def iid_distractor(B, g):
    d = torch.zeros(B, H, W)
    for _ in range(3):
        px = torch.rand(B, generator=g) * (W - 1)
        py = torch.rand(B, generator=g) * (H - 1)
        d = d + blob(px, py, 0.6, 1.0)
    return d + 0.3 * torch.randn(B, H, W, generator=g)


def sample_batch(B, cond, g):
    pos = 2 + torch.rand(B, 2, generator=g) * (W - 5)          # in [2, 13]
    act = (torch.rand(B, 2, generator=g) * 4 - 2)                 # in [-2, 2]
    nxt = (pos + act).clamp(2, W - 3)
    act = nxt - pos                                                # effective action
    f0 = blob(pos[:, 0], pos[:, 1], 1.5)
    f1 = blob(nxt[:, 0], nxt[:, 1], 1.5)
    if cond == "iid":
        f0 = f0 + iid_distractor(B, g)
        f1 = f1 + iid_distractor(B, g)
    elif cond == "fixed":
        tex = smooth_texture(B, g)
        f0 = f0 + tex + 0.1 * torch.randn(B, H, W, generator=g)
        f1 = f1 + tex + 0.1 * torch.randn(B, H, W, generator=g)
    else:
        raise ValueError(cond)
    return f0.flatten(1), act, f1.flatten(1), pos


def mlp(i, h, o, n=3):
    layers, d = [], i
    for _ in range(n - 1):
        layers += [nn.Linear(d, h), nn.GELU()]
        d = h
    layers.append(nn.Linear(d, o))
    return nn.Sequential(*layers)


def sigreg(z, g_dev, n_proj=32):
    """SIGReg-style loss: Epps-Pulley statistic of random 1-D projections vs N(0,1)."""
    Bn, d = z.shape
    A = torch.randn(d, n_proj, generator=g_dev)
    A = A / A.norm(dim=0, keepdim=True)
    p = z @ A                                                      # (B, P)
    t = torch.linspace(-3, 3, 17)
    pt = p[:, :, None] * t[None, None, :]                          # (B, P, T)
    ecf_re = torch.cos(pt).mean(0)
    ecf_im = torch.sin(pt).mean(0)
    target = torch.exp(-t ** 2 / 2)
    w = torch.exp(-t ** 2 / 2)
    stat = ((ecf_re - target) ** 2 + ecf_im ** 2) * w             # (P, T)
    return torch.trapezoid(stat, t, dim=1).mean() * Bn


def train(cfg, cond, seed, steps, bs=256, lr=1e-3):
    torch.manual_seed(seed)
    g = torch.Generator().manual_seed(1000 + seed)
    g_proj = torch.Generator().manual_seed(2000 + seed)
    enc = mlp(H * W, 256, D)
    pred = mlp(D + 2, 128, D)
    params = list(enc.parameters()) + list(pred.parameters())
    dec = None
    if cfg.startswith("recon"):
        dec = mlp(D, 256, H * W)
        params += list(dec.parameters())
    tgt = None
    if cfg == "jepa_ema":
        tgt = copy.deepcopy(enc)
        for p in tgt.parameters():
            p.requires_grad_(False)
    opt = torch.optim.Adam(params, lr=lr)
    lam = 0.05
    for it in range(steps):
        f0, a, f1, _ = sample_batch(bs, cond, g)
        z0 = enc(f0)
        if cfg == "jepa_ema":
            with torch.no_grad():
                zt = tgt(f1)
            loss = F.mse_loss(pred(torch.cat([z0, a], 1)), zt)
        elif cfg == "jepa_noema":
            zt = enc(f1)
            loss = F.mse_loss(pred(torch.cat([z0, a], 1)), zt)
        elif cfg == "jepa_sigreg":
            zt = enc(f1)
            lp = F.mse_loss(pred(torch.cat([z0, a], 1)), zt)
            # as in LeJEPA: statistic scaled by batch size (N * EP), lambda = 0.05
            lr_ = 0.5 * (sigreg(z0, g_proj) + sigreg(zt, g_proj))
            loss = (1 - lam) * lp + lam * lr_
        elif cfg == "recon_ae":
            loss = F.mse_loss(dec(z0), f0)
        elif cfg == "recon_next":
            loss = F.mse_loss(dec(pred(torch.cat([z0, a], 1))), f1)
        else:
            raise ValueError(cfg)
        opt.zero_grad()
        loss.backward()
        opt.step()
        if tgt is not None:
            m = 0.99 + (0.999 - 0.99) * it / steps
            with torch.no_grad():
                for pt_, po in zip(tgt.parameters(), enc.parameters()):
                    pt_.mul_(m).add_(po, alpha=1 - m)
    return enc, float(loss.item())


def evaluate(enc, cond, seed):
    g = torch.Generator().manual_seed(9000 + seed)
    f0, _, _, pos = sample_batch(4000, cond, g)
    with torch.no_grad():
        z = enc(f0).numpy().astype(np.float64)
    y = pos.numpy().astype(np.float64)
    emb_std = float(z.std(0).mean())
    zc = z - z.mean(0)
    s = np.linalg.svd(zc, compute_uv=False)
    p = s / (s.sum() + 1e-12)
    eff_rank = float(np.exp(-(p * np.log(p + 1e-12)).sum()))
    zs = zc / (z.std(0) + 1e-8)
    Xtr, Xte, ytr, yte = zs[:3000], zs[3000:], y[:3000], y[3000:]
    Xtr1 = np.hstack([Xtr, np.ones((3000, 1))])
    Xte1 = np.hstack([Xte, np.ones((1000, 1))])
    lam = 1e-2
    Wr = np.linalg.solve(Xtr1.T @ Xtr1 + lam * np.eye(Xtr1.shape[1]), Xtr1.T @ ytr)
    yp = Xte1 @ Wr
    r2 = 1 - ((yte - yp) ** 2).sum(0) / ((yte - yte.mean(0)) ** 2).sum(0)
    return emb_std, float(r2.mean()), eff_rank


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    ap.add_argument("--configs", nargs="+",
                    default=["jepa_ema", "jepa_noema", "jepa_sigreg", "recon_ae", "recon_next"])
    ap.add_argument("--conds", nargs="+", default=["iid", "fixed"])
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "results.json"))
    args = ap.parse_args()
    torch.set_num_threads(4)
    records = []
    for cond in args.conds:
        for cfg in args.configs:
            for seed in args.seeds:
                t0 = time.time()
                enc, final_loss = train(cfg, cond, seed, args.steps)
                emb_std, r2, er = evaluate(enc, cond, seed)
                rec = dict(config=cfg, distractor=cond, seed=seed, steps=args.steps,
                           final_loss=final_loss, emb_std=emb_std, probe_r2=r2,
                           eff_rank=er, seconds=round(time.time() - t0, 1))
                print(json.dumps(rec), flush=True)
                records.append(rec)
    meta = dict(script="experiments/toy_jepa.py", torch=torch.__version__,
                embedding_dim=D, image=f"{H}x{W}", n_records=len(records))
    with open(args.out, "w") as f:
        json.dump(dict(meta=meta, records=records), f, indent=1)


if __name__ == "__main__":
    main()
