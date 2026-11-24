import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { platformAccess, createPlatformRouter } = requireLC('./packages/api/src/platform/index.ts');
const { OrganizationService } = requireLC('./packages/api/src/organization/service.ts');
const express = requireLC('express');
const organization = { enabled: true, name: 'Internal', realm: 'internal', issuer: 'https://identity.test/realms/internal',
  adminURL: 'http://identity.test', clientId: 'management', bootstrapUserIds: [], timeoutMs: 1000, maxMembers: 100 };
const config = { enabled: true, socketPath: '/unused', bootstrapUserIds: ['recovery'], timeoutMs: 1000, requireMfa: true };

test('platform administration is independent of native ADMIN and organization Owner roles and requires MFA', async () => {
  let platform = false;
  let mfa = false;
  const identity = new OrganizationService(organization, 'synthetic', async (input) => {
    const url = String(input);
    if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic', expires_in: 60 });
    if (url.endsWith('/role-mappings/realm')) return Response.json([{ name: 'org-owner' }, ...(platform ? [{ name: 'platform-admin' }] : [])]);
    if (url.endsWith('/credentials')) return Response.json(mfa ? [{ type: 'otp' }] : []);
    return Response.json({ id: 'subject', enabled: true });
  });
  assert.equal((await platformAccess({ id: 'other', role: 'ADMIN' }, config, identity)).canManage, false);
  const user = { id: 'other', openidId: 'subject', openidIssuer: organization.issuer };
  assert.equal((await platformAccess(user, config, identity)).canManage, false);
  platform = true;
  assert.equal((await platformAccess(user, config, identity)).needsMfa, true);
  assert.equal((await platformAccess(user, config, identity)).canManage, false);
  mfa = true;
  assert.equal((await platformAccess(user, config, identity)).canManage, true);
  assert.equal((await platformAccess({ ...user, openidIssuer: 'https://other-org.test' }, config, identity)).canManage, false);
  assert.equal((await platformAccess({ id: 'recovery' }, config, identity)).recovery, true);
});

test('only configured platform operators can reach the provisioner; mutations bind actor and require Origin and reason', async () => {
  let user = { id: 'ordinary', role: 'ADMIN' };
  const calls: { path: string; body: object }[] = [];
  const app = express(); app.use(express.json());
  app.use('/api/platform', createPlatformRouter({ config, organization, organizationSecret: 'synthetic', controlSecret: 'synthetic',
    origin: 'https://app.test', authenticate: (req, _res, next) => { req.user = user; next(); },
    control: { call: async (path, _method, body) => { calls.push({path, body}); return []; } } }));
  const server = app.listen(0); await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api/platform`;
  try {
    assert.equal((await fetch(origin+'/organizations')).status, 403);
    user = { id: 'recovery', role: 'USER' };
    assert.equal((await fetch(origin+'/organizations')).status, 200);
    const data = { slug: 'company-a', name: 'Company A', ownerEmail: 'owner@example.test', password: 'synthetic-password', actor: 'spoofed' };
    const post = (body, source='https://app.test') => fetch(origin+'/organizations', { method: 'POST',
      headers: { Origin: source, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(data)).status, 400);
    assert.equal((await post({ ...data, reason: 'Create test organization' }, 'https://evil.test')).status, 403);
    assert.equal((await post({ ...data, reason: 'Create test organization' })).status, 202);
    assert.equal(calls.at(-1)?.body.actor, 'recovery');
    assert.equal((await post({ ...data, slug: '../unsafe', reason: 'Create test organization' })).status, 400);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
