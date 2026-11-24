"""Manual EC2 verification: disposable OIDC and role checks, with no credential output."""
import http.cookiejar
import json
import pathlib
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

env = dict(line.split('=', 1) for line in pathlib.Path('/opt/librechat-hermes/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
identity = 'http://127.0.0.1:8180'
origin = env['DOMAIN_CLIENT']
payload = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': 'librechat-management',
    'client_secret': env['KEYCLOAK_MANAGEMENT_SECRET']}).encode()
access = json.load(urllib.request.urlopen(urllib.request.Request(identity +
    '/realms/open-harness/protocol/openid-connect/token', data=payload)))['access_token']

def admin(path, method='GET', body=None):
    req = urllib.request.Request(identity + '/admin/realms/open-harness' + path,
        data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return None if response.status in (201, 204) else json.load(response)

class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form' and attrs.get('id') == 'kc-form-login':
            self.action = attrs.get('action')
        if tag == 'input' and attrs.get('type') == 'hidden' and attrs.get('name'):
            self.fields[attrs['name']] = attrs.get('value', '')

email = 'oidc-verification-' + secrets.token_hex(6) + '@example.invalid'
password = secrets.token_urlsafe(32)
subject = None
try:
    admin('/users', 'POST', {'username': email, 'email': email, 'emailVerified': True, 'enabled': True,
        'firstName': 'Disposable', 'lastName': 'Verification', 'requiredActions': [],
        'credentials': [{'type': 'password', 'value': password, 'temporary': False}]})
    subject = admin('/users?username=' + urllib.parse.quote(email) + '&exact=true')[0]['id']
    roles = {role: admin('/roles/org-' + role) for role in ['user', 'admin']}
    admin('/users/' + subject + '/role-mappings/realm', 'POST', [roles['user']])
    browser = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    with browser.open(origin + '/oauth/openid', timeout=30) as response:
        form = LoginForm()
        form.feed(response.read().decode())
    if not form.action:
        raise RuntimeError('OIDC did not present the Keycloak login form')
    form.fields.update(username=email, password=password)
    with browser.open(urllib.request.Request(form.action, data=urllib.parse.urlencode(form.fields).encode()), timeout=30) as response:
        path = urllib.parse.urlparse(response.url).path
        if path not in ('/', '/c/new', '/oauth/success'):
            raise RuntimeError('OIDC callback did not complete: ' + path)
    with browser.open(urllib.request.Request(origin + '/api/auth/refresh', data=b'', method='POST'), timeout=20) as response:
        session = json.load(response)
    token = session['token']

    def api(path, expected=200):
        req = urllib.request.Request(origin + path, headers={'Authorization': 'Bearer ' + token})
        try:
            with browser.open(req, timeout=20) as response:
                assert response.status == expected
                return json.load(response)
        except urllib.error.HTTPError as error:
            assert error.code == expected, (path, error.code, expected)

    assert api('/api/organization')['role'] == 'user'
    assert api('/api/hermes/status')['canManage'] is False
    api('/api/organization/members', 403)
    api('/api/hermes/profiles', 403)
    admin('/users/' + subject + '/role-mappings/realm', 'POST', [roles['admin']])
    assert api('/api/organization')['role'] == 'admin'
    assert api('/api/hermes/status')['canManage'] is True
    api('/api/organization/members')
    api('/api/organization/connections', 403)
    admin('/users/' + subject, 'PUT', {'enabled': False})
    api('/api/organization', 403)
    print(json.dumps({'oidcCallback': True, 'userRestrictions': True,
        'liveRolePromotion': True, 'adminRestrictions': True, 'disabledUserDenied': True}))
finally:
    if subject:
        admin('/users/' + subject, 'DELETE')
    # Remove only this invocation's disposable LibreChat user, if OIDC provisioned it.
    query = 'db.users.deleteOne({email:' + json.dumps(email) + '})'
    subprocess.run(['docker', 'exec', 'librechat-hermes-pilot-mongodb-1', 'mongosh', '--quiet',
        'LibreChat', '--eval', query], check=True, stdout=subprocess.DEVNULL)
