#!/usr/bin/env python3
"""Local diagnostic fit (does not replace method/response_surface.py)."""
import json, sys, numpy as np
from pathlib import Path

def load(paths):
    rows=[]
    for p in paths:
        d=json.loads(Path(p).read_text())
        obs=d.get('observations',[d])
        for r in obs:
            if all(k in r for k in ('x','y','value','impurity')):
                rows.append(r)
    return rows

def design(points, interaction=False):
    x,y=np.asarray(points,float).T
    # physical coords centered at 0.5 scaled to [-1,1]
    xs=2*x-1; ys=2*y-1
    cols=[np.ones(len(x)),xs,ys,xs*xs,ys*ys]
    if interaction: cols.append(xs*ys)
    return np.column_stack(cols)

def fit(rows, key, interaction=False):
    pts=np.array([[r['x'],r['y']] for r in rows])
    vals=np.array([r[key] for r in rows])
    A=design(pts,interaction)
    beta,_,rank,sv=np.linalg.lstsq(A,vals,rcond=None)
    resid=vals-A@beta
    n,p=A.shape
    dof=n-p
    sigma2=resid@resid/dof if dof>0 else float('nan')
    cov=sigma2*np.linalg.inv(A.T@A)
    se=np.sqrt(np.diag(cov))
    # LOO
    H=A@np.linalg.inv(A.T@A)@A.T
    lev=np.diag(H)
    loo=resid/(1-lev)
    return dict(beta=beta,se=se,cov=cov,resid=resid,sigma2=sigma2,rank=rank,loo=loo,rmse=np.sqrt(np.mean(loo**2)),n=n,p=p,A=A,pts=pts,vals=vals)

def opt_additive(beta):
    # scaled x* = b1/(2*(-b3)) if b3<0, clamp
    xs = beta[1]/(2*(-beta[3])) if beta[3]<0 else np.nan
    ys = beta[2]/(2*(-beta[4])) if beta[4]<0 else np.nan
    return np.array([(xs+1)/2,(ys+1)/2])

def main():
    paths=sys.argv[1:]
    rows=load(paths)
    print(f"rows={len(rows)}")
    for key in ('value','impurity'):
        print(f"\n=== {key} ===")
        for inter in (False,True):
            m=fit(rows,key,inter)
            print(f"{'interaction' if inter else 'additive':11s} n={m['n']} rmse(fit)={np.sqrt(m['sigma2']):.4f} loo={m['rmse']:.4f} rank={m['rank']}/{m['p']}")
            print("  beta:", np.round(m['beta'],5).tolist())
            print("  se  :", np.round(m['se'],5).tolist())
            if key=='value' and not inter:
                xo=opt_additive(m['beta'])
                print(f"  optimum=({xo[0]:.4f},{xo[1]:.4f}) predicted={design([xo],False)@m['beta']}")
        m=fit(rows,key,False)
        print("  residuals(add):")
        for r,res in zip(rows,m['resid']):
            print(f"    ({r['x']:.3f},{r['y']:.3f}) y={r[key]:.5f} res={res:+.4f}")
    # joint uncertainty of optimum via delta method for yield additive
    m=fit(rows,'value',False); b=m['beta']; C=m['cov']
    # x*=(b1/(-2b3)+1)/2 ; gradient wrt b1,b3
    b1,b3=b[1],b[3]
    gx=np.zeros(m['p']); gx[1]=1/(-2*b3); gx[3]=-b1/(-2*b3**2)
    b2,b4=b[2],b[4]
    gy=np.zeros(m['p']); gy[2]=1/(-2*b4); gy[4]=-b2/(-2*b4**2)
    sx=np.sqrt(gx@C@gx)/2; sy=np.sqrt(gy@C@gy)/2
    print(f"\noptimum std err approx sx={sx:.4f}, sy={sy:.4f}")

if __name__=='__main__': main()
