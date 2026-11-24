"""Run on the existing EC2 host. Generates credentials locally; never prints them."""
import json
import os
import pathlib
import secrets
import re
import subprocess
import sys

root = pathlib.Path('/opt/librechat-hermes')
os.chdir(root)
os.umask(0o077)
envfile = root / '.env'
lines = envfile.read_text().splitlines()
env = dict(line.split('=', 1) for line in lines if '=' in line and not line.startswith('#'))
origin = 'https://auth.16-52-156-144.sslip.io'
for name in ['KEYCLOAK_DB_PASSWORD', 'KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_MANAGEMENT_SECRET', 'OPENID_CLIENT_SECRET', 'OPENID_SESSION_SECRET']:
    env.setdefault(name, secrets.token_hex(32))
env.setdefault('KEYCLOAK_ADMIN_USERNAME', 'platform-admin')
env['KEYCLOAK_ORIGIN'] = origin
env['OPENID_CLIENT_ID'] = 'librechat'
env['OPENID_ISSUER'] = origin + '/realms/open-harness'
env['OPENID_SCOPE'] = 'openid profile email'
env['OPENID_USE_PKCE'] = 'true'
env['OPENID_CALLBACK_URL'] = '/oauth/openid/callback'
env['OPENID_BUTTON_LABEL'] = 'Organization SSO'
env['ALLOW_SOCIAL_LOGIN'] = 'true'
env['ALLOW_SOCIAL_REGISTRATION'] = 'true'
env['ALLOW_REGISTRATION'] = 'false'
env['ALLOW_EMAIL_LOGIN'] = 'true'  # Existing operator recovery login remains available.
if not env.get('ORGANIZATION_BOOTSTRAP_USERS'):
    operator = subprocess.check_output(['docker', 'compose', '--project-directory', str(root),
        'exec', '-T', 'mongodb', 'mongosh', '--quiet', 'LibreChat', '--eval',
        'const u=db.users.findOne({role:"ADMIN"});if(u)print(u._id.toString())'], text=True).strip()
    if len(operator) != 24 or any(c not in '0123456789abcdef' for c in operator):
        raise RuntimeError('No existing operator recovery account found')
    env['ORGANIZATION_BOOTSTRAP_USERS'] = operator
directory = root / 'keycloak/import'
directory.mkdir(parents=True, exist_ok=True)
role_names = ['org-owner', 'org-admin', 'org-user']
realm = {'realm': 'open-harness', 'enabled': True, 'displayName': 'Open Harness',
         'registrationAllowed': False, 'resetPasswordAllowed': False,
         'bruteForceProtected': True, 'passwordPolicy': 'length(12)',
         'roles': {'realm': [{'name': name} for name in role_names]},
         'clients': [
             {'clientId': 'librechat', 'enabled': True, 'protocol': 'openid-connect',
              'publicClient': False, 'secret': env['OPENID_CLIENT_SECRET'],
              'standardFlowEnabled': True, 'directAccessGrantsEnabled': False,
              'redirectUris': [env['DOMAIN_CLIENT'] + '/oauth/openid/callback'],
              'webOrigins': [env['DOMAIN_CLIENT']],
              'attributes': {'pkce.code.challenge.method': 'S256'}},
             {'clientId': 'librechat-management', 'enabled': True, 'protocol': 'openid-connect',
              'publicClient': False, 'secret': env['KEYCLOAK_MANAGEMENT_SECRET'],
              'standardFlowEnabled': False, 'directAccessGrantsEnabled': False,
              'defaultClientScopes': ['profile', 'email', 'roles', 'kc-admin-api'],
              'serviceAccountsEnabled': True}],
         'users': [{'username': 'service-account-librechat-management', 'enabled': True,
                    'serviceAccountClientId': 'librechat-management',
                    'clientRoles': {'realm-management': ['view-users', 'query-users', 'manage-users',
                                                         'view-realm', 'manage-identity-providers']}}]}
realmfile = directory / 'open-harness-realm.json'
if not realmfile.exists():
    realmfile.write_text(json.dumps(realm))
# Keycloak runs as an unprivileged UID. The import contains client secrets, not user passwords.
os.chmod(root / 'keycloak', 0o755)
os.chmod(directory, 0o755)
os.chmod(realmfile, 0o644)
base = ['docker', 'compose', '--project-directory', str(root), '-f', str(root/'compose.yaml')]
for name in ['compose.override.yaml', 'compose.features.yaml', 'compose.autodeploy.yaml']:
    if (root/name).exists():
        base.extend(['-f', str(root/name)])
base.extend(['-f', str(root/'compose.keycloak.yaml')])
env['COMPOSE_FILE'] = ':'.join([p.name for p in [root/'compose.yaml'] + [root/n for n in
    ['compose.override.yaml','compose.features.yaml','compose.autodeploy.yaml','compose.keycloak.yaml'] if (root/n).exists()]])
envfile.write_text('\n'.join(f'{k}={v}' for k, v in env.items()) + '\n')
subprocess.run(base + ['up', '-d', 'keycloak-db', 'keycloak'], check=True)
caddy = root / 'Caddyfile'
text = caddy.read_text()
text = re.sub(r'hermes\.16-52-156-144\.sslip\.io\s*\{\s*reverse_proxy hermes:9119\s*\}',
    'hermes.16-52-156-144.sslip.io {\n    redir https://chat.16-52-156-144.sslip.io/hermes 302\n}', text)
if 'auth.16-52-156-144.sslip.io' not in text:
    (root / 'keycloak/Caddyfile.before').write_text(text)
    caddy.write_text(text + '\nauth.16-52-156-144.sslip.io {\n'
        '    @private path /admin /admin/* /realms/master /realms/master/*\n'
        '    respond @private 404\n'
        '    reverse_proxy keycloak:8080\n}\n')
    subprocess.run(base + ['restart', 'caddy'], check=True)
elif text != caddy.read_text():
    caddy.write_text(text)
    subprocess.run(base + ['restart', 'caddy'], check=True)
print('Keycloak services started. Credentials remain in the host environment file.')
