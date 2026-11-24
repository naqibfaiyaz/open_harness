"""Manual, disposable pilot-org-a/b verification. Never prints credentials."""
import http.client
import http.cookiejar
import json
import pathlib
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

sys.path.insert(0, '/opt/open-harness-control')
from engine import Engine
engine = Engine()
slugs = ['pilot-org-a', 'pilot-org-b']
state = json.loads(pathlib.Path('/opt/open-harness-control/verification-state.json').read_text())
for slug in slugs:
    row = engine.get(slug)
    assert row['status'] == 'active' and row['name'].startswith('Disposable isolation verification')
    assert row['ownerEmail'].endswith('@example.invalid')

class Unix(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(30)
        self.sock.connect('/run/open-harness/control.sock')

def control(path):
    connection = Unix('localhost')
    connection.request('POST', path, json.dumps({'actor':'platform-verification','reason':'Verify isolated lifecycle and preserved access'}),
        {'Authorization':'Bearer '+engine.env['PLATFORM_CONTROL_KEY'],'Content-Type':'application/json'})
    response = connection.getresponse()
    assert response.status == 202
    response.read()

def wait(slug, status):
    for attempt in range(90):
        row = engine.get(slug)
        if row['status'] == status:
            return
        if row['status'] == 'failed':
            raise RuntimeError(row['errorCode'])
        time.sleep(2)
    raise RuntimeError('Lifecycle did not complete')

class Login(HTMLParser):
    def __init__(self):
        super().__init__(); self.action = None; self.fields = {}
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form' and attrs.get('id') == 'kc-form-login': self.action = attrs.get('action')
        if tag == 'input' and attrs.get('type') == 'hidden' and attrs.get('name'):
            self.fields[attrs['name']] = attrs.get('value','')

def login(slug):
    row = engine.get(slug)
    user = engine.kc('/'+row['realm']+'/users?username='+urllib.parse.quote(row['ownerEmail'])+'&exact=true')[0]
    password = next(item['password'] for item in state if item['slug']==slug)
    # Only our disposable fixtures skip the interactive temporary-password change.
    engine.kc('/'+row['realm']+'/users/'+user['id']+'/reset-password','PUT',{'type':'password','value':password,'temporary':False})
    engine.kc('/'+row['realm']+'/users/'+user['id'],'PUT',{'requiredActions':[]})
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with browser.open(row['origin']+'/oauth/openid',timeout=30) as response:
        form = Login(); form.feed(response.read().decode())
    assert form.action
    form.fields.update(username=row['ownerEmail'],password=password)
    with browser.open(urllib.request.Request(form.action,data=urllib.parse.urlencode(form.fields).encode()),timeout=30) as response:
        assert urllib.parse.urlparse(response.url).path in ('/','/c/new','/oauth/success')
    with browser.open(urllib.request.Request(row['origin']+'/api/auth/refresh',data=b'',method='POST'),timeout=20) as response:
        session = json.load(response)
    return session['token']

def api(slug, path, token, expected=200):
    req = urllib.request.Request(engine.get(slug)['origin']+path,headers={'Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            assert response.status == expected
            return json.load(response)
    except urllib.error.HTTPError as error:
        assert error.code == expected, (path,error.code,expected)

tokens = {slug:login(slug) for slug in slugs}
for slug in slugs:
    assert api(slug,'/api/organization',tokens[slug])['role']=='owner'
    assert api(slug,'/api/hermes/status',tokens[slug])['canManage'] is True
    assert api(slug,'/api/hermes/profiles',tokens[slug])['profiles']
api('pilot-org-b','/api/organization',tokens['pilot-org-a'],401)
api('pilot-org-a','/api/platform/status',tokens['pilot-org-a'])
api('pilot-org-a','/api/platform/organizations',tokens['pilot-org-a'],403)

def docker(*args):
    return subprocess.check_output(['docker',*args],text=True).strip()

def networks(slug, service):
    return json.loads(docker('inspect','--format','{{json .NetworkSettings.Networks}}','oh-'+slug+'-'+service+'-1'))

sentinel = secrets.token_hex(16)
docker('exec','oh-pilot-org-a-hermes-1','/opt/hermes/.venv/bin/python','-c',
    "from pathlib import Path;Path('/opt/data/.isolation-verification').write_text("+repr(sentinel)+")")
assert docker('exec','oh-pilot-org-b-hermes-1','/opt/hermes/.venv/bin/python','-c',
    "from pathlib import Path;print(Path('/opt/data/.isolation-verification').exists())")=='False'
mongo_a = networks('pilot-org-a','mongodb')['oh-pilot-org-a_data']['IPAddress']
hermes_b = networks('pilot-org-b','hermes')['oh-pilot-org-b_backend']['IPAddress']
probe = '''import socket,os,json
targets=TARGETS
result={}
for name,host,port in targets:
 try:
  s=socket.create_connection((host,port),2);s.close();result[name]=False
 except OSError:result[name]=True
result['no_platform_secrets']=not any(os.environ.get(k) for k in ['PLATFORM_CONTROL_KEY','PLATFORM_KEYCLOAK_SECRET','KEYCLOAK_MANAGEMENT_SECRET'])
result['no_control_socket']=not os.path.exists('/run/open-harness/control.sock')
print(json.dumps(result))
'''.replace('TARGETS',repr([('metadata','169.254.169.254',80),('other_runtime',hermes_b,8642),('database',mongo_a,27017)]))
result=json.loads(docker('exec','oh-pilot-org-a-hermes-1','/opt/hermes/.venv/bin/python','-c',probe))
assert all(result.values()), result
control('/organizations/pilot-org-a/suspend');wait('pilot-org-a','suspended')
api('pilot-org-a','/api/organization',tokens['pilot-org-a'],503)
assert api('pilot-org-b','/api/organization',tokens['pilot-org-b'])['role']=='owner'
control('/organizations/pilot-org-a/resume');wait('pilot-org-a','active')
assert api('pilot-org-a','/api/organization',tokens['pilot-org-a'])['role']=='owner'
assert docker('exec','oh-pilot-org-a-hermes-1','/opt/hermes/.venv/bin/python','-c',
    "from pathlib import Path;print(Path('/opt/data/.isolation-verification').read_text()=="+repr(sentinel)+")")=='True'
docker('exec','oh-pilot-org-a-hermes-1','/opt/hermes/.venv/bin/python','-c',"from pathlib import Path;Path('/opt/data/.isolation-verification').unlink()")
print(json.dumps({'twoOrganizationLogins':True,'crossOrganizationTokensDenied':True,'customerPlatformAccessDenied':True,
    'separateHermesVolumes':True,'suspensionAndResume':True,'otherOrganizationUnaffected':True,'dataRetained':True,**result}))
