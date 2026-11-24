import pathlib
import tempfile
import unittest
from unittest.mock import patch
import engine

class EngineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = patch.object(engine, 'ROOT', pathlib.Path(self.directory.name))
        self.env = patch.object(engine, 'environment', return_value={'DOMAIN_CLIENT':'https://internal.example.test','KEYCLOAK_ORIGIN':'https://identity.example.test'})
        self.root.start(); self.env.start()
        self.engine = engine.Engine()

    def tearDown(self):
        self.env.stop(); self.root.stop(); self.directory.cleanup()

    def create(self, slug):
        return self.engine.create({'slug':slug,'name':'Example organization','ownerEmail':'owner@example.test',
            'password':'synthetic-temporary-password','actor':'operator','reason':'Create isolated test workspace'})

    def test_bounds_and_separate_directories(self):
        a, b = self.create('company-a'), self.create('company-b')
        self.assertNotEqual(a['realm'], b['realm'])
        self.assertNotEqual(a['origin'], b['origin'])
        self.assertNotEqual(self.engine.tenant(a['slug']), self.engine.tenant(b['slug']))
        with self.assertRaises(engine.ControlError): self.create('company-c')
        with self.assertRaises(engine.ControlError): self.create('company-a')
        self.assertNotIn('password', str(self.engine.organizations()))
        self.assertNotIn('synthetic-temporary-password', str(self.engine.audits()))

    def test_rejects_paths_and_reserved_names(self):
        for slug in ['../escape','/absolute','org/child','auth','open-harness','bad-','Aaa']:
            with self.assertRaises(engine.ControlError): self.engine.tenant(slug)

    def test_restart_recovers_only_inflight_records(self):
        self.create('company-a')
        replacement = engine.Engine(recover=True)
        self.assertEqual(replacement.get('company-a')['status'], 'failed')
        self.assertEqual(replacement.get('open-harness')['status'], 'active')

    def test_resume_never_regrants_the_original_owner_role(self):
        row=self.create('company-a')
        (self.engine.tenant(row['slug'])/'owner.json').unlink()
        writes=[]
        def kc(path,method='GET',body=None):
            if method!='GET': writes.append((path,method)); return None
            if path.endswith('/client-scopes'): return [{'id':'scope','name':'kc-admin-api'}]
            if path.endswith('/service-account-user'): return {'id':'service'}
            if '/clients?clientId=' in path: return [{'id':'client'}]
            if path.endswith('/roles'): return []
            if '/users?username=' in path: return [{'id':'former-owner'}]
            return {'id':'realm'}
        self.engine.kc=kc
        self.engine.setup_identity(row,{'OPENID_CLIENT_SECRET':'synthetic','KEYCLOAK_MANAGEMENT_SECRET':'synthetic'})
        self.assertFalse(any('/users/former-owner/role-mappings' in path for path,method in writes))

if __name__ == '__main__': unittest.main()
