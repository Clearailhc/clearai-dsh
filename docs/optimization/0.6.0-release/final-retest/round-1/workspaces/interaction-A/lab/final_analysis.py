import json, numpy as np
files=['initial.json','lab/full-01.json','lab/full-02.json','lab/full-03.json','lab/full-04-optimum.json','lab/full-05-optimum-replicate.json','lab/full-06-final.json']
rows=[]
for f in files:
    d=json.load(open(f)); rows += d['observations'] if 'observations' in d else [d]
P=np.array([[r['x'],r['y']] for r in rows]); V=np.array([r['value'] for r in rows]); I=np.array([r['impurity'] for r in rows])
U=2*P-1; A=np.column_stack([np.ones(len(U)),U[:,0],U[:,1],U[:,0]**2,U[:,1]**2,U[:,0]*U[:,1]])
cy=np.linalg.lstsq(A,V,rcond=None)[0]; ci=np.linalg.lstsq(A,I,rcond=None)[0]
ry=V-A@cy; ri=I-A@ci
def pred(c,p):
    u=2*np.array(p)-1
    return float(c[0]+c[1]*u[0]+c[2]*u[1]+c[3]*u[0]**2+c[4]*u[1]**2+c[5]*u[0]*u[1])
def opt(c):
    H=np.array([[2*c[3],c[5]],[c[5],2*c[4]]]); uv=-np.linalg.solve(H,np.array([c[1],c[2]]))
    return (uv+1)/2
popt=opt(cy)
# Monte Carlo optimum uncertainty using full-noise 0.18
cov=np.linalg.inv(A.T@A)*0.18**2
rng=np.random.default_rng(42); opts=[]
for _ in range(200000):
    cc=cy+rng.multivariate_normal(np.zeros(6),cov)
    H=np.array([[2*cc[3],cc[5]],[cc[5],2*cc[4]]])
    try: uv=-np.linalg.solve(H,np.array([cc[1],cc[2]]))
    except np.linalg.LinAlgError: continue
    opts.append((uv+1)/2)
opts=np.array(opts)
mask=(P[:,0]==0.708)&(P[:,1]==0.611)
res={
 'n_observations':len(rows),
 'yield_coefficients_scaled':cy.tolist(),
 'impurity_coefficients_scaled':ci.tolist(),
 'yield_residual_sd':float(np.sqrt(ry@ry/(len(ry)-6))),
 'impurity_residual_sd':float(np.sqrt(ri@ri/(len(ri)-6))),
 'yield_optimum':{'x':float(popt[0]),'y':float(popt[1]),'predicted_yield':pred(cy,popt),'predicted_impurity':pred(ci,popt)},
 'chosen':{'x':0.708,'y':0.611,'predicted_yield':pred(cy,[0.708,0.611]),'predicted_impurity':pred(ci,[0.708,0.611])},
 'chosen_replicates':{'values':V[mask].tolist(),'impurities':I[mask].tolist(),'mean_value':float(V[mask].mean()),'sem_value':float(V[mask].std(ddof=1)/np.sqrt(mask.sum())),'mean_impurity':float(I[mask].mean()),'max_impurity':float(I[mask].max())},
 'optimum_uncertainty_mc':{'sd':opts.std(axis=0).tolist(),'q025':np.percentile(opts,2.5,axis=0).tolist(),'q975':np.percentile(opts,97.5,axis=0).tolist()},
 'impurity_limit':0.115,
 'constraint_margin_at_chosen_predicted':0.115-pred(ci,[0.708,0.611]),
 'budget':{'total':30,'spent':29,'remaining':1,'unit_costs':{'quick':1,'full':3,'calibrate':2}}
}
print(json.dumps(res,indent=2))
open('lab/final-analysis.json','w').write(json.dumps(res,indent=2)+'\n')
