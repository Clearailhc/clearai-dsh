import json, numpy as np
d=json.load(open('initial.json'))
rows=d['observations']
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows]); I=np.array([r['impurity'] for r in rows])
U=2*P-1
A=np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
for name,val in [('yield',V),('impurity',I)]:
    c=np.linalg.lstsq(A,val,rcond=None)[0]
    print(name, np.round(c,6))
    print('resid',np.round(val-A@c,6))
# analytic optimum of quadratic f=c0+c1 u+c2 v+c3 u2+c4 v2+c5 uv
def opt(c):
    H=np.array([[2*c[3],c[5]],[c[5],2*c[4]]]); g=np.array([c[1],c[2]])
    uv=-np.linalg.solve(H,g)
    return (uv+1)/2, c[0]+c[1]*uv[0]+c[2]*uv[1]+c[3]*uv[0]**2+c[4]*uv[1]**2+c[5]*uv[0]*uv[1]
for name,val in [('yield',V),('impurity',I)]:
    c=np.linalg.lstsq(A,val,rcond=None)[0]
    print(name,'unconstrained opt',opt(c))
