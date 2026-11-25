import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';

const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { createHermesIntegration, createHermesBodyCapture, createHermesRequestSanitizer } = requireLC('./packages/api/src/hermes/index.ts');
const { WorkspaceSessions } = requireLC('./packages/api/src/hermes/sessions.ts');
const { HermesDashboard } = requireLC('./packages/api/src/hermes/dashboard.ts');
const { hermesTransportParams } = requireLC('./packages/api/src/hermes/transport.ts');
const { HermesProgress, observeHermesProgress } = requireLC('./packages/api/src/hermes/progress.ts');
const express = requireLC('express');
const { WebSocketServer, WebSocket } = requireLC('ws');
const secrets = { dashboardUsername: 'test-operator', dashboardPassword: 'fixture-password',
  dashboardProvider: 'basic', runtimeKey: 'fixture-runtime-key-long', bridgeKey: 'fixture-bridge-key-at-least-32-characters' };
const upstream = express();
const recordBytes = (req: any, _res: any, bytes: Buffer) => { req.originalBytes = bytes.toString(); };
upstream.use(express.json({ verify: recordBytes }));
upstream.use(express.urlencoded({ extended: true, verify: recordBytes }));
let logins = 0;
const runs: { path: string; key: string; session: string; body: Record<string, unknown> }[] = [];
const envWrites: Record<string, unknown>[] = [];
const titlePrompts: string[] = [];
let expiredRedirects = 0;
let cancelledStream: (() => void) | undefined;
let finishProgress: (() => void) | undefined;
upstream.post('/auth/password-login', (req: any, res: any) => {
  assert.equal(req.headers['x-forwarded-prefix'], '/hermes-workspace');
  assert.equal(req.body.password, secrets.dashboardPassword);
  logins++;
  res.setHeader('Set-Cookie', ['hermes_session_at=fixture-private-session; Path=/; HttpOnly',
    'hermes_session_rt=fixture-private-refresh; Path=/; HttpOnly']);
  res.json({ ok: true, next: '/' });
});
upstream.use('/api', (req: any, res: any, next: any) => {
  if (!req.headers.cookie?.includes('hermes_session_at=fixture-private-session')) return res.status(401).end();
  next();
});
upstream.get('/api/profiles', (_req: any, res: any) => res.json({ profiles: [
  { name: 'default', description: 'Default agent' }, { name: 'research', description: 'Research agent' },
] }));
upstream.post('/api/plugins/open-harness-titles/generate', (req: any, res: any) => {
  assert.equal(req.get('x-open-harness-key'), secrets.bridgeKey);
  titlePrompts.push(req.body.prompt);
  if (req.body.prompt === 'Fail title model') return res.status(503).end();
  res.json({ title: 'Montreal Travel Itinerary' });
});
upstream.put('/api/env', (req: any, res: any) => { envWrites.push(req.body); res.json({ ok: true }); });
upstream.post('/api/config', (req: any, res: any) => res.json({ data: req.body, original: req.originalBytes }));
upstream.get('/api/range', (req: any, res: any) => {
  if (req.get('range') === 'bytes=0-4') {
    res.status(206).set({ 'Content-Range': 'bytes 0-4/11', 'Accept-Ranges': 'bytes' }).send('hello');
  } else res.send('hello world');
});
upstream.get('/api/echo', (req: any, res: any) => {
  res.setHeader('Set-Cookie', 'hermes_session_rt=rotated-private-refresh; HttpOnly');
  res.json({ prefix: req.headers['x-forwarded-prefix'], origin: req.headers['x-forwarded-host'] });
});
upstream.get('/api/expired', (_req: any, res: any) => {
  if (expiredRedirects++ === 0) return res.redirect('/hermes-workspace/login?next=%2Fmodels');
  res.json({ ok: true });
});
upstream.post('/api/upload', (req: any, res: any) => {
  let value = '';
  req.on('data', (chunk: Buffer) => { value += chunk; });
  req.on('end', () => res.json({ size: value.length, contentType: req.headers['content-type'] }));
});
upstream.get('/models', (_req: any, res: any) => res.send('<html>Hermes dashboard</html>'));
upstream.use((req: any, res: any, next: any) => {
  if (!req.path.includes('/v1/')) return next();
  const expected = req.path.startsWith('/p/research/')
    ? createHmac('sha256', secrets.bridgeKey).update('profile:research').digest('base64url') : secrets.runtimeKey;
  if (req.headers.authorization !== `Bearer ${expected}`) return res.status(401).end();
  if (req.path.endsWith('/models')) return res.json({ object: 'list', data: [
    { id: 'hermes-agent', object: 'model' }, { id: 'provider/test-model', object: 'model' },
  ] });
  if (req.path.endsWith('/chat/completions')) {
    runs.push({ path: req.path, key: req.headers.authorization,
      session: req.headers['x-hermes-session-key'], body: req.body });
    if (req.body.stream) {
      res.type('text/event-stream');
      if (req.body.messages.filter((message: { role?: string }) => message.role === 'user').at(-1)?.content === 'progress') {
        res.write('event: hermes.tool.progress\r\ndata: {"tool":"terminal","toolCallId":"call-1","status":"running","label":"secret arguments"}\r\n\r\n');
        finishProgress = () => {
          res.write('event: hermes.tool.progress\ndata: {"tool":"terminal","toolCallId":"call-1","status":"completed"}\n\n');
          res.end('data: {"choices":[{"delta":{"content":"through Hermes"}}]}\n\ndata: [DONE]\n\n');
        };
        return;
      }
      res.write('data: {"choices":[{"delta":{"content":"through "}}]}\n\n');
      if (req.body.messages.filter((message: { role?: string }) => message.role === 'user').at(-1)?.content === 'hold') {
        res.once('close', () => cancelledStream?.());
        return;
      }
      setTimeout(() => res.end('data: {"choices":[{"delta":{"content":"Hermes"}}]}\n\ndata: [DONE]\n\n'), 20);
    } else res.json({ choices: [{ message: { role: 'assistant', content: 'through Hermes' } }] });
    return;
  }
  res.status(404).end();
});
const upstreamServer = createServer(upstream);
const app = express();
const server = createServer(app);
let origin: string;
let config: any;
let grantCookie: string;
let managerAllowed = true;
const wsServer = new WebSocketServer({ noServer: true });
upstreamServer.on('upgrade', (req, socket, head) => {
  if (!req.headers.cookie?.includes('fixture-private-session')) return socket.destroy();
  wsServer.handleUpgrade(req, socket, head, (ws: any) => ws.send('hermes-live'));
});
const authorization = (req: any, res: any, next: any) => {
  const value = req.headers.authorization;
  if (!['Bearer admin-token', 'Bearer user-token', 'Bearer operator-token'].includes(value)) return res.status(401).end();
  req.user = value === 'Bearer admin-token' ? { id: 'admin', role: managerAllowed ? 'ADMIN' : 'USER' }
    : value === 'Bearer operator-token' ? { id: 'operator', role: 'USER' } : { id: 'user', role: 'USER' };
  next();
};
const bearer = { Authorization: 'Bearer admin-token' };
const service = { Authorization: `Bearer ${secrets.bridgeKey}`, 'Content-Type': 'application/json',
  'X-LibreChat-User-Id': 'user', 'X-LibreChat-Conversation-Id': 'conversation-a' };

