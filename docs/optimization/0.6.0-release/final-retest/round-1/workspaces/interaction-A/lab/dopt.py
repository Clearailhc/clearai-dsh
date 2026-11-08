import json, numpy as np, itertools
rows=json.load(open('initial.json'))['observations']+[json.load(open('lab/full-01.json'))]
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows])
def A_of(P):
    U=2*np.array(P)-1
    return np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
A=A_of(P)
grid=[(round(x,3),round(y,3)) for x in np.arange(0.10,0.901,0.05) for y in np.arange(0.10,0.901,0.05)]
existing={(round(x,3),round(y,3)) for x,y in P}
cands=[p for p in grid if p not in existing]
sel=[]
for k in range(4):
    best=None
    for p in cands:
        if p in sel: continue
        B=np.vstack([A,A_of(sel+[p])])
        sign,ld=np.linalg.slogdet(B.T@B)
        if best is None or ld>best[0]: best=(ld,p)
    sel.append(best[1]); print('pick',best[1],'logdet',best[0])
# MC opt sd with these
P2=np.vstack([P,sel]); A2=A_of(P2); c=np.linalg.lstsq(A2,V[:len(P)],rcond=None)[0]
# can't use V for new points; coefficients estimated from old only, covariance from A2
cov=np.linalg.inv(A2.T@A2)*0.18**2
rng=np.random.default_rng(1); opts=[]
for _ in range(100000):
    cc=c+rng.multivariate_normal(np.zeros(6),cov)
    H=np.array([[2*cc[3],cc[5]],[cc[5],2*cc[4]]])
    try: uv=-np.linalg.solve(H,np.array([cc[1],cc[2]]))
    except np.linalg.LinAlgError: continue
    opts.append((uv+1)/2)
opts=np.array(opts); print('opt sd with design',opts.std(axis=0), 'mean',opts.mean(axis=0))
