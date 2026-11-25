"""Public onboarding state; verification/session secrets are stored only as hashes."""
import datetime
import hashlib
import re
import secrets
import smtplib
import ssl
import json
import os
import engine as provisioner
from email.message import EmailMessage
from engine import ControlError, now


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Signup:
    def __init__(self, engine, send=None):
        self.engine = engine
        self.send = send or self.mail
        self.ttl = int(engine.env.get('SIGNUP_VERIFICATION_MINUTES', '30')) * 60
        self.session_ttl = int(engine.env.get('SIGNUP_SESSION_HOURS', '24')) * 3600
        with engine.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS signups (id TEXT PRIMARY KEY, email TEXT UNIQUE, token TEXT, expires REAL, sent REAL, session TEXT, sessionExpires REAL, verified INTEGER DEFAULT 0, slug TEXT)')
            db.execute('CREATE TABLE IF NOT EXISTS signup_limits (key TEXT PRIMARY KEY, count INTEGER, expires REAL)')

    def settings(self):
        path = provisioner.ROOT/'signup-mail.json'
        return {**self.engine.env, **(json.loads(path.read_text()) if path.exists() else {})}

    def configuration(self):
        env = self.settings()
        return {'enabled': self.enabled(), 'requestedEnabled': env.get('SIGNUP_ENABLED') == 'true',
                'host': env.get('SIGNUP_SMTP_HOST', ''), 'port': int(env.get('SIGNUP_SMTP_PORT', '587')),
                'sender': env.get('SIGNUP_EMAIL_FROM', ''), 'username': env.get('SIGNUP_SMTP_USER', ''),
                'passwordConfigured': bool(env.get('SIGNUP_SMTP_PASSWORD'))}

    def configure(self, data):
        if not isinstance(data.get('enabled'), bool) or not isinstance(data.get('port'), int) or data['port'] not in (465, 587):
            raise ControlError('INVALID_INPUT', 400)
        for field in ('host', 'sender', 'username', 'password'):
            value = data.get(field, '')
            if not isinstance(value, str) or len(value) > 1000 or '\r' in value or '\n' in value:
                raise ControlError('INVALID_INPUT', 400)
        if data['enabled'] and (not re.fullmatch(r'[a-zA-Z0-9.-]{1,253}', data.get('host', '')) or not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', data.get('sender', ''))):
            raise ControlError('INVALID_INPUT', 400)
        env = self.settings()
        values = {'SIGNUP_ENABLED': str(data['enabled']).lower(), 'SIGNUP_SMTP_HOST': data.get('host', ''),
                  'SIGNUP_SMTP_PORT': str(data['port']), 'SIGNUP_EMAIL_FROM': data.get('sender', ''),
                  'SIGNUP_SMTP_USER': data.get('username', ''),
                  'SIGNUP_SMTP_PASSWORD': data.get('password') or env.get('SIGNUP_SMTP_PASSWORD', '')}
        path = provisioner.ROOT/'signup-mail.json'
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps(values))
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        self.engine.audit(data['actor'], 'signup-email-settings', 'platform', data['reason'], 'saved')
        return self.configuration()

    def enabled(self):
        env = self.settings()
        return env.get('SIGNUP_ENABLED') == 'true' and bool(env.get('SIGNUP_SMTP_HOST') and env.get('SIGNUP_EMAIL_FROM'))

    def mail(self, email, token):
        env = self.settings()
        message = EmailMessage()
        message['From'] = env['SIGNUP_EMAIL_FROM']
        message['To'] = email
        message['Subject'] = 'Verify your email to create your workspace'
        link = env['DOMAIN_CLIENT'].rstrip('/') + '/signup#token=' + token
        message.set_content('Verify your email to create your organization workspace:\n\n' + link + '\n\nThis link expires in '+str(self.ttl // 60)+' minutes. If you did not request it, ignore this email.')
        host, port = env['SIGNUP_SMTP_HOST'], int(env.get('SIGNUP_SMTP_PORT', '587'))
        context = ssl.create_default_context()
        smtp = smtplib.SMTP_SSL(host, port, timeout=15, context=context) if port == 465 else smtplib.SMTP(host, port, timeout=15)
        with smtp:
            if port != 465:
                smtp.starttls(context=context)
            if env.get('SIGNUP_SMTP_USER'):
                smtp.login(env['SIGNUP_SMTP_USER'], env['SIGNUP_SMTP_PASSWORD'])
            smtp.send_message(message)

    def limit(self, key, maximum, seconds):
        timestamp = datetime.datetime.now().timestamp()
        with self.engine.db() as db:
            db.execute('BEGIN IMMEDIATE')
            db.execute('DELETE FROM signup_limits WHERE expires < ?', (timestamp,))
            row = db.execute('SELECT count FROM signup_limits WHERE key=?', (key,)).fetchone()
            if row and row['count'] >= maximum:
                raise ControlError('SIGNUP_RATE_LIMIT', 429)
            db.execute('INSERT INTO signup_limits VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, 1, timestamp+seconds))

    def call(self, action, data):
        if not self.enabled():
            raise ControlError('SIGNUP_UNAVAILABLE', 503)
        if action == 'start':
            return self.start(data)
        if action == 'verify':
            return self.verify(data)
        session = data.get('session', '')
        if not isinstance(session, str) or not re.fullmatch(r'[a-f0-9]{64}', session):
            raise ControlError('SIGNUP_SESSION_REQUIRED', 401)
        with self.engine.db() as db:
            row = db.execute('SELECT * FROM signups WHERE session=? AND verified=1 AND sessionExpires>?', (digest(session), datetime.datetime.now().timestamp())).fetchone()
        if not row:
            raise ControlError('SIGNUP_SESSION_REQUIRED', 401)
        if action == 'status':
            return self.status(row)
        if action == 'create':
            if row['slug']:
                return self.status(row)
            result = self.engine.create({'slug': data.get('slug'), 'name': data.get('name'), 'password': data.get('password'),
                'ownerEmail': row['email'], 'signupId': row['id'], 'actor': 'signup-'+row['id'], 'reason': 'Verified self-service organization signup'})
            return {'status': result['status'], 'origin': result['origin'], 'slug': result['slug'], 'queue': True}
        raise ControlError('NOT_FOUND', 404)

    def status(self, row):
        if not row['slug']:
            return {'status': 'verified', 'email': row['email']}
        org = self.engine.get(row['slug'])
        return {'status': org['status'], 'origin': org['origin'], 'slug': org['slug'], 'email': row['email']}

    def start(self, data):
        email = data.get('email', '')
        if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r'[^\s@<>,;:"\\]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}', email):
            raise ControlError('INVALID_INPUT', 400)
        email = email.strip().lower()
        self.limit('email-'+digest(email), int(self.engine.env.get('SIGNUP_EMAIL_HOURLY_LIMIT', '3')), 3600)
        self.limit('global', int(self.engine.env.get('SIGNUP_DAILY_EMAIL_LIMIT', '100')), 86400)
        timestamp = datetime.datetime.now().timestamp()
        token, identifier = secrets.token_hex(32), secrets.token_hex(16)
        with self.engine.db() as db:
            row = db.execute('SELECT * FROM signups WHERE email=?', (email,)).fetchone()
            if row and timestamp-row['sent'] < 60:
                raise ControlError('SIGNUP_RATE_LIMIT', 429)
            db.execute('INSERT INTO signups(id,email,token,expires,sent) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET token=excluded.token,expires=excluded.expires,sent=excluded.sent', (identifier, email, digest(token), timestamp+self.ttl, timestamp))
        try:
            self.send(email, token)
        except Exception:
            raise ControlError('SIGNUP_EMAIL_UNAVAILABLE', 503) from None
        return {'sent': True}

    def verify(self, data):
        token = data.get('token', '')
        if not isinstance(token, str) or not re.fullmatch(r'[a-f0-9]{64}', token):
            raise ControlError('SIGNUP_LINK_INVALID', 400)
        session = secrets.token_hex(32)
        with self.engine.db() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM signups WHERE token=? AND expires>?', (digest(token), datetime.datetime.now().timestamp())).fetchone()
            if not row:
                raise ControlError('SIGNUP_LINK_INVALID', 400)
            db.execute('UPDATE signups SET token=NULL, verified=1, session=?,sessionExpires=? WHERE id=?', (digest(session), datetime.datetime.now().timestamp()+self.session_ttl, row['id']))
        return {'session': session, 'status': 'verified', 'email': row['email']}
