import json, sys, numpy as np
files=sys.argv[1:]
rows=[]
for f in files:
    d=json.load(open(f))
    if 'observations' in d: rows+=d['observations']
    else: rows.append(d)
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows]); I=np.array([r['impurity'] for r in rows])
U=2*P-1
A=np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
for name,val in [('yield',V),('impurity',I)]:
    c=np.linalg.lstsq(A,val,rcond=None)[0]; res=val-A@c
    print(name, np.round(c,6), 'resid_sd=%.4f'%np.sqrt(res@res/(len(res)-6)))
def opt(c):
    H=np.array([[2*c[3],c[5]],[c[5],2*c[4]]]); g=np.array([c[1],c[2]])
    uv=-np.linalg.solve(H,g); p=(uv+1)/2
    return p, c[0]+c[1]*uv[0]+c[2]*uv[1]+c[3]*uv[0]**2+c[4]*uv[1]**2+c[5]*uv[0]*uv[1]
cy=np.linalg.lstsq(A,V,rcond=None)[0]; ci=np.linalg.lstsq(A,I,rcond=None)[0]
p,y=opt(cy); u=2*p-1
imp=ci[0]+ci[1]*u[0]+ci[2]*u[1]+ci[3]*u[0]**2+ci[4]*u[1]**2+ci[5]*u[0]*u[1]
print('yield opt',p,y,'impurity there',imp)
print('rows',len(rows))
