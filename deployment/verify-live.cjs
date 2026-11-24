const { createRequire } = require('node:module');
const requireApp = createRequire('/app/package.json');
const jwt = requireApp('jsonwebtoken');
const [adminId, publicOrigin] = process.argv.slice(2);
async function check() {
  if (!adminId || !publicOrigin) throw new Error('Smoke test requires an existing administrator and origin');
  const token = jwt.sign({ id: adminId, issuedAtMs: Date.now() }, process.env.JWT_SECRET, { expiresIn: '2m' });
  const headers = { Authorization: `Bearer ${token}` };
  const url = 'http://127.0.0.1:3080';
  const status = await fetch(`${url}/api/hermes/status`, { headers }).then(async (r) => {
    if (!r.ok) throw new Error(`Workspace status failed: HTTP ${r.status}`);
    return r.json();
  });
  if (!status.enabled || !status.canManage || !status.managedOnly) throw new Error('Hermes management is not enabled for the administrator');
  const session = await fetch(`${url}/hermes-workspace/_session`, { method: 'POST', headers: { ...headers, Origin: publicOrigin } });
  if (!session.ok) throw new Error(`Workspace sign-in failed: HTTP ${session.status}`);
  const cookie = session.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith('lc_hermes_workspace='));
  if (!cookie) throw new Error('Workspace grant cookie missing');
  const page = await fetch(`${url}/hermes-workspace/profiles?profile=default`, { headers: { Cookie: cookie } });
  if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('Hermes management page did not load');
  if (!(await page.text()).includes('__HERMES_BASE_PATH__')) throw new Error('Hermes dashboard bootstrap missing');
  const profiles = await fetch(`${url}/api/hermes/profiles`, { headers }).then((r) => r.json());
  if (!profiles.profiles?.some((p) => p.name === 'default')) throw new Error('Hermes profile catalog unavailable');
  const models = await fetch(`${url}/api/hermes/runtime/v1/models`, {
    headers: { Authorization: `Bearer ${process.env.HERMES_BRIDGE_KEY}` },
  }).then((r) => r.json());
  if (!models.data?.some((m) => m.id === 'Agent: default')) throw new Error('Hermes model catalog unavailable');
  await fetch(`${url}/hermes-workspace/_session`, { method: 'DELETE', headers: { ...headers, Cookie: cookie, Origin: publicOrigin } });
  console.log(JSON.stringify({ administratorManagement: true, hermesDashboard: true, profileCatalog: true, modelCatalog: true }));
}
check().catch((error) => { console.error(error.message); process.exitCode = 1; });
