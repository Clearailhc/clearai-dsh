#!/usr/bin/env python3
"""Finite response-surface comparison; predictions never become measurements."""
import argparse
import json
import math
import hashlib
from pathlib import Path
import numpy as np

VERSION = '0.5.2-rc.1'

def design(points, interaction):
    x, y = np.asarray(points, dtype=float).T
    cols = [np.ones(len(x)), x, y, x*x, y*y]
    if interaction:
        cols.append(x*y)
    return np.column_stack(cols)

def fit(points, values, interaction, noise):
    a = design(points, interaction)
    if len(a) <= a.shape[1] or np.linalg.matrix_rank(a) != a.shape[1]:
        return None
    coeff = np.linalg.lstsq(a, values, rcond=None)[0]
    inverse = np.linalg.pinv(a.T @ a)
    residual = np.asarray(values) - a @ coeff
    leverage = np.sum((a @ inverse) * a, axis=1)
    if np.any(leverage > 0.999):
        return None
    loo = residual / (1 - leverage)
    variance = max(float(residual @ residual / (len(a)-a.shape[1])), noise*noise)
    return {'kind':'interaction' if interaction else 'additive', 'coefficients':coeff,
            'inverse':inverse, 'variance':variance, 'cv_rmse':float(np.sqrt(np.mean(loo*loo)))}

def predict(model, points):
    a = design(points, model['kind'] == 'interaction')
    mean = a @ model['coefficients']
    sd = np.sqrt(model['variance']*(1+np.sum((a @ model['inverse'])*a, axis=1)))
    return mean, sd

