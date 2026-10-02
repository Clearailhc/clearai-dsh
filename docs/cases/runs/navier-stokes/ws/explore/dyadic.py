"""
可重跑的数值探索:Katz–Pavlović / Cheskidov 型二进(dyadic)级联模型

    da_j/dt = λ^{j-1} a_{j-1}^2 - λ^j a_j a_{j+1} - ν λ^{2αj} a_j ,  j = 0..N-1,  a_{-1} = a_N = 0

非线性项保持能量 E = Σ a_j^2(逐项相消),能量只能被粘性项耗散;它是「能量一级级往小尺度推」
的最简玩具,对应 Tao 2016 平均化模型与 2026 年构造里的「级联」直觉。
文献(背景知识,未联网复核):Cheskidov (Trans. AMS 2008) 证明 α<1/3 时存在有限时间爆破、
α≥1/2 时全局正则;启发式:能量通量常数 ⇒ a_j ~ λ^{-j/3},非线性速率 ~ λ^{2j/3},
粘性速率 ~ ν λ^{2αj},α>1/3 时粘性在高壳层获胜。

判别方法(截断收敛检查):对三个截断 N = 14, 20, 26 各算一次,记录「顶层三壳层能量
首次超过 1e-4·E0 的时刻」(到达截断时刻 t_arr)。
  - 若真解在有限时间爆破,能量会在有限时间被推到任意高的壳层:各个 N 都会「到达」,
    且 t_arr 随 N 增大而收敛(相邻差值缩小),极限即爆破时刻的估计;
  - 若真解正则,高壳层能量随 j 超指数衰减:任何 N 都不会到达,H^1 峰值与 N 无关。
到达后即停止该次积分(截断以后的动力学是截断伪影,不再有意义)。
数值方法:积分因子(Lawson)RK4,步长倍增误差控制,全部确定性;无随机数。
运行:python3 explore/dyadic.py > explore/dyadic_out.txt
"""
import numpy as np

LAM = 2.0
NU = 0.05
T_END = 6.0
A0 = 1.0          # 初值:全部能量在 j=0,a_0 = 1
TOL = 1e-9

def rhs_nl(a, lamj):
    n = a.size
    out = np.zeros(n)
    # + λ^{j-1} a_{j-1}^2
    out[1:] += lamj[:-1] * a[:-1] ** 2
    # - λ^j a_j a_{j+1}
    out[:-1] -= lamj[:-1] * a[:-1] * a[1:]
    return out

def lawson_rk4(a, h, lamj, L):
    e_half = np.exp(-L * h / 2)
    e_full = np.exp(-L * h)
    k1 = rhs_nl(a, lamj)
    k2 = rhs_nl(e_half * (a + h / 2 * k1), lamj)
    k3 = rhs_nl(e_half * a + h / 2 * k2, lamj)
    k4 = rhs_nl(e_full * a + h * e_half * k3, lamj)
    return e_full * a + h / 6 * (e_full * k1 + 2 * e_half * (k2 + k3) + k4)

def run(alpha, N):
    j = np.arange(N, dtype=float)
    lamj = LAM ** j
    L = NU * LAM ** (2 * alpha * j)
    a = np.zeros(N); a[0] = A0
    t, h = 0.0, 1e-3
    E0 = float(np.sum(a ** 2))
    h1_peak, t_peak = float(np.sum(lamj ** 2 * a ** 2)), 0.0
    t_arr = None       # 顶层三壳层能量首次超过 1e-4·E0 的时刻
    steps = 0
    while t < T_END - 1e-15:
        h = min(h, T_END - t)
        big = lawson_rk4(a, h, lamj, L)
        half = lawson_rk4(lawson_rk4(a, h / 2, lamj, L), h / 2, lamj, L)
        err = np.max(np.abs(big - half)) / max(1.0, np.max(np.abs(half)))
        if err <= TOL or h < 1e-14:
            t += h; a = half; steps += 1
            h1 = float(np.sum(lamj ** 2 * a ** 2))
            if h1 > h1_peak:
                h1_peak, t_peak = h1, t
            if float(np.sum(a[-3:] ** 2)) > 1e-4 * E0:
                t_arr = t
                break
            h *= min(2.0, 0.9 * (TOL / max(err, 1e-300)) ** 0.2)
        else:
            h *= max(0.1, 0.9 * (TOL / err) ** 0.2)
    E_end = float(np.sum(a ** 2))
    top = float(np.sum(a[-3:] ** 2))         # 停止时刻顶层三壳层能量
    return dict(h1_peak=h1_peak, t_peak=t_peak, E_end=E_end, t_arr=t_arr,
                t_stop=t, top=top, steps=steps)

if __name__ == "__main__":
    alphas = [0.0, 0.2, 0.4, 0.6, 0.8]
    Ns = [14, 20, 26]
    print(f"参数:λ={LAM}, ν={NU}, T_end={T_END}, a_0(0)={A0}, 误差容限={TOL}, 截断 N ∈ {Ns}")
    print("「到达」= 顶层三壳层能量 > 1e-4·E0;到达即停止积分。")
    print()
    print(f"{'alpha':>5} {'N':>3} {'到达时刻':>10} {'停止时刻':>9} {'H1峰值(至停止)':>16} {'停止时能量':>10} {'停止时顶层能量':>15} {'步数':>7}")
    res = {}
    for al in alphas:
        for N in Ns:
            r = run(al, N); res[(al, N)] = r
            ta = f"{r['t_arr']:.6f}" if r['t_arr'] is not None else "未到达"
            print(f"{al:>5.1f} {N:>3d} {ta:>10} {r['t_stop']:>9.4f} {r['h1_peak']:>16.6e} {r['E_end']:>10.6f} {r['top']:>15.3e} {r['steps']:>7d}")
    print()
    print("截断收敛检查:")
    verdict = {}
    for al in alphas:
        rs = [res[(al, N)] for N in Ns]
        arr = [r['t_arr'] for r in rs]
        if all(x is not None for x in arr):
            d1, d2 = abs(arr[1] - arr[0]), abs(arr[2] - arr[1])
            conv = d2 < d1
            verdict[al] = "爆破迹象" if conv else "说不清"
            print(f"  α={al:.1f}: 三个截断都到达;t_arr = {[round(float(x), 6) for x in arr]};相邻差 {d1:.3e} → {d2:.3e};"
                  f"收敛={conv} → {verdict[al]}")
        elif all(x is None for x in arr):
            h = [r['h1_peak'] for r in rs]
            rel = max(abs(x - h[0]) for x in h) / h[0]
            verdict[al] = "正则(与截断无关)" if rel < 1e-6 else "说不清"
            print(f"  α={al:.1f}: 三个截断都未到达;H1 峰值相对差 {rel:.3e} → {verdict[al]}")
        else:
            verdict[al] = "说不清"
            print(f"  α={al:.1f}: 有的截断到达、有的未到达 {[None if x is None else round(float(x), 6) for x in arr]} → 说不清")
    print()
    print("读法:")
    print("  - Cheskidov(2008)的定理:α<1/3 有限时间爆破,α≥1/2 全局正则;1/3≤α<1/2 本脚本只作记录。")
    print("  - 「爆破迹象」= 能量在 N 越来越大时仍在几乎同一时刻到达截断(到达时刻收敛);")
    print("    「正则」= 能量从不到达截断且 H1 峰值与截断无关。")
    print("  这是玩具模型的数值迹象,不是对 Navier–Stokes 的证明。")
    print("判定汇总:", {f"{k:.1f}": v for k, v in verdict.items()})
