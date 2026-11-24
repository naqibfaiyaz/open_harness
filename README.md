# Open Harness: LibreChat + Hermes

This pilot adds a **Hermes workspace inside LibreChat**. Hermes owns profiles/agents, providers,
models, skills, tools, MCP connections and execution. LibreChat provides login, conversation UI
and history. Hermes's existing dashboard is embedded behind LibreChat authentication, retaining
its full management controls and plugin pages rather than duplicating them.

The source is in `src/LibreChat/packages/api/src/hermes` and
`src/LibreChat/client/src/components/Hermes`. Hermes itself is unmodified. See
[architecture](docs/architecture.md), [operations](docs/operations.md), and the
[capability inventory](docs/hermes-capabilities.json).

## Pilot scope

- A shared, trusted team workspace. Administrators and explicit `allowedUserIds` can manage it.
- Ordinary users can chat with its agents. Chat sessions are namespaced by LibreChat user and
  conversation; agent configuration, profile memory, files and execution environment are shared.
- Management lives under **Hermes workspace** in LibreChat's sidebar. Native LibreChat agent,
  skill, MCP, memory and schedule managers are disabled in the integrated configuration.
- Model selection includes `Agent: <profile>` and `Model: <Hermes model route>`. Selecting an
  agent follows that Hermes profile's configured model and capabilities.
- No per-user Hermes accounts, private tenants, private execution sandboxes, or automatic
  conversion of existing native LibreChat agent/skill records are implemented.
- Hermes tool traces, interactive approvals and richer execution controls are available in the
  embedded workspace. Main LibreChat chat streams the OpenAI-compatible response; it does not
  translate every Hermes event into a native LibreChat tool card.

## Start with Docker

From this directory, prepare a local configuration:

```powershell
node tools/prepare-integration.cjs --origin http://localhost:3080
docker compose --env-file deployment/.env -f deployment/compose.yaml -f deployment/compose.integration.yaml build librechat
docker compose --env-file deployment/.env -f deployment/compose.yaml -f deployment/compose.integration.yaml up -d
```

The preparation command creates a private `deployment/.env` if needed and preserves existing
keys when rerun. It generates `deployment/integration.librechat.yaml`. Secrets are not printed.
For additional trusted operators, pass `--operators user-id-1,user-id-2` using LibreChat user IDs.
The host needs a working Docker daemon and sufficient memory for the LibreChat image build.

Open `http://localhost:3080`, sign into LibreChat, and use an administrator account or an
allowlisted operator to open **Hermes workspace**. Configure provider credentials in its
**Models and providers** / **Credentials** pages. The Hermes dashboard service account is
configured from the private deployment environment; users do not enter that password again.

For an HTTPS host, run preparation with the actual origin and add `compose.https.yaml`:

```powershell
node tools/prepare-integration.cjs --origin https://chat.example.com
docker compose --env-file deployment/.env -f deployment/compose.yaml -f deployment/compose.integration.yaml -f deployment/compose.https.yaml up -d --build
```

DNS must resolve to the host and ports 80/443 must be reachable. This optional Caddy configuration
exposes LibreChat, including the authenticated embedded workspace. It does not expose a separate
public Hermes dashboard or the Hermes runtime API.

## Configure an agent

1. Open **Hermes workspace → Agents and profiles**; create or clone a profile.
2. Configure its model/provider, instructions, skills, tools, MCP servers and memory in Hermes.
   For terminal/code execution, select the intended terminal backend and the `api_server` tool
   platform. Dependencies, external API credentials and hardware requirements still apply.
3. Click **Enable agent in LibreChat**. The integration installs a distinct profile gateway key
   and checks that profile's runtime endpoint. It never reads provider secrets back.
4. If the result says a gateway reload is required, enable the profile's API server and reload
   the gateway using Hermes's System controls. This can interrupt active runs. Retry enabling.
5. Refresh LibreChat's model list and start a new chat with `Agent: <profile>`.

Changes to skills/tools/settings apply to new sessions. Existing sessions retain Hermes's
normal prompt/tool snapshot behavior. Use **Models and providers** to choose a new model for a
profile; the `Agent:` entry keeps following the profile without editing `librechat.yaml`.

## Development checks

On a normal Linux/macOS development checkout, install LibreChat's workspaces with `npm ci` in
`src/LibreChat`, then build packages in the upstream dependency order. On Windows hosts that
forbid symlinks, `tools/install-windows-dependencies.cjs` provides a local validation fallback;
`tools/copy-workspace-package.cjs <package>` copies each built workspace into `node_modules`.
The fallback runs the upstream lockfile unchanged and copies local workspaces at npm's link
step; it does not alter production manifests or dependency versions.

```powershell
npm run test:integration
npm run typecheck:integration
npm run capabilities
```

Frontend tests are in `client/src/components/Hermes/HermesWorkspace.spec.tsx`; run the frontend
Jest command from `src/LibreChat/client` so its Babel aliases resolve correctly. Telemetry
privacy tests include both integration routes and the embedded workspace.

Deployment files are prepared; this repository change does not itself update the running EC2
deployment. Validation status and any remaining limitations are recorded in `docs/verification.md`.
