const { createRequire } = require('node:module');
const requireApp = createRequire('/app/package.json');
const jwt = requireApp('jsonwebtoken');
const [adminId, publicOrigin] = process.argv.slice(2);
async function check() {
  if (!adminId || !publicOrigin) throw new Error('Smoke test requires an existing administrator and origin');
  const token = jwt.sign({ id: adminId, issuedAtMs: Date.now() }, process.env.JWT_SECRET, { expiresIn: '2m' });
  const headers = { Authorization: `Bearer ${token}` };
  const url = 'http://127.0.0.1:3080';
  if (process.env.PLATFORM_CONTROL_ENABLED === 'true') {
    const response = await fetch(`${url}/api/platform/status`, { headers });
    const platform = await response.json();
    if (!response.ok || !platform.enabled || (!platform.canManage && !platform.needsMfa)) throw new Error('Platform authorization is not configured for the initial operator');
    if (platform.canManage) {
      const organizations = await fetch(`${url}/api/platform/organizations`, { headers });
      if (!organizations.ok || !Array.isArray(await organizations.json())) throw new Error('Protected organization provisioner is unavailable');
    }
  }
  if (process.env.KEYCLOAK_ORIGIN) {
    const org = await fetch(`${url}/api/organization`, { headers });
    if (!org.ok || (await org.json()).role !== 'owner') throw new Error('Organization owner authorization failed');
    const members = await fetch(`${url}/api/organization/members`, { headers });
    if (!members.ok || !Array.isArray(await members.json())) throw new Error('Organization membership connection failed');
  }
  const status = await fetch(`${url}/api/hermes/status`, { headers }).then(async (r) => {
    if (!r.ok) throw new Error(`Workspace status failed: HTTP ${r.status}`);
    return r.json();
  });
  if (!status.enabled || !status.canManage || !status.managedOnly) throw new Error('Hermes management is not enabled for the administrator');
  if (!status.interactiveGraphs || !status.deliverFiles) throw new Error('Interactive artifacts and file delivery are not enabled');
  const startup = await fetch(`${url}/api/config`, { headers }).then((r) => r.json());
  if (!startup.sharedLinksEnabled || !startup.publicSharedLinksEnabled) throw new Error('Artifact conversation sharing is not enabled');
  const session = await fetch(`${url}/hermes-workspace/_session`, { method: 'POST', headers: { ...headers, Origin: publicOrigin } });
  if (!session.ok) throw new Error(`Workspace sign-in failed: HTTP ${session.status}`);
  const cookie = session.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('lc_hermes_workspace='));
  if (!cookie) throw new Error('Workspace grant cookie missing');
  const page = await fetch(`${url}/hermes-workspace/profiles?profile=default`, { headers: { Cookie: cookie } });
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Hermes management page did not load');
  if (!(await page.text()).includes('__HERMES_BASE_PATH__')) throw new Error('Hermes dashboard bootstrap missing');
  const themes = await fetch(`${url}/hermes-workspace/api/dashboard/themes`, { headers: { Cookie: cookie } }).then((r) => r.json());
  if (!themes.themes?.some((theme) => theme.name === 'librechat' && theme.definition?.customCSS?.includes('--lc-hermes-canvas'))) throw new Error('LibreChat Hermes theme is not available');
  const profiles = await fetch(`${url}/api/hermes/profiles`, { headers }).then((r) => r.json());
  if (!profiles.profiles?.some((p) => p.name === 'default')) throw new Error('Hermes profile catalog unavailable');
  const models = await fetch(`${url}/api/hermes/runtime/v1/models`, {
    headers: { Authorization: `Bearer ${process.env.HERMES_BRIDGE_KEY}` },
  }).then((r) => r.json());
  if (!models.data?.some((m) => m.id === 'Agent: default')) throw new Error('Hermes model catalog unavailable');
  const keyPage = await fetch(`${url}/api/organization/api-keys`, { headers });
  if (!keyPage.ok || !(await keyPage.json()).enabled) throw new Error('Organization API key management unavailable');
  const created = await fetch(`${url}/api/organization/api-keys`, {
    method: 'POST', headers: { ...headers, Origin: publicOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Deployment verification ${Date.now()}`, expiryDays: 1, allowedModels: ['Agent: default'] }),
  });
  if (created.status !== 201) throw new Error(`Disposable API key creation failed: HTTP ${created.status}`);
  const disposable = await created.json();
  const apiHeaders = { Authorization: `Bearer ${disposable.secret}`, 'Content-Type': 'application/json' };
  try {
    const catalog = await fetch(`${url}/api/agents/v1/models`, { headers: apiHeaders });
    const allowed = await catalog.json();
    if (!catalog.ok || allowed.data?.length !== 1 || allowed.data[0].id !== 'Agent: default') throw new Error('Organization API model scope failed');
    const denied = await fetch(`${url}/api/agents/v1/chat/completions`, {
      method: 'POST', headers: apiHeaders, body: JSON.stringify({ model: 'Agent: forbidden', messages: [] }),
    });
    if (denied.status !== 403) throw new Error('Organization API model restriction failed');
    const completion = await fetch(`${url}/api/agents/v1/chat/completions`, {
      method: 'POST', headers: apiHeaders, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model: 'Agent: default', messages: [{ role: 'user', content: 'Reply with API_OK only. Do not use tools or access files, memory or external services.' }], stream: false }),
    });
    const result = await completion.json();
    if (!completion.ok || typeof result.choices?.[0]?.message?.content !== 'string' || !result.choices[0].message.content.includes('API_OK')) throw new Error(`Organization API inference failed: HTTP ${completion.status}`);
  } finally {
    const revoked = await fetch(`${url}/api/organization/api-keys/${disposable.key.id}`, { method: 'DELETE', headers: { ...headers, Origin: publicOrigin } });
    if (revoked.status !== 204) throw new Error('Disposable API key cleanup failed');
  }
  const revokedAccess = await fetch(`${url}/api/agents/v1/models`, { headers: apiHeaders });
  if (revokedAccess.status !== 401) throw new Error('Organization API key revocation failed');
  await fetch(`${url}/hermes-workspace/_session`, { method: 'DELETE', headers: { ...headers, Cookie: cookie, Origin: publicOrigin } });
  console.log(JSON.stringify({ administratorManagement: true, hermesDashboard: true, profileCatalog: true, modelCatalog: true, organizationApiKeys: true, externalInference: true, keyRevocation: true }));
}
check().catch((error) => { console.error(error.message); process.exitCode = 1; });
