# Organization API access

Owners and Admins can open **Organization → External API access**, name an integration,
select its permitted agent/model aliases and expiration, and create a key. Copy the
secret immediately: it is displayed once and only its SHA-256 digest is persisted.
Create a separate key per frontend. To rotate, create a replacement, update the frontend,
then revoke the old key. Expired/revoked secrets cannot be recovered or re-enabled.

Configure an OpenAI-compatible frontend with:

```
Base URL: https://<organization-chat-host>/api/agents/v1
API key: <the organization key>
Model: Agent: default
```

Supported endpoints are `GET /models` and `POST /chat/completions`, including SSE
streaming. Model discovery returns only aliases permitted by that key. `Agent: ...`
selects a published workspace profile; `Model: ...` selects a published model through
the existing Hermes execution path. Model aliases must exist in the workspace catalog.
Agent tools and skills execute server-side according to that profile's configuration.
Client-supplied tools/functions are not supported. Responses API, embeddings, files,
images and assistants endpoints are not exposed by this compatibility layer.

Example using an environment variable populated outside shell history:

```javascript
const response = await fetch(`${process.env.AGENT_API_BASE_URL}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.AGENT_API_KEY}`,
    'Content-Type': 'application/json',
    'X-Conversation-Id': 'frontend-conversation-123',
  },
  body: JSON.stringify({
    model: 'Agent: default',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: false,
  }),
});
if (!response.ok) throw new Error(`Agent API HTTP ${response.status}`);
console.log((await response.json()).choices[0].message.content);
```

`X-Conversation-Id` is optional (1–128 letters, digits, underscores, dots or hyphens).
Supply a stable, unique label per external conversation when retaining a Hermes session.
The server namespaces it by organization and key, and echoes it in the response.
Without it, each request receives a fresh conversation ID. Send the full message history
on each request. External conversations are not automatically saved as LibreChat chats
or added to its artifact gallery; the frontend owns its transcript.

## Authorization and isolation

Every key is bound to one configured organization issuer and its creating account.
Owner/Admin authorization is checked live on every request. Disabling/deleting the
account or removing its management role disables its keys. Organization administrators
can list metadata and revoke keys belonging to other administrators in the same org.
The API ignores caller-provided organization/user identity headers and generates trusted
internal identity and session headers. OpenAI's `user` field does not authenticate a
different end user. This is an integration credential acting as its creator, not
per-user delegated login. Keep it in the frontend's backend, never a public JavaScript bundle.

The private `/api/hermes/runtime/v1` bridge remains private and still requires its
internal service credential. Organization keys work only on `/api/agents/v1`.
The external API cannot manage workspace configuration or mint further keys.

## Configuration and limits

`hermes.publicApi` in `librechat.yaml` controls access. It defaults to disabled upstream;
`tools/prepare-integration.cjs` enables it for this deployment and new provisioned orgs.

```yaml
hermes:
  publicApi:
    enabled: true
    maxKeys: 100
    defaultExpiryDays: 90
    maxExpiryDays: 365
    requestsPerMinute: 60
    authRequestsPerMinute: 300
    maxConcurrent: 2
    maxOrgConcurrent: 4
    recheckMs: 15000
    allowedOrigins: []
```

`maxKeys` limits unexpired, unrevoked keys. Request limits are per key and pre-authentication
per client IP. Concurrency limits apply to external completions per key and per organization.
Browser-origin requests require an exact origin in `allowedOrigins`; backend clients do
not need CORS. Key management writes require the organization's own frontend origin.
Restrict aliases for least privilege; selecting all models includes future published aliases.
Defaults permit 90-day keys, with a 365-day maximum. Secrets and key routes are excluded
from frontend telemetry request bodies, and responses carry `Cache-Control: no-store`.

Limits, management serialization and active-stream tracking are process-local in this
single-process pilot. Before horizontal scaling, use a shared limiter, an atomic key quota,
and distributed cancellation. Local revocation closes tracked streams immediately; other
processes, expiry and creator authorization changes are checked at `recheckMs` intervals.
Closing the stream aborts the existing Hermes upstream request where supported; it cannot
undo a tool's completed side effects. Retired key metadata is retained; listing shows all
permitted active keys and the most recent 100 retired keys. Billing/metering is a later feature.

## Verification

HTTP integration tests cover hashing, tenant scoping, identity spoofing, allowed models,
expiry, revocation, streaming cancellation, Origin validation and throttling. Database
tests verify persisted issuer boundaries and metadata projection; React tests exercise
the one-time secret view. Deployment verification creates a one-day disposable key,
checks the scoped catalog and a real completion, revokes it in `finally`, and verifies
that subsequent access returns 401. The smoke test never logs the raw secret.