before(async () => {
  upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  config = { enabled: true, managedOnly: true, reportingPeriods: true, reportingTimeZone: 'America/Toronto', publicOrigin: origin,
    dashboardURL: `http://127.0.0.1:${(upstreamServer.address() as any).port}`,
    runtimeURL: `http://127.0.0.1:${(upstreamServer.address() as any).port}`,
    endpointName: 'Hermes', allowedUserIds: ['operator'] };
  const bridge = createHermesIntegration({ config, secrets, authenticate: authorization,
    loadUser: async (id) => ['admin', 'operator', 'user'].includes(id) ? { id, role: id === 'admin' ? 'ADMIN' : 'USER' } : undefined });
  const capture = createHermesBodyCapture(true);
  app.use(express.json({ verify: capture }));
  app.use(express.urlencoded({ extended: true, verify: capture }));
  app.use(createHermesRequestSanitizer((req: any, _res: any, next: any) => {
    if (req.body) { delete req.body.$schema; delete req.body['model.v1']; }
    next();
  }, true));
  app.post('/api/normal', (req: any, res: any) => res.json(req.body));
  app.use('/api/hermes/runtime/v1', bridge.executor);
  app.use('/api/hermes', bridge.api);
  app.use('/hermes-workspace', bridge.workspace);
  app.use(['/api/ask', '/api/agents/chat'], bridge.executionGuard);
  app.post(['/api/ask', '/api/agents/chat'], (req: any, res: any) => res.json({ ok: true, ephemeralAgent: req.body.ephemeralAgent }));
  bridge.attach(server);
});
after(async () => {
  for (const client of wsServer.clients) client.terminate();
  wsServer.close(); server.closeAllConnections(); upstreamServer.closeAllConnections();
  await Promise.all([new Promise<void>((resolve) => server.close(() => resolve())),
    new Promise<void>((resolve) => upstreamServer.close(() => resolve()))]);
});

