#!/usr/bin/env bash
set -euo pipefail
cd /opt/librechat-hermes
python3 - <<'PY'
from pathlib import Path
import json,urllib.request,subprocess
p=Path('/opt/librechat-hermes')
env=dict(l.split('=',1) for l in (p/'.env').read_text().splitlines() if l and not l.startswith('#') and '=' in l)
req=urllib.request.Request('https://openrouter.ai/api/v1/models',headers={'Authorization':'Bearer '+env['OPENROUTER_API_KEY']})
with urllib.request.urlopen(req,timeout=45) as r: catalog=json.load(r)['data']
models=sorted({m['id'] for m in catalog if 'text' in m.get('architecture',{}).get('output_modalities',[]) and 'tools' in m.get('supported_parameters',[])})
if not models: raise SystemExit('No compatible models returned; no changes applied')
helper='''from pathlib import Path
import sys,json,time
sys.path.insert(0,"/opt/hermes")
import hermes_yaml as yaml
models=json.loads(sys.stdin.read())
p=Path("/opt/data/config.yaml")
c=yaml.safe_load(p.read_text())
backup=p.with_name("config.before-model-catalog-"+str(int(time.time()))+".yaml")
backup.write_text(p.read_text());backup.chmod(0o600)
api=c.setdefault("gateway",{}).setdefault("platforms",{}).setdefault("api_server",{})
routes=api.setdefault("model_routes",{})
for model in models: routes[model]={"model":model,"provider":"openrouter"}
api["direct_model_requests"]=True
p.write_text(yaml.safe_dump(c,sort_keys=False));p.chmod(0o600)
print(json.dumps({"routes_added":len(models),"total_routes":len(routes)}))
'''
subprocess.run(['docker','compose','exec','-T','--user','hermes','hermes','/opt/hermes/.venv/bin/python','-c',helper],input=json.dumps(models),text=True,check=True)
cfg=json.loads((p/'librechat.yaml').read_text())
for endpoint in cfg['endpoints']['custom']:
 if endpoint['name']=='Hermes': endpoint['models']['fetch']=True
(p/'librechat.yaml').write_text(json.dumps(cfg,indent=2)+'\n')
(p/'hermes-model-catalog.json').write_text(json.dumps({'source':'OpenRouter','models':models},indent=2)+'\n')
PY
docker compose restart hermes librechat
