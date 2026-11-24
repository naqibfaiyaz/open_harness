"""Install the protected host control plane; credentials never leave the host."""
import json
import os
import pathlib
import secrets
import subprocess
import urllib.parse
import urllib.request

os.umask(0o077)
pilot = pathlib.Path('/opt/librechat-hermes')
root = pathlib.Path('/opt/open-harness-control')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
envfile = pilot/'.env'
env = dict(line.split('=',1) for line in envfile.read_text().splitlines() if '=' in line and not line.startswith('#'))
env.setdefault('PLATFORM_CONTROL_KEY', secrets.token_hex(32))
env.setdefault('PLATFORM_KEYCLOAK_SECRET', secrets.token_hex(32))
env['PLATFORM_CONTROL_ENABLED'] = 'true'
env.setdefault('PLATFORM_MAX_ORGANIZATIONS', '3')
env.setdefault('PLATFORM_BOOTSTRAP_USERS', env.get('ORGANIZATION_BOOTSTRAP_USERS',''))
envfile.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
excluded = {'PLATFORM_KEYCLOAK_SECRET','KEYCLOAK_ADMIN_PASSWORD','KEYCLOAK_ADMIN_USERNAME','KEYCLOAK_DB_PASSWORD'}
(pilot/'.librechat.env').write_text('\n'.join(k+'='+v for k,v in env.items() if k not in excluded)+'\n')
data = urllib.parse.urlencode({'grant_type':'password','client_id':'admin-cli',
    'username':env['KEYCLOAK_ADMIN_USERNAME'],'password':env['KEYCLOAK_ADMIN_PASSWORD']}).encode()
base = 'http://127.0.0.1:8180'
token = json.load(urllib.request.urlopen(urllib.request.Request(base+'/realms/master/protocol/openid-connect/token',data=data)))['access_token']

def call(path, method='GET', body=None):
    req = urllib.request.Request(base+'/admin/realms'+path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=20) as response:
        return None if response.status in (201,204) else json.load(response)

clients = call('/master/clients?clientId=open-harness-control')
if not clients:
    call('/master/clients','POST',{'clientId':'open-harness-control','publicClient':False,
        'secret':env['PLATFORM_KEYCLOAK_SECRET'],'protocol':'openid-connect','serviceAccountsEnabled':True,
        'standardFlowEnabled':False,'directAccessGrantsEnabled':False})
    clients = call('/master/clients?clientId=open-harness-control')
client = clients[0]
scope = next(scope for scope in call('/master/client-scopes') if scope['name']=='kc-admin-api')
call('/master/clients/'+client['id']+'/default-client-scopes/'+scope['id'],'PUT')
account = call('/master/clients/'+client['id']+'/service-account-user')
role = next(role for role in call('/master/roles') if role['name']=='create-realm')
call('/master/users/'+account['id']+'/role-mappings/realm','POST',[role])
# The control service may manage the existing organization's members, but cannot
# change its clients or retrieve its credentials through the application API.
realm_client = call('/master/clients?clientId=open-harness-realm')[0]
names = {'view-users','query-users','manage-users','view-realm'}
roles = [r for r in call('/master/clients/'+realm_client['id']+'/roles') if r['name'] in names]
call('/master/users/'+account['id']+'/role-mappings/clients/'+realm_client['id'],'POST',roles)
roles = call('/open-harness/roles')
if not any(r['name']=='platform-admin' for r in roles):
    call('/open-harness/roles','POST',{'name':'platform-admin'})
platform_role = next(r for r in call('/open-harness/roles') if r['name']=='platform-admin')
for operator in filter(None,env['PLATFORM_BOOTSTRAP_USERS'].split(',')):
    # Only explicit existing operator IDs can receive the platform role.
    script = 'const u=db.users.findOne({_id:ObjectId('+json.dumps(operator)+')});print(JSON.stringify(u?{sub:u.openidId,issuer:u.openidIssuer}:{}))'
    result = json.loads(subprocess.check_output(['docker','exec','librechat-hermes-pilot-mongodb-1','mongosh','--quiet','LibreChat','--eval',script],text=True))
    if result.get('sub') and result.get('issuer')==env['OPENID_ISSUER']:
        call('/open-harness/users/'+result['sub']+'/role-mappings/realm','POST',[platform_role])
        user = call('/open-harness/users/'+result['sub'])
        actions = list(set(user.get('requiredActions',[])+['CONFIGURE_TOTP']))
        call('/open-harness/users/'+result['sub'],'PUT',{'requiredActions':actions})

unit = '''[Unit]
Description=Open Harness organization control plane
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=simple
WorkingDirectory=/opt/open-harness-control
ExecStart=/usr/bin/python3 /opt/open-harness-control/server.py
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
'''
pathlib.Path('/etc/systemd/system/open-harness-control.service').write_text(unit)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','open-harness-control'],check=True)
subprocess.run(['systemctl','restart','open-harness-control'],check=True)
print('Protected organization control plane installed.')
path = pilot/'Caddyfile'
text = path.read_text()
if 'admin off' in text:
    path.write_text(text.replace('admin off', 'admin unix//config/caddy-admin.sock', 1))
    subprocess.run(['docker','exec','librechat-hermes-pilot-caddy-1','caddy','validate','--config','/etc/caddy/Caddyfile'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','restart','librechat-hermes-pilot-caddy-1'],check=True,stdout=subprocess.DEVNULL)