test('management requires LibreChat authentication and explicit operator authority', async () => {
  assert.equal((await fetch(`${origin}/api/hermes/status`)).status, 401);
  const status = await fetch(`${origin}/api/hermes/status`, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json());
  assert.equal(status.canManage, false);
  for (const token of ['user-token', 'operator-token', 'admin-token']) {
    const res = await fetch(`${origin}/hermes-workspace/_session`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Origin: origin } });
    assert.equal(res.status, token === 'user-token' ? 403 : 200);
  }
});
test('SSO grants are opaque; upstream cookies never reach the browser', async () => {
  const response = await fetch(`${origin}/hermes-workspace/_session`, { method: 'POST', headers: { ...bearer, Origin: origin } });
  grantCookie = response.headers.get('set-cookie')!.split(';')[0];
  assert.match(grantCookie, /^lc_hermes_workspace=/);
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(response.headers.get('set-cookie')!, /SameSite=Lax/);
  assert.doesNotMatch(grantCookie, /fixture|admin-token/);
  const echo = await fetch(`${origin}/hermes-workspace/api/echo`, { headers: { Cookie: grantCookie } });
  assert.equal(echo.status, 200);
  assert.equal(echo.headers.get('set-cookie'), null);
  assert.deepEqual(await echo.json(), { prefix: '/hermes-workspace', origin: new URL(origin).host });
});
test('workspace refuses missing grants, cross-origin writes, and service auth changes', async () => {
  assert.equal((await fetch(`${origin}/hermes-workspace/models`)).status, 401);
  assert.equal((await fetch(`${origin}/hermes-workspace/_session`, { method: 'POST',
    headers: { ...bearer, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(`${origin}/hermes-workspace/api/env`, { method: 'PUT',
    headers: { Cookie: grantCookie, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(`${origin}/hermes-workspace/auth/password-login`, { method: 'POST',
    headers: { Cookie: grantCookie, Origin: origin } })).status, 403);
  managerAllowed = false;
  assert.equal((await fetch(`${origin}/hermes-workspace/api/echo`, { headers: { Cookie: grantCookie } })).status, 403);
  managerAllowed = true;
});
test('binary uploads reach Hermes intact', async () => {
  const response = await fetch(`${origin}/hermes-workspace/api/upload`, { method: 'POST', body: 'binary-file-content',
    headers: { Cookie: grantCookie, Origin: origin, 'Content-Type': 'application/octet-stream' } });
  assert.deepEqual(await response.json(), { size: 19, contentType: 'application/octet-stream' });
});
test('Hermes JSON schemas, dotted names and URL-encoded plugin forms survive Express middleware byte-for-byte', async () => {
  const json = '{ "$schema": "fixture-schema", "model.v1": {"$defs":{"x":{"type":"string"}}} }';
  const response = await fetch(`${origin}/hermes-workspace/api/config`, { method: 'POST', body: json,
    headers: { Cookie: grantCookie, Origin: origin, 'Content-Type': 'application/json' } });
  assert.deepEqual(await response.json(), { data: JSON.parse(json), original: json });
  const normal = await fetch(`${origin}/api/normal`, { method: 'POST', body: json,
    headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual(await normal.json(), {});
  const form = 'name=a%2Bb&tag=one&tag=two&nested%5Bvalue%5D=ok';
  const encoded = await fetch(`${origin}/hermes-workspace/api/config`, { method: 'POST', body: form,
    headers: { Cookie: grantCookie, Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal((await encoded.json()).original, form);
});
test('media byte ranges retain request and response semantics', async () => {
  const response = await fetch(`${origin}/hermes-workspace/api/range`, { headers: { Cookie: grantCookie, Range: 'bytes=0-4' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 0-4/11');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(await response.text(), 'hello');
});
test('ordinary requests and disabled integration keep the strict request sanitizer', () => {
  let strict = 0;
  let next = 0;
  const sanitise = (_req: any, _res: any, done: any) => { strict++; done(); };
  createHermesRequestSanitizer(sanitise, false)({ path: '/hermes-workspace/api/config' }, {}, () => next++);
  createHermesRequestSanitizer(sanitise, true)({ path: '/api/admin/users' }, {}, () => next++);
  assert.equal(strict, 2); assert.equal(next, 2);
});
test('live dashboard WebSockets pass only with valid workspace grants and origin', async () => {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/hermes-workspace/api/ws`, {
    headers: { Cookie: grantCookie, Origin: origin },
  });
  const [data] = await once(socket, 'message');
  assert.equal(data.toString(), 'hermes-live'); socket.terminate();
  const refused = new WebSocket(`${origin.replace('http:', 'ws:')}/hermes-workspace/api/ws`, {
    headers: { Cookie: grantCookie, Origin: 'https://foreign.example' },
  });
  const [failure] = await once(refused, 'error');
  assert.match(String(failure), /403/);
});
test('private runtime catalog and profile publication remain server authenticated', async () => {
  assert.equal((await fetch(`${origin}/api/hermes/runtime/v1/models`, { headers: bearer })).status, 401);
  const catalog = await fetch(`${origin}/api/hermes/runtime/v1/models`, { headers: service }).then((r) => r.json());
  assert.ok(catalog.data.some((m: any) => m.id === 'Agent: research'));
  assert.ok(catalog.data.some((m: any) => m.id === 'Model: provider/test-model'));
  const response = await fetch(`${origin}/api/hermes/publish`, { method: 'POST',
    headers: { ...bearer, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: 'research' }) });
  assert.deepEqual(await response.json(), { profile: 'research', ready: true });
  assert.equal(envWrites[0].key, 'API_SERVER_KEY'); assert.equal(envWrites[0].profile, 'research');
  assert.notEqual(envWrites[0].value, secrets.runtimeKey);
});
const chat = (model: string, extra = {}, headers = {}) => fetch(`${origin}/api/hermes/runtime/v1/chat/completions`, {
  method: 'POST', headers: { ...service, ...headers },
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }], ...extra }),
});
test('profiles select Hermes runtime scopes and drop caller credential/provider overrides', async () => {
  const response = await chat('Agent: research', { provider: 'attacker', api_key: 'untrusted', profile: 'default' });
  assert.equal(response.status, 200); await response.body?.cancel();
  assert.equal(runs.at(-1)!.path, '/p/research/v1/chat/completions');
  assert.equal(runs.at(-1)!.body.provider, undefined); assert.equal(runs.at(-1)!.body.api_key, undefined);
  assert.equal((await chat('Agent: missing')).status, 409);
  assert.equal((await chat('Model: unregistered')).status, 409);
});
test('SSE streams through Hermes and namespaces sessions by LibreChat user and conversation', async () => {
  const response = await chat('Model: provider/test-model', { stream: true });
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  assert.match(await response.text(), /through .*Hermes/s);
  const first = runs.at(-1)!.session;
  await (await chat('Agent: default')).text(); assert.equal(runs.at(-1)!.session, first);
  await (await chat('Agent: default', {}, { 'X-LibreChat-Conversation-Id': 'conversation-b' })).text();
  assert.notEqual(runs.at(-1)!.session, first);
  await (await chat('Agent: default', {}, { 'X-LibreChat-User-Id': 'admin' })).text();
  assert.notEqual(runs.at(-1)!.session, first); assert.doesNotMatch(first, /user|conversation/);
});
test('native LibreChat tool loops, missing session context, and direct execution are refused', async () => {
  assert.equal((await chat('Agent: default', { tools: [{ type: 'function' }] })).status, 400);
  assert.equal((await chat('Agent: default', {}, { 'X-LibreChat-Conversation-Id': '' })).status, 400);
  assert.equal((await chat('Agent: default', {}, { 'X-LibreChat-User-Id': 'deleted' })).status, 403);
  for (const [route, endpoint, expected] of [
    ['/api/ask', 'Hermes', 200], ['/api/ask', 'OpenRouter', 403], ['/api/agents/chat', 'Hermes', 200],
  ] as const) {
    const response = await fetch(`${origin}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, endpointOption: { endpoint } }) }); assert.equal(response.status, expected);
  }
});
test('unified LibreChat chat transport strips local tools, skills, memory and execution before initialization', () => {
  const params: any = {
    req: { config: { config: { hermes: { enabled: true, managedOnly: true, endpointName: 'Hermes' } } } },
    endpointOption: { endpoint: 'Hermes' },
    agent: { tools: ['execute_code'], tool_resources: { execute_code: {} }, agent_ids: ['native-child'], artifacts: 'default' },
    accessibleSkillIds: ['native-skill'], manualSkills: ['native-skill'], memoryAvailable: true,
    codeEnvAvailable: true, fileSearchAvailable: true, skillAuthoringAvailable: true,
  };
  const next = hermesTransportParams(params);
  assert.deepEqual(next.agent.tools, []); assert.deepEqual(next.agent.agent_ids, []);
  assert.equal(next.agent.artifacts, 'default');
  assert.deepEqual(next.manualSkills, []); assert.deepEqual(next.accessibleSkillIds, []);
  assert.equal(next.memoryAvailable, false); assert.equal(next.codeEnvAvailable, false);
  assert.equal(next.fileSearchAvailable, false); assert.equal(next.skillAuthoringAvailable, false);
  assert.notEqual(next, params); assert.deepEqual(params.agent.tools, ['execute_code']);
  const other = { ...params, endpointOption: { endpoint: 'OpenRouter' } };
  assert.throws(() => hermesTransportParams(other), { code: 'HERMES_EXECUTION_REQUIRED' });
  const unmanaged = { ...other, req: { config: { config: {} } } };
  assert.equal(hermesTransportParams(unmanaged), unmanaged);
});

test('artifact presentation modes survive managed execution without enabling native tools', async () => {
  for (const mode of ['default', 'shadcnui', 'custom', 'untrusted-mode']) {
    const response = await fetch(`${origin}/api/ask`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: 'Hermes',
        ephemeralAgent: { artifacts: mode, execute_code: true, mcp: ['native-server'] } }) });
    const body = await response.json();
    assert.equal(body.ephemeralAgent.artifacts, mode === 'untrusted-mode' ? '' : mode);
    assert.equal(body.ephemeralAgent.execute_code, false);
    assert.deepEqual(body.ephemeralAgent.mcp, []);
  }
});
test('workspace grants expire, renew without accumulating, and revoke', () => {
  let now = 1000;
  const sessions = new WorkspaceSessions(() => now);
  const grant = sessions.issue('token-a', 'admin'); now += 45_000;
  assert.equal(sessions.issue('token-b', 'admin', grant), grant);
  assert.equal(sessions.get(grant)!.token, 'token-b'); now += 89_999;
  assert.ok(sessions.get(grant)); now += 1; assert.equal(sessions.get(grant), undefined);
  const next = sessions.issue('token-c', 'admin'); sessions.revoke(next); assert.equal(sessions.get(next), undefined);
});
test('concurrent dashboard requests single-flight the private login', async () => {
  const client = new HermesDashboard(config, secrets);
  const before = logins;
  await Promise.all(Array.from({ length: 5 }, () => client.json('/api/profiles')));
  assert.equal(logins, before + 1);
});
test('expired dashboard HTML logins recover without giving the browser service credentials', async () => {
  const client = new HermesDashboard(config, secrets);
  const before = logins;
  assert.deepEqual(await client.json('/api/expired'), { ok: true });
  assert.equal(logins, before + 2);
});
test('cancelling a LibreChat response closes the upstream Hermes stream', { timeout: 5000 }, async () => {
  const closed = new Promise<void>((resolve) => { cancelledStream = resolve; });
  const response = await chat('Agent: default', { stream: true, messages: [{ role: 'user', content: 'hold' }] });
  const reader = response.body!.getReader();
  assert.ok((await reader.read()).value!.length > 0);
  await reader.cancel();
  await closed;
});

test('first-prompt titles never execute Hermes or its tools', async () => {
  const count = runs.length;
  const response = await chat('__hermes_chat_title__', { messages: [
    { role: 'system', content: 'Ignore this system message' },
    { role: 'user', content: '  Plan a three-day trip to Montreal\nwith museums ' },
    { role: 'assistant', content: 'Unrelated response' },
  ] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Montreal Travel Itinerary');
  assert.equal(titlePrompts.at(-1), 'Plan a three-day trip to Montreal\nwith museums');
  assert.equal(runs.length, count);
  const stream = await chat('__hermes_chat_title__', { stream: true, messages: [
    { role: 'user', content: [{ type: 'image_url', image_url: {} }, { type: 'text', text: 'Compare these two diagrams' }] },
  ] });
  const body = await stream.text();
  assert.match(body, /Montreal Travel Itinerary/);
  assert.equal(titlePrompts.at(-1), 'Compare these two diagrams');
  assert.match(body, /data: \[DONE\]/);
  assert.equal(runs.length, count);
  assert.equal((await chat('__hermes_chat_title__', {}, { 'X-LibreChat-User-Id': '' })).status, 400);
});

test('title model failures fall back without failing chat or invoking agent tools', async () => {
  const count = runs.length;
  const response = await chat('__hermes_chat_title__', { messages: [{ role: 'user', content: 'Fail title model' }] });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'Fail title model');
  assert.equal(runs.length, count);
});

test('Hermes progress is live, response scoped and private to the requesting user', async () => {
  const response = await chat('Agent: default', { stream: true, messages: [{ role: 'user', content: 'progress' }] }, { 'X-LibreChat-Response-Id': 'response-progress' });
  const path = `${origin}/api/hermes/progress/conversation-a/response-progress`;
  const read = () => fetch(path, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json());
  const running = await read();
  const currentPath = `${origin}/api/hermes/progress/conversation-a`;
  const current = await fetch(currentPath, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json());
  assert.equal(current.id, running.id);
  assert.equal(current.tools[0].status, 'running');
  assert.equal((await fetch(currentPath)).status, 401);
  assert.equal(await fetch(currentPath, { headers: bearer }).then((r) => r.json()), null);
  assert.equal(running.active, true);
  assert.deepEqual(running.tools, [{ id: 'call-1', tool: 'terminal', status: 'running' }]);
  assert.equal(JSON.stringify(running).includes('secret'), false);
  assert.equal((await fetch(path)).status, 401);
  assert.equal(await fetch(path, { headers: bearer }).then((r) => r.json()), null);
  assert.equal(await fetch(`${origin}/api/hermes/progress/conversation-b/response-progress`, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json()), null);
  finishProgress?.();
  const text = await response.text();
  assert.match(text, /through Hermes/);
  assert.match(text, /hermes.tool.progress/);
  const complete = await read();
  assert.equal(await fetch(currentPath, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json()), null);
  assert.equal(complete.active, false);
  assert.equal(complete.tools[0].status, 'completed');
});

test('progress parser preserves bytes across fragmented UTF-8, multiline metadata and malformed events', async () => {
  const events: unknown[] = [];
  let ended = false;
  const text = 'event: hermes.tool.progress\r\ndata: {"tool":"terminal",\r\ndata: "status":"running","label":"café"}\r\n\r\nevent: hermes.tool.progress\ndata: invalid\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const source = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const output = await new Response(source.pipeThrough(observeHermesProgress((e: unknown) => events.push(e), () => { ended = true; }))).text();
  assert.equal(output, text);
  assert.equal(events.length, 1);
  assert.equal(ended, true);
});

test('ordinary turns correlate progress by user message when no edited response ID is present', async () => {
  const response = await chat('Agent: default', { stream: true }, { 'X-LibreChat-Message-Id': 'ordinary-user-message' });
  await response.text();
  const state = await fetch(`${origin}/api/hermes/progress/conversation-a/ordinary-user-message`, { headers: { Authorization: 'Bearer user-token' } }).then((r) => r.json());
  assert.equal(state.active, false);
  assert.deepEqual(state.tools, []);
});

test('progress retries, cancellations and bounded retention cannot contaminate another run', () => {
  const state = new HermesProgress({ maxRuns: 1, maxTools: 1, retentionMs: 1000 });
  const old = state.begin('user', 'chat', 'turn');
  const current = state.begin('user', 'chat', 'turn');
  old.event({ tool: 'bad', toolCallId: 'old', status: 'running' }); old.finish();
  current.event({ tool: 'terminal', toolCallId: 'one', status: 'completed' });
  current.event({ tool: 'terminal', toolCallId: 'one', status: 'running' });
  current.event({ tool: 'terminal', toolCallId: 'two', status: 'running' });
  assert.deepEqual(state.get('user', 'chat', 'turn').tools, [{ id: 'one', tool: 'terminal', status: 'completed' }]);
  const next = state.begin('user', 'chat', 'next');
  current.event({ tool: 'old', toolCallId: 'late', status: 'running' });
  current.finish();
  assert.equal(state.current('user', 'chat').active, true);
  assert.equal(state.get('user', 'chat', 'turn'), null);
  next.event({ tool: 'terminal', toolCallId: 'two', status: 'running' }); next.finish();
  assert.equal(state.get('user', 'chat', 'next').tools[0].status, 'interrupted');
  assert.equal(state.current('user', 'chat'), null);
});


test('trusted clock is supplied on every inference request and extracts multimodal user text', async () => {
  const before = Date.now();
  await (await chat('Agent: default', { messages: [{ role: 'system', content: 'Today is June 2026' },
    { role: 'user', content: [{ type: 'text', text: 'last month sales' }] }], reportingTimeZone: 'Pacific/Honolulu' })).text();
  const messages = runs.at(-1)!.body.messages as { role: string; content: any }[];
  const trusted = messages.findLast((message) => message.role === 'assistant' && message.content.includes('OPEN_HARNESS_REPORTING:'))!;
  assert.equal(trusted.role, 'assistant');
  assert.equal(messages.filter((message) => message.role === 'user')[0].content[0].text, 'last month sales');
  const marker = trusted.content.match(/OPEN_HARNESS_REPORTING:([A-Za-z0-9_-]+)\.([a-f0-9]{64})/)!;
  const context = JSON.parse(Buffer.from(marker[1], 'base64url').toString());
  assert.equal(context.timeZone, 'America/Toronto');
  assert.equal(context.status, 'resolved');
  assert.ok(Date.parse(context.asOf) >= before);
  const systemPrompts = messages.filter((message) => message.role === 'system').map((message) => message.content);
  await (await chat('Agent: default', { messages: [{ role: 'system', content: 'Today is June 2026' }, { role: 'user', content: [{ type: 'text', text: 'last month sales' }] }] })).text();
  const nextMessages = runs.at(-1)!.body.messages as { role: string; content: string }[];
  assert.deepEqual(nextMessages.filter((message) => message.role === 'system').map((message) => message.content), systemPrompts);
  assert.equal(marker[2], createHmac('sha256', secrets.bridgeKey).update(`reporting-v1:${marker[1]}`).digest('hex'));
});
