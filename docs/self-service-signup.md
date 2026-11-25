# Self-service organization signup

Public entry: `/signup` on the internal LibreChat hostname. Pricing, Stripe,
trials and shared model access are deliberately outside this release.

An internal Platform Admin configures **Self-service signup and email delivery**
in `/platform`: SMTP hostname, port (587 STARTTLS or 465 TLS), sender address,
username and password, then enables signup. The sender/domain must already be
approved with the selected mail provider (including AWS SES if used). Saving does
not verify delivery; validate delivery with a controlled real signup before
announcing availability. The panel never returns the SMTP password. A blank
password preserves the existing password. Disabling signup preserves settings.

Settings are stored as root-only mode 0600 JSON at
`/opt/open-harness-control/signup-mail.json`, outside all application containers.
Include this file and `control.db` in protected control-plane backups. The app
passes a narrowly scoped request to the existing protected Unix socket; it does
not receive SMTP credentials or a Docker socket. Settings writes require the
existing Platform Admin authorization, MFA policy, same Origin and audit reason.

The signup flow is:

1. Submit email; receive a single-use verification link (30 minutes by default).
2. Explicitly confirm verification. The link token is in a URL fragment, removed
   from the address bar immediately; it is never a query-string credential.
3. A Secure, HttpOnly, SameSite=Strict cookie holds a 24-hour opaque signup session.
   Only its hash and the verification-token hash are stored in the registry.
4. Enter organization name, workspace slug and password (minimum 12 characters).
   Owner email and role are bound server-side to the verified signup session.
5. The existing host provisioner creates the isolated environment. Progress is
   polled until active or failed. The signup Owner's Keycloak email is verified,
   their chosen password is permanent, and only their organization Owner role is
   granted. No platform role or model credentials are inherited.
6. Sign in at the new workspace URL using that email and password. Configure
   model providers in Hermes before inference.

Repeated create requests return the same workspace and cannot create duplicates.
Capacity is checked transactionally before allocation; the current
`PLATFORM_MAX_ORGANIZATIONS` cap still applies. Failed environments retain state
and count toward capacity; Platform Admin can retry them through the existing
panel. A worker restart marks interrupted jobs failed for operator recovery.
A verification email can be requested again to recover a session; an address with
an existing signup returns to that workspace rather than creating another one.
Additional organizations for the same owner can still be created by Platform Admin.

Signup is unavailable until SMTP and the enabled setting are configured. No
verification bypass, temporary-password email or automatic customer billing is
introduced. Verification proves email ownership, not ownership of a business or
domain. Organization environments remain containers sharing the current EC2 host.

Operational settings (host `.env`, defaults shown):

- `SIGNUP_VERIFICATION_MINUTES=30`
- `SIGNUP_SESSION_HOURS=24` (browser cookie is capped at 24 hours)
- `SIGNUP_EMAIL_HOURLY_LIMIT=3` per address
- `SIGNUP_DAILY_EMAIL_LIMIT=100` across all signup addresses

The API's anonymous mutation rate limit is configurable in `librechat.yaml` under
`platform.signup.requestLimit` (60) and `windowMs` (600000). Status polling does
not consume this mutation quota. Credential request/response bodies and signup
page replay are excluded from RUM telemetry.

Verification:

```
python3 -m unittest discover -s deployment/control -p 'test_*.py'
npm run test:integration
```

Tests cover one-time and expired links, hashed secrets, session-bound Owner
assignment, idempotent creation, capacity denial, safe mail failures, private
settings, origin checks, cookie flags and frontend outcomes. Actual outbound
email requires configuring a real sender; synthetic tests do not assert delivery.
