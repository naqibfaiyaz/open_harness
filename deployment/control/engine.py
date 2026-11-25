"""Host-only organization provisioner. No customer app receives a Docker socket."""
import datetime
from contextlib import contextmanager
import ipaddress
import json
import os
import pathlib
import re
import secrets
import sqlite3
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(os.environ.get('CONTROL_ROOT', '/opt/open-harness-control'))
PILOT = pathlib.Path('/opt/librechat-hermes')
RESERVED = {'open-harness', 'platform', 'admin', 'auth', 'chat', 'hermes', 'www'}
ROLES = ('owner', 'admin', 'user')

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def run(args, **kwargs):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, timeout=kwargs.pop('timeout', 180), **kwargs).stdout.strip()

def environment():
    return dict(line.split('=', 1) for line in (PILOT/'.env').read_text().splitlines()
                if '=' in line and not line.startswith('#'))

class ControlError(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status
        super().__init__(code)

class Engine:
    def __init__(self, recover=False):
        ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        (ROOT/'tenants').mkdir(mode=0o700, exist_ok=True)
        self.env = environment()
        self.domain = self.env.get('PLATFORM_BASE_DOMAIN', '16-52-156-144.sslip.io')
        self.max_orgs = int(self.env.get('PLATFORM_MAX_ORGANIZATIONS', '3'))
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS organizations (slug TEXT PRIMARY KEY, name TEXT, status TEXT, origin TEXT, ownerEmail TEXT, realm TEXT, errorCode TEXT, createdAt TEXT, updatedAt TEXT, existing INTEGER DEFAULT 0)')
            db.execute('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, at TEXT, outcome TEXT, reason TEXT)')
            db.execute('INSERT OR IGNORE INTO organizations VALUES (?,?,?,?,?,?,?,?,?,?)',
                ('open-harness', 'Open Harness', 'active', self.env['DOMAIN_CLIENT'], '', 'open-harness', None, now(), now(), 1))
            if recover:
                db.execute("UPDATE organizations SET status='failed',errorCode='WORKER_RESTARTED' WHERE status='provisioning'")
        self.token = None

    @contextmanager
    def db(self):
        db = sqlite3.connect(ROOT/'control.db', timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def audit(self, actor, action, target, reason, outcome):
        with self.db() as db:
            db.execute('INSERT INTO audit(actor,action,target,at,outcome,reason) VALUES (?,?,?,?,?,?)',
                       (actor, action, target, now(), outcome, reason))

    def organizations(self):
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM organizations ORDER BY createdAt')]

    def audits(self):
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT actor,action,target,at,outcome,reason FROM audit ORDER BY id DESC LIMIT 200')]

    def get(self, slug):
        with self.db() as db:
            row = db.execute('SELECT * FROM organizations WHERE slug=?', (slug,)).fetchone()
        if not row:
            raise ControlError('ORG_NOT_FOUND', 404)
        return dict(row)

    def state(self, slug, status, code=None):
        with self.db() as db:
            db.execute('UPDATE organizations SET status=?,errorCode=?,updatedAt=? WHERE slug=?', (status, code, now(), slug))

    def kc(self, path, method='GET', body=None):
        if not self.token or self.token[1] < datetime.datetime.now().timestamp():
            data = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': 'open-harness-control',
                'client_secret': self.env['PLATFORM_KEYCLOAK_SECRET']}).encode()
            with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8180/realms/master/protocol/openid-connect/token', data=data), timeout=15) as response:
                result = json.load(response)
            self.token = (result['access_token'], datetime.datetime.now().timestamp() + result['expires_in'] - 30)
        req = urllib.request.Request('http://127.0.0.1:8180/admin/realms' + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + self.token[0], 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return None if response.status in (201, 204) else json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise ControlError('IDENTITY_OPERATION_FAILED', 503) from None

    def tenant(self, slug):
        if not isinstance(slug, str) or not re.fullmatch(r'[a-z][a-z0-9-]{1,22}[a-z0-9]', slug) or slug in RESERVED:
            raise ControlError('INVALID_ORGANIZATION', 400)
        target = (ROOT/'tenants'/slug).resolve()
        if target.parent != (ROOT/'tenants').resolve():
            raise ControlError('INVALID_ORGANIZATION', 400)
        return target

    def create(self, data):
        slug = data.get('slug', '')
        target = self.tenant(slug)
        if not isinstance(data.get('name'), str) or not 2 <= len(data['name']) <= 80:
            raise ControlError('INVALID_INPUT', 400)
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', data.get('ownerEmail', '')) or len(data['ownerEmail']) > 254:
            raise ControlError('INVALID_INPUT', 400)
        if not isinstance(data.get('password'), str) or not 12 <= len(data['password']) <= 128:
            raise ControlError('INVALID_INPUT', 400)
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT count(*) FROM organizations').fetchone()[0] >= self.max_orgs:
                raise ControlError('ORGANIZATION_CAPACITY', 409)
            if db.execute('SELECT 1 FROM organizations WHERE slug=?', (slug,)).fetchone():
                raise ControlError('ORGANIZATION_EXISTS', 409)
            target.mkdir(mode=0o700)
            (target/'owner.json').write_text(json.dumps({'password': data['password'], 'selfService': bool(data.get('signupId'))}))
            db.execute('INSERT INTO organizations VALUES (?,?,?,?,?,?,?,?,?,?)', (slug, data['name'], 'provisioning',
                'https://'+slug+'.'+self.domain, data['ownerEmail'].strip().lower(), 'org-'+slug, None, now(), now(), 0))
            if data.get('signupId'):
                updated = db.execute('UPDATE signups SET slug=? WHERE id=? AND verified=1 AND slug IS NULL', (slug, data['signupId']))
                if updated.rowcount != 1:
                    raise ControlError('SIGNUP_ALREADY_CREATED')
        self.audit(data['actor'], 'create', slug, data['reason'], 'queued')
        return self.get(slug)

    def compose(self, slug, *args, timeout=180):
        return run(['docker', 'compose', '--project-directory', str(self.tenant(slug)), '-p', 'oh-'+slug,
                    '-f', str(self.tenant(slug)/'compose.json'), *args], timeout=timeout)

    def setup_identity(self, row, settings):
        realm = row['realm']
        path = '/'+realm
        if self.kc(path) is None:
            self.kc('', 'POST', {'realm': realm, 'displayName': row['name'], 'enabled': False,
                'registrationAllowed': False, 'bruteForceProtected': True, 'passwordPolicy': 'length(12)'})
            self.token = None
        self.kc(path, 'PUT', {'enabled': False})
        for role in ROLES:
            if self.kc(path+'/roles/org-'+role) is None:
                self.kc(path+'/roles', 'POST', {'name': 'org-'+role})
        clients = self.kc(path+'/clients?clientId=librechat')
        if not clients:
            self.kc(path+'/clients', 'POST', {'clientId': 'librechat', 'protocol': 'openid-connect',
                'publicClient': False, 'secret': settings['OPENID_CLIENT_SECRET'], 'standardFlowEnabled': True,
                'directAccessGrantsEnabled': False, 'redirectUris': [row['origin']+'/oauth/openid/callback'],
                'webOrigins': [row['origin']], 'attributes': {'pkce.code.challenge.method': 'S256'}})
        clients = self.kc(path+'/clients?clientId=librechat-management')
        if not clients:
            self.kc(path+'/clients', 'POST', {'clientId': 'librechat-management', 'protocol': 'openid-connect',
                'publicClient': False, 'secret': settings['KEYCLOAK_MANAGEMENT_SECRET'], 'serviceAccountsEnabled': True,
                'standardFlowEnabled': False, 'directAccessGrantsEnabled': False})
            clients = self.kc(path+'/clients?clientId=librechat-management')
        client = clients[0]
        scopes = self.kc(path+'/client-scopes')
        scope = next(s for s in scopes if s['name'] == 'kc-admin-api')
        self.kc(path+'/clients/'+client['id']+'/default-client-scopes/'+scope['id'], 'PUT')
        account = self.kc(path+'/clients/'+client['id']+'/service-account-user')
        management = self.kc(path+'/clients?clientId=realm-management')[0]
        roles = self.kc(path+'/clients/'+management['id']+'/roles')
        names = {'view-users', 'query-users', 'manage-users', 'view-realm', 'manage-identity-providers'}
        self.kc(path+'/users/'+account['id']+'/role-mappings/clients/'+management['id'], 'POST', [r for r in roles if r['name'] in names])
        users = self.kc(path+'/users?username='+urllib.parse.quote(row['ownerEmail'])+'&exact=true')
        ownerfile = self.tenant(row['slug'])/'owner.json'
        if not users:
            if not ownerfile.exists():
                raise ControlError('OWNER_SETUP_REQUIRED')
            initial = json.loads(ownerfile.read_text())
            self_service = initial.get('selfService', False)
            self.kc(path+'/users', 'POST', {'username': row['ownerEmail'], 'email': row['ownerEmail'],
                'enabled': True, 'emailVerified': self_service, 'firstName': 'Organization', 'lastName': 'Owner',
                'requiredActions': [] if self_service else ['UPDATE_PASSWORD'], 'credentials': [{'type': 'password',
                'value': initial['password'], 'temporary': not self_service}]})
            users = self.kc(path+'/users?username='+urllib.parse.quote(row['ownerEmail'])+'&exact=true')
        if ownerfile.exists():
            role = self.kc(path+'/roles/org-owner')
            self.kc(path+'/users/'+users[0]['id']+'/role-mappings/realm', 'POST', [role])
            ownerfile.unlink()

    def render(self, row):
        target = self.tenant(row['slug'])
        settings_file = target/'environment.json'
        if settings_file.exists():
            settings = json.loads(settings_file.read_text())
        else:
            settings = {name: secrets.token_hex(32) for name in ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CREDS_KEY',
                'HERMES_API_KEY', 'HERMES_BRIDGE_KEY', 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD',
                'KEYCLOAK_MANAGEMENT_SECRET', 'OPENID_CLIENT_SECRET', 'OPENID_SESSION_SECRET']}
            settings['CREDS_IV'] = secrets.token_hex(16)
            settings.update({'HOST': '0.0.0.0', 'PORT': '3080', 'MONGO_URI': 'mongodb://mongodb:27017/LibreChat',
                'ENDPOINTS': 'custom', 'SEARCH': 'false', 'ALLOW_EMAIL_LOGIN': 'false', 'ALLOW_REGISTRATION': 'false',
                'ALLOW_SOCIAL_LOGIN': 'true', 'ALLOW_SOCIAL_REGISTRATION': 'true', 'DOMAIN_CLIENT': row['origin'],
                'DOMAIN_SERVER': row['origin'], 'KEYCLOAK_ORIGIN': self.env['KEYCLOAK_ORIGIN'],
                'OPENID_CLIENT_ID': 'librechat', 'OPENID_ISSUER': self.env['KEYCLOAK_ORIGIN']+'/realms/'+row['realm'],
                'OPENID_SCOPE': 'openid profile email', 'OPENID_CALLBACK_URL': '/oauth/openid/callback',
                'OPENID_USE_PKCE': 'true', 'OPENID_BUTTON_LABEL': 'Organization SSO',
                'HERMES_DASHBOARD_USERNAME': 'operator', 'HERMES_DASHBOARD_PROVIDER': 'basic',
                'HERMES_DASHBOARD_PASSWORD': settings['HERMES_DASHBOARD_BASIC_AUTH_PASSWORD'],
                'TITLE_CONVO': 'true', 'ALLOW_SHARED_LINKS': 'true', 'ALLOW_SHARED_LINKS_PUBLIC': 'true'})
            settings['SCHEDULES_SINGLE_PROCESS'] = 'true'
            settings_file.write_text(json.dumps(settings))
        image = run(['docker', 'inspect', '--format', '{{.Config.Image}}', 'librechat-hermes-pilot-librechat-1'])
        settings.update({'OPENID_ADMIN_ROLE': 'org-owner', 'OPENID_ADMIN_ROLE_PARAMETER_PATH': 'realm_access.roles',
            'OPENID_ADMIN_ROLE_TOKEN_KIND': 'access', 'SCHEDULES_SINGLE_PROCESS': 'true'})
        settings_file.write_text(json.dumps(settings))
        config = json.loads((PILOT/'integration.librechat.yaml').read_text())
        config.pop('platform', None)
        config['organization'] = {'enabled': True, 'name': row['name'], 'realm': row['realm'],
            'issuer': settings['OPENID_ISSUER'], 'adminURL': 'http://keycloak:8080',
            'clientId': 'librechat-management', 'bootstrapUserIds': [], 'timeoutMs': 10000, 'maxMembers': 100}
        config['hermes'].update(publicOrigin=row['origin'], allowedUserIds=[])
        config['interface'].update(fileSearch=False, fileCitations=False, webSearch=False)
        config.pop('fileConfig', None)
        for key in ['webSearch', 'mcpServers', 'speech', 'ocr']:
            config.pop(key, None)
        (target/'librechat.json').write_text(json.dumps(config))
        os.chmod(target/'librechat.json', 0o644)
        project = 'oh-'+row['slug']
        release = pathlib.Path(run(['docker', 'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/opt/hermes/plugins/open-harness-titles"}}{{.Source}}{{end}}{{end}}', 'librechat-hermes-pilot-hermes-1']))
        theme = run(['docker', 'inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/opt/data/dashboard-themes/librechat.yaml"}}{{.Source}}{{end}}{{end}}', 'librechat-hermes-pilot-hermes-1'])
        hermes_env = {'API_SERVER_ENABLED': 'true', 'API_SERVER_HOST': '0.0.0.0', 'API_SERVER_PORT': '8642',
            'API_SERVER_KEY': settings['HERMES_API_KEY'], 'HERMES_DASHBOARD': '1', 'HERMES_DASHBOARD_HOST': '0.0.0.0',
            'HERMES_DASHBOARD_PORT': '9119', 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME': 'operator',
            'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD': settings['HERMES_DASHBOARD_PASSWORD'],
            'HERMES_BRIDGE_KEY': settings['HERMES_BRIDGE_KEY'], 'GATEWAY_MULTIPLEX_PROFILES': 'true',
            'HERMES_DASHBOARD_PUBLIC_URL': row['origin']+'/hermes-workspace'}
        compose = {'services': {
            'librechat': {'image': image, 'restart': 'unless-stopped', 'environment': {**settings, 'CONFIG_PATH': '/app/librechat.yaml'},
                'mem_limit': '1536m', 'pids_limit': 256, 'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL'],
                'volumes': ['./librechat.json:/app/librechat.yaml:ro', 'uploads:/app/uploads', 'images:/app/client/public/images', 'logs:/app/logs', 'data:/app/data'],
                'networks': {'backend': {}, 'data': {}, 'edge': {'aliases': ['lc-'+row['slug']]}},
                'depends_on': {'mongodb': {'condition': 'service_healthy'}}},
            'mongodb': {'image': 'mongo:8.0.20', 'restart': 'unless-stopped', 'mem_limit': '512m',
                'command': ['mongod', '--bind_ip_all', '--wiredTigerCacheSizeGB', '0.25'],
                'volumes': ['mongo:/data/db'], 'networks': ['data'],
                'healthcheck': {'test': ['CMD','mongosh','--quiet','--eval',"db.adminCommand('ping').ok"], 'interval': '5s','retries': 20}},
            'hermes': {'image': 'nousresearch/hermes-agent@sha256:41468459379a943cf0a25a55589e230d244bd9f95b83cff5eca789470c892fac',
                'restart': 'unless-stopped', 'command': ['gateway', 'run'], 'environment': hermes_env,
                'mem_limit': '2g', 'pids_limit': 256, 'cap_drop': ['ALL'],
                'cap_add': ['CHOWN','DAC_OVERRIDE','FOWNER','SETUID','SETGID'], 'security_opt': ['no-new-privileges:true'],
                'volumes': ['hermes:/opt/data', str(release)+':/opt/hermes/plugins/open-harness-titles:ro', theme+':/opt/data/dashboard-themes/librechat.yaml:ro'],
                'networks': ['backend']}},
            'networks': {'backend': {}, 'data': {'internal': True}, 'edge': {'internal': True}},
            'volumes': {name: {} for name in ['uploads','images','logs','data','mongo','hermes']}}
        (target/'compose.json').write_text(json.dumps(compose))
        return settings, project

    def network(self, project):
        network = project+'_backend'
        description = json.loads(run(['docker', 'network', 'inspect', network]))[0]
        subnet = ipaddress.ip_network(description['IPAM']['Config'][0]['Subnet'])
        if subnet.version != 4 or subnet.prefixlen < 16:
            raise ControlError('NETWORK_ISOLATION_FAILED')
        bridge = 'br-'+description['Id'][:12]
        # Each tenant may reach its own services and the public internet, never
        # EC2 instance metadata, another bridge, or private host/control services.
        rules = [(['-d','169.254.0.0/16'], 'REJECT'), (['-d',str(subnet)], 'RETURN')]
        rules.extend((['-d',cidr], 'REJECT') for cidr in ['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','127.0.0.0/8'])
        for conditions, action in reversed(rules):
            rule = ['-i',bridge,*conditions,'-j',action]
            check = subprocess.run(['iptables','-C','DOCKER-USER',*rule], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if check.returncode:
                run(['iptables','-I','DOCKER-USER','1',*rule])
        host_rule = ['-i',bridge,'-j','REJECT']
        if subprocess.run(['iptables','-C','INPUT',*host_rule], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
            run(['iptables','-I','INPUT','1',*host_rule])
        for container, net, alias in [('librechat-hermes-pilot-keycloak-1', network, 'keycloak'),
                                     ('librechat-hermes-pilot-caddy-1', project+'_edge', 'gateway')]:
            networks = json.loads(run(['docker','inspect','--format','{{json .NetworkSettings.Networks}}',container]))
            if net not in networks:
                run(['docker','network','connect','--alias',alias,net,container])

    def routing(self):
        lines = []
        for row in self.organizations():
            if row['existing']:
                continue
            host = urllib.parse.urlparse(row['origin']).hostname
            if row['status'] == 'active':
                lines.append(host+' {\n    reverse_proxy lc-'+row['slug']+':3080\n}\n')
            else:
                lines.append(host+' {\n    respond "Organization is unavailable" 503\n}\n')
        path = PILOT/'Caddyfile'
        text = path.read_text()
        block = '# BEGIN ORGANIZATIONS\n'+''.join(lines)+'# END ORGANIZATIONS'
        text = re.sub(r'# BEGIN ORGANIZATIONS\n.*?# END ORGANIZATIONS', lambda _match: block, text, flags=re.S) if '# BEGIN ORGANIZATIONS' in text else text.rstrip()+'\n\n'+block+'\n'
        path.write_text(text)
        run(['docker','exec','librechat-hermes-pilot-caddy-1','caddy','validate','--config','/etc/caddy/Caddyfile'])
        run(['docker','exec','librechat-hermes-pilot-caddy-1','caddy','reload','--config','/etc/caddy/Caddyfile','--address','unix//config/caddy-admin.sock'])

    def perform(self, slug, action, actor, reason):
        row = self.get(slug)
        if row['existing']:
            raise ControlError('PRIMARY_ORGANIZATION_PROTECTED')
        try:
            if action == 'suspend':
                self.kc('/'+row['realm'], 'PUT', {'enabled': False})
                self.compose(slug, 'stop', 'librechat', 'hermes', 'mongodb')
                self.state(slug, 'suspended')
            else:
                settings, project = self.render(row)
                self.setup_identity(row, settings)
                self.compose(slug, 'create', timeout=180)
                self.network(project)
                self.compose(slug, 'up', '-d', '--no-build', timeout=180)
                self.compose(slug, 'exec', '-T', 'hermes', 'hermes', 'plugins', 'enable', '--no-allow-tool-override', 'open-harness-titles', timeout=60)
                self.compose(slug, 'restart', 'hermes', timeout=60)
                # The tenant ingress network is private; health is checked inside its own container.
                import time
                ready = False
                for attempt in range(60):
                    try:
                        self.compose(slug, 'exec', '-T', 'librechat', 'node', '-e',
                            "Promise.all([fetch('http://127.0.0.1:3080/readyz'),fetch('http://hermes:9119/')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))", timeout=10)
                        ready = True
                        break
                    except subprocess.SubprocessError:
                        time.sleep(3)
                if not ready:
                    raise ControlError('APPLICATION_NOT_READY')
                self.kc('/'+row['realm'], 'PUT', {'enabled': True})
                self.state(slug, 'active')
            self.routing()
            self.audit(actor, action, slug, reason, 'success')
        except Exception as error:
            self.state(slug, 'failed', error.code if isinstance(error, ControlError) else 'PROVISIONING_FAILED')
            try:
                self.kc('/'+row['realm'], 'PUT', {'enabled': False})
                if (self.tenant(slug)/'compose.json').exists():
                    self.compose(slug, 'stop', 'librechat', 'hermes', 'mongodb')
                self.routing()
            except Exception:
                pass
            self.audit(actor, action, slug, reason, 'failed')

    def members(self, slug):
        row = self.get(slug)
        path = '/'+row['realm']
        result = []
        for user in self.kc(path+'/users?max=101') or []:
            if not user.get('email'):
                continue
            roles = self.kc(path+'/users/'+user['id']+'/role-mappings/realm')
            role = next((role for role in ROLES if any(r['name'] == 'org-'+role for r in roles)), 'pending')
            result.append({'id': user['id'], 'email': user['email'], 'enabled': user.get('enabled',False), 'role': role})
        return result

    def member(self, slug, member_id, data):
        if self.get(slug)['status'] != 'active':
            raise ControlError('ORGANIZATION_NOT_ACTIVE')
        target = next((member for member in self.members(slug) if member['id'] == member_id), None)
        if not target:
            raise ControlError('MEMBER_NOT_FOUND', 404)
        if target['role'] == 'owner':
            raise ControlError('OWNER_PROTECTED')
        role, enabled = data.get('role'), data.get('enabled')
        if role is not None and role not in ROLES or enabled is not None and not isinstance(enabled, bool):
            raise ControlError('INVALID_INPUT', 400)
        path = '/'+self.get(slug)['realm']+'/users/'+member_id
        if role:
            desired = self.kc('/'+self.get(slug)['realm']+'/roles/org-'+role)
            old = self.kc(path+'/role-mappings/realm')
            self.kc(path+'/role-mappings/realm', 'POST', [desired])
            previous = [r for r in old if r['name'].startswith('org-') and r['name'] != desired['name']]
            if previous:
                self.kc(path+'/role-mappings/realm', 'DELETE', previous)
        if enabled is not None:
            self.kc(path, 'PUT', {'enabled': enabled})
            if not enabled:
                self.kc(path+'/logout', 'POST')
        self.audit(data['actor'], 'member.update', slug+'/'+member_id, data['reason'], 'success')
        return {'ok': True}
