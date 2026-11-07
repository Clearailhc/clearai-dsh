"""Check the case's raw/effective usage views and independently join correction evidence."""
import csv,json,sys
from pathlib import Path
root=Path(sys.argv[1])
graphs={v:json.loads((root/f'artifacts/graph-{v}.json').read_text()) for v in ['source','effective']}
def rows(name):
 with (root/name).open() as f:return list(csv.DictReader(f))
usage=rows('data/material_usage.csv');corrections=rows('data/usage-corrections.csv')
cutoff=graphs['effective']['cutoff'];active={r['usage_id']:r for r in corrections if r['effective']<=cutoff}
def key(e):return e['subject'],e['predicate'],e['object']
for view in ['source','effective']:
 g=graphs[view];assert g['view']==view
 expected={(r['batch_id'],'uses_lot',(active.get(r['usage_id'],r) if view=='effective' else r)['lot_id']) for r in usage}
 assert {key(e) for e in g['edges'] if e['predicate']=='uses_lot'}==expected
assert {key(e) for e in graphs['source']['edges'] if e['predicate']!='uses_lot'}=={key(e) for e in graphs['effective']['edges'] if e['predicate']!='uses_lot'}
for e in graphs['effective']['edges']:
 if 'derivation' not in e:continue
 d=e['derivation'];assert d['join_key']=='usage_id'
 u=next(r for r in usage if r['usage_id']==d['join_value']);c=active[d['join_value']]
 assert c['previous_lot_id']==u['lot_id'] and d['effective']==c['effective']
 assert key(e)==(u['batch_id'],'uses_lot',c['lot_id'])
 for ref in e['evidence']:
  record=rows(ref['path'])[ref['row']-2];assert record['usage_id']==d['join_value']
 assert {r['path'] for r in e['evidence']}=={'data/material_usage.csv','data/usage-corrections.csv'}
print(json.dumps({'passed':True,'sourceUsageEdges':len(usage),'cutoff':cutoff}))
