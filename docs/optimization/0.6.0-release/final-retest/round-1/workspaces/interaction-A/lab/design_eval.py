import json, numpy as np
rows=json.load(open('initial.json'))['observations']+[json.load(open('lab/full-01.json'))]
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows])
def A_of(PP):
    PP=np.asarray(PP).reshape(-1,2)
    U=2*np.array(PP)-1
    return np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
A=A_of(P); c=np.linalg.lstsq(A,V,rcond=None)[0]
def eval_design(extra,label):
    A2=np.vstack([A,A_of(extra)]); cov=np.linalg.inv(A2.T@A2)*0.18**2
    rng=np.random.default_rng(1); opts=[]
    for _ in range(60000):
        cc=c+rng.multivariate_normal(np.zeros(6),cov)
        H=np.array([[2*cc[3],cc[5]],[cc[5],2*cc[4]]])
        try: uv=-np.linalg.solve(H,np.array([cc[1],cc[2]]))
        except np.linalg.LinAlgError: continue
        opts.append((uv+1)/2)
    opts=np.array(opts)
    print(label,'n=',len(extra),'sd',np.round(opts.std(axis=0),4),'95%',np.round(np.percentile(opts,[2.5,97.5],axis=0),3).tolist())
eval_design([], 'base')
eval_design([(0.85,0.1),(0.1,0.85),(0.1,0.15),(0.85,0.9)], 'Dopt4')
eval_design([(0.65,0.55),(0.65,0.67),(0.77,0.55),(0.77,0.67)], 'local4')
eval_design([(0.61,0.51),(0.61,0.71),(0.81,0.51),(0.81,0.71)], 'localwide4')
eval_design([(0.6,0.5),(0.6,0.7),(0.8,0.5),(0.8,0.7)], 'local4b')
eval_design([(0.7,0.6),(0.8,0.6),(0.6,0.6),(0.7,0.7),(0.7,0.5)], 'star5')
