"""Idempotently grant the management client Keycloak 26.8's Admin API audience scope."""
import json
import pathlib
import urllib.parse
import urllib.request

env = dict(line.split('=', 1) for line in pathlib.Path('/opt/librechat-hermes/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
base = 'http://127.0.0.1:8180'
data = urllib.parse.urlencode({'grant_type': 'password', 'client_id': 'admin-cli',
    'username': env['KEYCLOAK_ADMIN_USERNAME'], 'password': env['KEYCLOAK_ADMIN_PASSWORD']}).encode()
token = json.load(urllib.request.urlopen(urllib.request.Request(
    base + '/realms/master/protocol/openid-connect/token', data=data)))['access_token']

def call(path, method='GET', body=None):
    request = urllib.request.Request(base + '/admin/realms/open-harness' + path, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=15) as response:
        return None if response.status == 204 else json.load(response)

client = call('/clients?clientId=librechat-management')[0]
scope = next(s for s in call('/client-scopes') if s['name'] == 'kc-admin-api')
call('/clients/' + client['id'] + '/default-client-scopes/' + scope['id'], 'PUT')
print('Management client Admin API scope configured.')
