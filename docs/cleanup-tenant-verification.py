"""Remove only our two disposable verification fixtures, never customer organizations."""
import json
import pathlib
import shutil
import subprocess
import sys
sys.path.insert(0,'/opt/open-harness-control')
from engine import Engine, ROOT
engine=Engine()
for slug in ['pilot-org-a','pilot-org-b']:
    row=engine.get(slug)
    assert not row['existing'] and row['realm']=='org-'+slug
    assert row['name'].startswith('Disposable isolation verification') and row['ownerEmail'].endswith('@example.invalid')
    assert all(user['email'].endswith('@example.invalid') for user in engine.members(slug))
    target=engine.tenant(slug).resolve()
    assert target.parent==(ROOT/'tenants').resolve() and not target.is_symlink()
    project='oh-'+slug
    description=json.loads(subprocess.check_output(['docker','network','inspect',project+'_backend'],text=True))[0]
    bridge='br-'+description['Id'][:12]
    for container,network in [('librechat-hermes-pilot-keycloak-1',project+'_backend'),('librechat-hermes-pilot-caddy-1',project+'_edge')]:
        subprocess.run(['docker','network','disconnect',network,container],check=True,stdout=subprocess.DEVNULL)
    engine.compose(slug,'down','--volumes',timeout=180)
    engine.kc('/'+row['realm'],'DELETE')
    for chain in ['DOCKER-USER','INPUT']:
        rules=subprocess.check_output(['iptables','-S',chain],text=True).splitlines()
        for rule in rules:
            parts=rule.split()
            if '-i' in parts and parts[parts.index('-i')+1]==bridge:
                subprocess.run(['iptables','-D',*parts[1:]],check=True)
    with engine.db() as db: db.execute('DELETE FROM organizations WHERE slug=?',(slug,))
    shutil.rmtree(target)
    engine.audit('platform-verification','test.cleanup',slug,'Remove only disposable isolation verification fixtures','success')
engine.routing()
(ROOT/'verification-state.json').unlink(missing_ok=True)
print('Disposable verification workspaces removed; customer capacity restored.')
