# Multiple organizations and platform operations

The internal LibreChat instance exposes **Platform administration** at `/platform`.
Platform Admin is separate from organization Owner/Admin/User. Customer org owners
cannot create or administer other customer organizations. A native LibreChat ADMIN
role alone does not grant platform access.

The named initial operator may use the configured recovery allowlist. When that
account connects Keycloak, it receives a dedicated `platform-admin` realm role and
must configure TOTP. Regular platform access checks both this role and enrollment
of an OTP or WebAuthn credential; Keycloak performs the sign-in challenge. Retire
the recovery allowlist after confirming the SSO/MFA flow. No platform-role grant,
impersonation, customer password reset, chat reader or file browser is exposed in
this panel. Keycloak's master console stays private for emergency operators.

## Organization boundary

Each additional organization receives its own:

* Keycloak realm, OIDC client, organization roles and management service account.
* LibreChat container, MongoDB, signing/encryption keys and uploads/data volumes.
* Hermes container, home volume, gateway key, credentials, skills, tools and memory.
* Docker networks and memory/process limits; no published database or Hermes ports.

Only the HTTPS proxy joins each private ingress network. Keycloak joins each
organization backend for identity requests. Network rules reject instance metadata,
other private networks and host input from tenant backends. EC2 already requires
IMDSv2 with hop limit one. Tenant containers receive neither a Docker socket nor
the platform control socket. They do not inherit the internal workspace's model
provider keys, RAG service, MCP credentials or files. Owners connect their own
providers and tools in their workspace.

This is container isolation on a shared EC2 host, not dedicated VM isolation. Agent
execution remains trusted within each organization; members of one organization
share that organization's execution environment. Stronger untrusted-code isolation
can use separate sandboxes/hosts without changing the organization API.

## Provisioning and lifecycle

The frontend sends authenticated requests to a TypeScript authorization facade.
That facade calls a host provisioner through a credential-protected Unix socket.
The provisioner runs serialized jobs, persists organization state in SQLite, and
records operator ID, reason, target and outcome. It uses a dedicated Keycloak
service account with `create-realm` and delegated access to its own new realms;
master bootstrap credentials are not passed into LibreChat.

Create an organization with a name, workspace identifier, owner email, temporary
password and operational reason. Creation returns immediately and the UI polls its
status. The owner must change the temporary password on first sign-in. SMTP delivery
is not configured: share that password securely. Each workspace uses its own HTTPS
hostname and sign-in realm. The same email can have different accounts and roles in
different organizations.

Suspend disables the realm and stops that organization's applications. Resume
restarts them. Retry recovers a failed provisioning job without duplicating its
identity or overwriting credentials. Upgrade moves that workspace to the currently
verified internal LibreChat image. Volumes are retained. There is no customer data
deletion endpoint. Existing Owners are protected from demotion/disable; grant a
replacement Owner and use the restricted operator recovery process if needed.

Every administrative write requires a reason. The panel can inspect member metadata,
assign organization roles and enable/disable non-owner members across organizations.
It does not return passwords, provider credentials or customer conversations.

The pilot defaults to three organizations total (the internal workspace plus two
customer workspaces), to bound the existing server's capacity. Configure
`PLATFORM_MAX_ORGANIZATIONS` before expanding capacity. Failed/suspended workspaces
still count because their state and volumes are retained. Readiness is verified at
provisioning time; comprehensive availability monitoring remains separate.

## Operations

Host code: `deployment/control/{engine,server,install}.py`.
Service: `open-harness-control.service`. Registry and organization configuration:
`/opt/open-harness-control`. Socket: `/run/open-harness/control.sock` (root:1000, 0660).
The main application receives a filtered `.librechat.env`; Keycloak bootstrap,
database and control-service identity credentials stay on the host. The readonly
socket mount is enabled only on the internal application.

Back up the registry, organization configuration, each MongoDB, each Hermes home,
and Keycloak PostgreSQL. The local audit table is append-only through the API, not
a tamper-proof external audit system. Use separate named internal operator accounts,
MFA, least-privilege roles and external audit retention for a production service.
