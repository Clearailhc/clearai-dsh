"""
可重跑的符号/量纲探索:Navier–Stokes 的标度不变性 + 各向异性坍缩涡核的量纲约束。
运行:python3 explore/scaling.py > explore/scaling_out.txt   (需要 sympy;无随机性)

模型(启发式量纲分析,不是证明):
  τ = T - t → 0⁺ 是到奇点的时间。涡核径向宽度 R ~ τ^a,轴向长度 L ~ τ^b,
  速度尺度 U ~ τ^(-c)。各向异性:a > b > 0(径向收缩快于轴向,对应 OpenAI 构造
  中 X = r²/2q、η = z/q^D 的读法,D<1/2;见 research/proof-outline.md K1)。
  ν 取 1(只关心 τ 的指数)。
约束:
  (E)   动能 ~ U² R² L 有界                 ⇔ 2a + b - 2c ≥ 0
  (Re)  局部雷诺数 U R / ν → ∞              ⇔ c > a
  (Ler) Leray 下界 ‖u‖∞ ≥ C (ν/τ)^{1/2}     ⇔ c ≥ 1/2
  (Dis) 耗散 ν∫‖∇u‖²dt 有限(能量不等式)   ⇔ b - 2c + 1 > 0     (‖∇u‖₂² ~ U² L)
  (ST)  自相似时间:翻转时间 R/U ~ τ        ⇔ a + c = 1
  (An)  各向异性                            ⇔ a > b > 0
  附带:‖u‖_{L³}³ ~ U³ R² L,ESS 定理要求它在爆破时发散 ⇔ 2a + b - 3c < 0
"""
import sympy as sp
from fractions import Fraction

print("=== 1. NS 标度不变性的符号校验 ===")
x, y, z, t, lam, nu = sp.symbols('x y z t lambda nu', positive=True)
X, Y, Z, T = sp.symbols('X Y Z T')
u = [sp.Function(f'u{i}')(X, Y, Z, T) for i in range(3)]
p = sp.Function('p')(X, Y, Z, T)
coords = (X, Y, Z)

def ns_residual(uu, pp, xs, tt):
    res = []
    for i in range(3):
        e = sp.diff(uu[i], tt) + sum(uu[j]*sp.diff(uu[i], xs[j]) for j in range(3)) \
            - nu*sum(sp.diff(uu[i], xs[j], 2) for j in range(3)) + sp.diff(pp, xs[i])
        res.append(e)
    div = sum(sp.diff(uu[j], xs[j]) for j in range(3))
    return res, div

# 原方程残差 F_i(X,Y,Z,T)(= 外力 f_i)
F, D = ns_residual(u, p, coords, T)
# 缩放后的场:u_λ(x,t) = λ u(λx, λ² t),p_λ = λ² p(λx, λ² t)
sub = {X: lam*x, Y: lam*y, Z: lam*z, T: lam**2*t}
ul = [lam*ui.subs(sub) for ui in u]
pl = lam**2*p.subs(sub)
Fl, Dl = ns_residual(ul, pl, (x, y, z), t)
diffs = [sp.simplify(sp.expand(Fl[i] - lam**3*F[i].subs(sub))) for i in range(3)]
ddiv = sp.simplify(sp.expand(Dl - lam**2*D.subs(sub)))
print("NS_λ[u_λ]_i - λ³·NS[u]_i(λx,λ²t) =", diffs)
print("div u_λ - λ²·(div u)(λx,λ²t)      =", ddiv)
print("结论:三分量差均为 0 且散度差为 0 →",
      all(d == 0 for d in diffs) and ddiv == 0,
      "(外力随之按 f_λ = λ³ f(λx, λ²t) 缩放)")

print()
print("=== 2. 各向异性坍缩的指数代数 ===")
a, b, c = sp.symbols('a b c', real=True)
E_exp = 2*a + b - 2*c
Re_exp = a - c          # Re ~ τ^(a-c),→∞ 需 a-c<0
L3_exp = 2*a + b - 3*c
Dis_exp = b - 2*c + 1   # ∫ τ^(b-2c) dτ 有限需 b-2c > -1
print("动能 ~ τ^(%s);Re ~ τ^(%s);‖u‖_3^3 ~ τ^(%s);‖∇u‖_2^2 ~ τ^(%s)" %
      (E_exp, Re_exp, L3_exp, b - 2*c))

