import json, numpy as np
rows=json.load(open('initial.json'))['observations']+[json.load(open('lab/full-01.json'))]
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows])
U=2*P-1; A=np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
c=np.linalg.lstsq(A,V,rcond=None)[0]
noise=0.18
cov=np.linalg.inv(A.T@A)*noise**2
rng=np.random.default_rng(0)
opts=[]
for _ in range(200000):
    cc=c+rng.multivariate_normal(np.zeros(6),cov)
    H=np.array([[2*cc[3],cc[5]],[cc[5],2*cc[4]]])
    try:
        uv=-np.linalg.solve(H,np.array([cc[1],cc[2]]))
    except np.linalg.LinAlgError: continue
    opts.append((uv+1)/2)
opts=np.array(opts)
print('mean',opts.mean(axis=0),'sd',opts.std(axis=0))
print('2.5/97.5',np.percentile(opts,[2.5,97.5],axis=0))
