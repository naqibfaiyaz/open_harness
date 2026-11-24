import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OrganizationService, IdentityError } = require('../src/LibreChat/packages/api/src/organization/service.ts') as typeof import('../src/LibreChat/packages/api/src/organization/service');
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const express = requireLC('express');
const { createOrganizationRouter } = requireLC('./packages/api/src/organization/index.ts');

const config = { enabled: true, name: 'Test', realm: 'test', issuer: 'https://identity.test/realms/test',
  adminURL: 'http://identity.test', clientId: 'management', bootstrapUserIds: ['recovery'], timeoutMs: 1000, maxMembers: 10 };
test('identity requires the configured issuer, enabled account and a live organization role', async () => {
  let enabled = true;
  let role = 'org-user';
  let requests = 0;
  const service = new OrganizationService(config, 'not-a-real-secret', async (input) => {
    requests++;
    const url = String(input);
    if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic', expires_in: 60 });
    if (url.endsWith('/role-mappings/realm')) return Response.json([{ id: 'role', name: role }]);
    return Response.json({ id: 'subject', enabled });
  });
  await assert.rejects(() => service.authorize({ id: 'other', role: 'ADMIN' }), { code: 'ORG_FORBIDDEN' });
  await assert.rejects(() => service.authorize({ openidId: 'subject', openidIssuer: 'https://evil.test' }), { code: 'ORG_FORBIDDEN' });
  assert.equal(requests, 0);
  const user = { openidId: 'subject', openidIssuer: config.issuer };
  assert.equal((await service.authorize(user)).role, 'user');
  role = 'org-admin';
  assert.equal((await service.authorize(user)).role, 'admin');
  enabled = false;
  await assert.rejects(() => service.authorize(user), { code: 'ORG_FORBIDDEN' });
  const recovery = await service.authorize({ id: 'recovery' });
  assert.equal(recovery.bootstrap, true);
  await assert.rejects(() => service.authorize({ id: 'recovery', openidId: 'subject', openidIssuer: 'wrong' }), { code: 'ORG_FORBIDDEN' });
});
test('identity provider failures fail closed without leaking secret responses', async () => {
  const service = new OrganizationService(config, 'private-secret', async () => new Response('private-secret', { status: 500 }));
  await assert.rejects(() => service.authorize({ openidId: 'subject', openidIssuer: config.issuer }), (error) =>
    error instanceof IdentityError && error.code === 'ORG_UNAVAILABLE' && !error.message.includes('private-secret'));
});
test('role changes add the desired role before removing old organization roles', async () => {
  const changes: string[] = [];
  const service = new OrganizationService(config, 'synthetic', async (input, options) => {
    const url = String(input);
    if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic', expires_in: 60 });
    if (url.endsWith('/roles/org-admin')) return Response.json({ id: 'new', name: 'org-admin' });
    if (options?.method === 'POST' || options?.method === 'DELETE') {
      changes.push(options.method);
      return new Response(null, { status: 204 });
    }
    return Response.json([{ id: 'old', name: 'org-user' }, { id: 'default', name: 'default-roles-test' }]);
  });
  await service.assign('member', 'admin');
  assert.deepEqual(changes, ['POST', 'DELETE']);
});

test('organization HTTP boundaries reject Users, cross-origin writes and Admin privilege escalation', async () => {
  const app = express();
  app.use(express.json());
  let actor = 'user';
  let writes = 0;
  const request: typeof fetch = async (input, options) => {
    const url = String(input);
    if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic', expires_in: 60 });
    if (options?.method !== 'GET') { writes++; return new Response(null, { status: 204 }); }
    if (url.endsWith('/role-mappings/realm')) return Response.json([{ id: 'role', name: `org-${actor}` }]);
    if (url.includes('/users?')) return Response.json([{ id: 'member', email: 'member@example.test', enabled: true }]);
    return Response.json({ id: 'subject', enabled: true });
  };
  app.use('/api/organization', createOrganizationRouter({ config, request, secret: 'synthetic', origin: 'https://app.test',
    linkIdentity: async () => {}, authenticate: (req, _res, next) => {
      req.user = { openidId: 'subject', openidIssuer: config.issuer }; next();
    } }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api/organization`;
  try {
    assert.equal((await fetch(`${origin}/members`)).status, 403);
    actor = 'admin';
    assert.equal((await fetch(`${origin}/connections`)).status, 403);
    assert.equal((await fetch(`${origin}/members`, { method: 'POST', headers: { Origin: 'https://attacker.test' } })).status, 403);
    assert.equal((await fetch(`${origin}/members`, { method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other@example.test', password: 'synthetic-password', role: 'admin' }) })).status, 403);
    assert.equal(writes, 0);
    actor = 'owner';
    assert.equal((await fetch(`${origin}/members/member`, { method: 'PATCH', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }) })).status, 403);
    assert.equal(writes, 0);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});