# 在自相似时间 a + c = 1 下消去 c
csub = 1 - a
print("代入 a + c = 1:")
print("  (E)   ", sp.simplify(E_exp.subs(c, csub)), ">= 0")
print("  (Re)  ", sp.simplify(Re_exp.subs(c, csub)), "< 0   ⇔ a < 1/2")
print("  (Ler) ", sp.simplify(csub), ">= 1/2 ⇔ a <= 1/2")
print("  (Dis) ", sp.simplify(Dis_exp.subs(c, csub)), "> 0")
print("  (An)   a > b > 0")
# 由 (E): b >= 2 - 4a;与 b < a 联立 ⇒ 2 - 4a < a ⇒ a > 2/5
sol_a = sp.solve_univariate_inequality(2 - 4*a < a, a, relational=False)
print("  (E)+(An) 联立 ⇒ 2-4a < a ⇒ a ∈", sol_a)
print("  再与 (Re) a<1/2 联立 ⇒ 可行区间 2/5 < a < 1/2,b ∈ [max(2-4a, 1-2a, 0⁺), a)")

print()
print("=== 3. 具体例子(精确有理数) ===")
def check(av, bv, cv, label):
    av, bv, cv = Fraction(av), Fraction(bv), Fraction(cv)
    E = 2*av + bv - 2*cv; Re = av - cv; L3 = 2*av + bv - 3*cv; Dis = bv - 2*cv + 1
    ok = dict(E=E >= 0, Re=Re < 0, Ler=cv >= Fraction(1, 2), Dis=Dis > 0,
              ST=av + cv == 1, An=av > bv > 0, ESS=L3 < 0)
    print(f"{label}: a={av}, b={bv}, c={cv} | 动能指数={E}, Re指数={Re}, L3^3指数={L3}, 耗散被积指数={bv-2*cv}")
    print("   条件满足:", ok, "→ 全部满足" if all(ok.values()) else "→ 有不满足")
    return ok
check('9/20', '3/10', '11/20', "例1(各向异性)")
check('9/20', '9/20', '11/20', "例2(各向同性 a=b)")
check('1/2', '1/2', '1/2', "例3(Leray 各向同性自相似)")
check('1/2', '1/4', '1/2', "例4(R~τ^1/2 的粘性尺度涡核)")

print()
print("=== 4. 网格计数(步长 1/100,a,b ∈ (0,1),c = 1-a) ===")
N = 100
feas = feas_iso = feas_aniso = 0
amin = None; amax = None
for i in range(1, N):
    for j in range(1, N):
        av = Fraction(i, N); bv = Fraction(j, N); cv = 1 - av
        E = 2*av + bv - 2*cv; Re = av - cv; Dis = bv - 2*cv + 1; L3 = 2*av + bv - 3*cv
        if E >= 0 and Re < 0 and cv >= Fraction(1, 2) and Dis > 0 and L3 < 0 and bv <= av:
            feas += 1
            if bv == av: feas_iso += 1
            else: feas_aniso += 1
            amin = av if amin is None or av < amin else amin
            amax = av if amax is None or av > amax else amax
print(f"满足 (E)(Re)(Ler)(Dis)(ESS) 且 b<=a 的格点数 = {feas}(其中各向异性 b<a: {feas_aniso},各向同性 b=a: {feas_iso})")
print(f"可行格点上 a 的范围 = [{amin}, {amax}]")
print()
print("=== 5. 读法 ===")
print("- 量纲上存在指数使:动能有界、局部雷诺数发散(惯性压过粘性)、满足 Leray 下界、耗散积分有限、L3 范数发散(与 ESS 相容)。")
print("- 但例2 显示各向同性 a=b 也满足这些纯量纲条件:量纲分析本身解释不了为什么需要各向异性;")
print("  排除各向同性自相似爆破的 Nečas–Růžička–Šverák / Tsai 定理用的是方程结构(无外力)而不是量纲。")
print("- 例3(Leray 自相似)Re 指数为 0:粘性与惯性同阶,是临界情形。")
print("- 例4(R~τ^1/2、c=1/2)Re 指数为 0,同样是临界:若涡核宽度取粘性尺度 √(ντ),要让 Re→∞ 必须 c>1/2,")
print("  此时翻转时间 R/U 短于 τ,不再满足简单的自相似时间关系——这正是需要外力与修正项吸收的地方(推断)。")
