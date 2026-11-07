import json, time, sys
from pathlib import Path
start=time.monotonic()
values=json.loads(Path('lab/input.json').read_text())
if '--quick' not in sys.argv:
 for i in range(0):
  time.sleep(1)
  if i % 30 == 0: print('synthetic check running', i+1, flush=True)
print(json.dumps({'mean':sum(values)/len(values),'unit':'count','elapsed_seconds':time.monotonic()-start,'quick':'--quick' in sys.argv,'cwd':str(Path.cwd())}),flush=True)
