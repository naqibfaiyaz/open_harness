import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import engine
from signup import Signup, digest

class SignupTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = patch.object(engine, 'ROOT', pathlib.Path(self.directory.name))
        self.env = patch.object(engine, 'environment', return_value={'DOMAIN_CLIENT':'https://internal.example.test','KEYCLOAK_ORIGIN':'https://identity.example.test', 'SIGNUP_ENABLED':'true','SIGNUP_SMTP_HOST':'smtp.example.test','SIGNUP_EMAIL_FROM':'signup@example.test'})
        self.root.start(); self.env.start()
        self.engine = engine.Engine()
        self.sent = []
        self.signup = Signup(self.engine, lambda email, token: self.sent.append((email,token)))
    def tearDown(self):
        self.env.stop(); self.root.stop(); self.directory.cleanup()
    def verify(self, email='owner@example.test'):
        self.signup.call('start', {'email': email})
        token = self.sent[-1][1]
        session = self.signup.call('verify', {'token': token})['session']
        return token, session
    def test_verification_single_use_and_hashed_storage(self):
        token, session = self.verify()
        with self.assertRaises(engine.ControlError): self.signup.call('verify', {'token': token})
        with self.engine.db() as db:
            row = dict(db.execute('SELECT * FROM signups').fetchone())
        self.assertIsNone(row['token']); self.assertEqual(row['session'], digest(session))
        with self.assertRaises(engine.ControlError): self.signup.call('create', {'email':'victim@example.test','password':'synthetic-passphrase'})
    def test_owner_bound_to_verified_email_and_duplicate_is_idempotent(self):
        _, session = self.verify()
        data = {'session':session,'slug':'example-org','name':'Example Org','password':'synthetic-passphrase','ownerEmail':'attacker@example.test','actor':'platform-admin'}
        result = self.signup.call('create', data)
        self.assertTrue(result['queue'])
        self.assertEqual(self.engine.get('example-org')['ownerEmail'], 'owner@example.test')
        self.assertNotIn('queue', self.signup.call('create', data))
        self.assertEqual(len(self.engine.organizations()),2)
        self.assertTrue(json.loads((self.engine.tenant('example-org')/'owner.json').read_text())['selfService'])
        self.assertNotIn(data['password'], str(self.engine.audits()))
    def test_expired_link_rate_limit_and_capacity(self):
        self.signup.call('start', {'email':'expired@example.test'})
        with self.engine.db() as db: db.execute('UPDATE signups SET expires=0')
        with self.assertRaises(engine.ControlError): self.signup.call('verify', {'token':self.sent[-1][1]})
        with self.assertRaises(engine.ControlError): self.signup.call('start', {'email':'expired@example.test'})
        _, session = self.verify()
        self.engine.max_orgs=1
        with self.assertRaises(engine.ControlError) as error:
            self.signup.call('create', {'session':session,'slug':'example-org','name':'Example Org','password':'synthetic-passphrase'})
        self.assertEqual(error.exception.code,'ORGANIZATION_CAPACITY')
        self.assertEqual(self.signup.call('status',{'session':session})['status'],'verified')
    def test_mail_settings_never_return_password_and_default_disabled(self):
        self.engine.env['SIGNUP_ENABLED']='false'
        self.assertFalse(self.signup.enabled())
        settings={'enabled':True,'host':'smtp.example.test','port':587,'sender':'signup@example.test','username':'smtp-user','password':'synthetic-smtp-password','actor':'operator','reason':'Configure signup email delivery'}
        public=self.signup.configure(settings)
        self.assertTrue(public['enabled']); self.assertTrue(public['passwordConfigured'])
        self.assertNotIn(settings['password'],str(public)+str(self.engine.audits()))
        settings['password']=''
        self.signup.configure(settings)
        self.assertEqual(self.signup.settings()['SIGNUP_SMTP_PASSWORD'],'synthetic-smtp-password')
    def test_mail_failure_is_safe_and_no_org_is_created(self):
        self.signup.send=lambda *_: (_ for _ in ()).throw(RuntimeError('sensitive diagnostic'))
        with self.assertRaises(engine.ControlError) as error: self.signup.call('start', {'email':'owner@example.test'})
        self.assertEqual(error.exception.code,'SIGNUP_EMAIL_UNAVAILABLE')
        self.assertEqual(len(self.engine.organizations()),1)

if __name__ == '__main__': unittest.main()