def analyze(data):
    rows = data['observations']
    bounds = np.asarray(data['bounds'], dtype=float)
    if bounds.shape != (2,2) or not np.all(np.isfinite(bounds)) or np.any(bounds[:,0] >= bounds[:,1]):
        raise ValueError('bounds must be two finite nonempty intervals')
    if len(rows) < 7:
        return {'method_version':VERSION,'status':'need_data','reason':'at least 7 independent, varied observations are required; calibration and repeated observations may also be needed','recommendation':None}
    points = np.array([[r['x'],r['y']] for r in rows],float)
    values = np.array([r['value'] for r in rows],float)
    impurity = np.array([r['impurity'] for r in rows],float)
    if not np.all(np.isfinite(np.column_stack([points,values,impurity]))):
        raise ValueError('all measurements must be finite')
    scaled = 2*(points-bounds[:,0])/(bounds[:,1]-bounds[:,0])-1
    if np.any(np.abs(scaled)>1+1e-8):
        raise ValueError('observation exceeds declared input bounds; verify units/range')
    noise = float(data.get('noise_sd',0.25))
    grid = int(data.get('grid_size',21))
    if not 3 <= grid <= 101 or not math.isfinite(noise) or noise <= 0:
        raise ValueError('grid_size 3..101 and positive noise_sd required')
    models = [m for m in [fit(scaled,values,False,noise),fit(scaled,values,True,noise)] if m]
    constraints = [m for m in [fit(scaled,impurity,False,float(data.get('impurity_noise_sd',0.01))),fit(scaled,impurity,True,float(data.get('impurity_noise_sd',0.01)))] if m]
    if not models or not constraints:
        return {'method_version':VERSION,'status':'need_data','reason':'design is rank deficient or validation is unsupported; add varied points','recommendation':None}
    models.sort(key=lambda m:m['cv_rmse'])
    # Prefer simpler structure when its validation error is within the stated measurement noise.
    best = next((m for m in models if m['kind']=='additive' and m['cv_rmse'] <= models[0]['cv_rmse']+noise),models[0])
    constraint = min(constraints,key=lambda m:m['cv_rmse'])
    candidates = np.array([(x,y) for x in np.linspace(-1,1,grid) for y in np.linspace(-1,1,grid)])
    physical = (candidates+1)/2*(bounds[:,1]-bounds[:,0])+bounds[:,0]
    means, sd = predict(best,candidates)
    cp, cs = predict(constraint,candidates)
    limit = float(data['impurity_limit'])
    feasible = cp+1.96*cs <= limit
    support = np.all((candidates >= scaled.min(axis=0)) & (candidates <= scaled.max(axis=0)),axis=1)
    costs = np.asarray(data.get('candidate_costs',[data.get('experiment_cost',3)]*len(candidates)),float)
    if len(costs)!=len(candidates) or np.any(costs<=0) or not np.all(np.isfinite(costs)):
        raise ValueError('candidate costs must be positive and align with grid')
    remaining = float(data.get('remaining_budget',24))
    disagreement = np.zeros(len(candidates))
    if len(models)>1:
        disagreement = np.abs(predict(models[0],candidates)[0]-predict(models[1],candidates)[0])
    incumbent = max([r['value'] for r in rows if r['impurity']<=limit], default=0)
    utility = (np.maximum(means-incumbent,0)+0.2*sd+0.15*disagreement)/costs
    allowed = feasible & support & (costs<=remaining)
    verified = []
    for r in rows:
        if r['impurity']<=limit:
            verified.append({'x':r['x'],'y':r['y'],'value':r['value'],'impurity':r['impurity']})
    verified.sort(key=lambda r:r['value'],reverse=True)
    def record(index):
        return {'x':float(physical[index,0]),'y':float(physical[index,1]),'predicted_value':float(means[index]),'prediction_interval':[float(means[index]-1.96*sd[index]),float(means[index]+1.96*sd[index])], 'predicted_impurity_upper':float(cp[index]+1.96*cs[index]),'experiment_cost':float(costs[index]),'within_observed_bounding_box':bool(support[index]),'verified':False}
    idx = np.flatnonzero(allowed)
    ranking = sorted(idx,key=lambda i:float(utility[i]),reverse=True)
    return {'method_version':VERSION,'status':'ok','selected_model':best['kind'],
            'models':[{'kind':m['kind'],'cv_rmse':m['cv_rmse'],'coefficients':m['coefficients'].tolist()} for m in models],
            'support':{'bounds':bounds.tolist(),'observed_bounding_box':np.column_stack([points.min(axis=0),points.max(axis=0)]).tolist(),'limitation':'bounding box is not interpolation support or proof of causal validity'},
            'recommendation':record(max(idx,key=lambda i:means[i])) if len(idx) else None,
            'next_experiments':[record(i) for i in ranking[:3]],'best_measured':verified[0] if verified else None,
            'warnings':['Model predictions require a fresh full measurement before final recommendation.','Check source, units and calibration; poor fit can reflect omitted variables, noise or measurement problems.']}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('input');parser.add_argument('--output')
    parser.add_argument('--append', action='append', default=[], help='Append a raw measurement JSON without changing the original input')
    parser.add_argument('--updated-input', help='Save the input plus appended observations as a separate artifact')
    parser.add_argument('--remaining-budget', type=float)
    args=parser.parse_args()
    data=json.loads(Path(args.input).read_text())
    for path in args.append:
        row=json.loads(Path(path).read_text())
        if not all(key in row for key in ['x','y','value','impurity']):
            raise ValueError('append accepts raw measurement JSON with x,y,value,impurity; calibration is separate evidence')
        data['observations'].append(row)
    if args.remaining_budget is not None:
        if not math.isfinite(args.remaining_budget) or args.remaining_budget < 0:
            raise ValueError('remaining budget must be finite and nonnegative')
        data['remaining_budget']=args.remaining_budget
    result=analyze(data)
    result['method_digest']='sha256:'+hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    result['inputs']={'initial':args.input,'measurements':args.append,'digests':{path:'sha256:'+hashlib.sha256(Path(path).read_bytes()).hexdigest() for path in [args.input,*args.append]}}
    if args.updated_input:
        if Path(args.updated_input).resolve() == Path(args.input).resolve():
            raise ValueError('updated input must use a separate artifact path')
        Path(args.updated_input).write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
    raw=json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+'\n'
    if args.output:
        Path(args.output).write_text(raw)
    else:
        print(raw,end='')
if __name__=='__main__':
    main()
