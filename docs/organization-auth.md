# Organization identity and authorization

The pilot uses one Keycloak realm and one LibreChat/Hermes application stack for
the Open Harness organization. A separate organization must receive its own realm,
application configuration and isolated application data/runtime. This release does
not provision additional customer stacks or make the existing Hermes home multi-tenant.

## Login and migration

Keycloak serves OIDC to LibreChat. Registration is closed. Existing local operator
login remains as a recovery path, restricted by `organization.bootstrapUserIds`.
Other local accounts cannot pass the organization authorization gate.

The existing owner opens **Organization** in LibreChat, selects **Connect your
Keycloak account**, and supplies a new password. The backend links the authenticated
LibreChat account to the new Keycloak subject and exact issuer. Chats stay attached
to the original LibreChat account. No arbitrary email account linking is performed.
Once linked, the account uses live Keycloak authorization, including when its old
LibreChat session is used. Remove the bootstrap ID from host configuration after
verifying the SSO login if no local recovery enrollment is desired.

## Roles

* Owner: member roles, SSO configuration, Hermes administration and chat.
* Admin: create and enable/disable Users, Hermes administration and chat.
* User: chat and their own account security; no Hermes dashboard or member management.

Role changes and account enablement are read from Keycloak on authenticated requests.
Tokens and roles submitted by the browser are not trusted. The private executor and
Hermes WebSocket admission also recheck membership. Existing streams already admitted
are not force-terminated on a later role change. Existing Owners cannot be demoted
or disabled through this pilot UI; use the platform operator for ownership recovery.

## Members and SSO

Add members with a temporary password of at least 12 characters; members must change
it on first login. Deliver that password through a secure channel. SMTP invitations
are not configured. Federated accounts without an `org-*` realm role remain pending;
the Owner assigns access in the Members list after first federated login.

The SSO form provides labeled fields for the client, issuer, endpoints and signing
material. The following shows the corresponding backend provider configuration for OIDC:

```json
{
  "clientId": "customer-client",
  "clientSecret": "enter-in-the-form-only",
  "authorizationUrl": "https://idp.example/authorize",
  "tokenUrl": "https://idp.example/token",
  "userInfoUrl": "https://idp.example/userinfo",
  "jwksUrl": "https://idp.example/jwks",
  "issuer": "https://idp.example",
  "validateSignature": "true",
  "useJwksUrl": "true",
  "defaultScope": "openid profile email"
}
```

For SAML, supply `singleSignOnServiceUrl`, `idpEntityId`, `signingCertificate`,
`validateSignature: "true"`, and `wantAssertionsSigned: "true"`. The broker callback is
`https://auth.16-52-156-144.sslip.io/realms/open-harness/broker/<alias>/endpoint`.
Provider secrets are write-only in our API. The whole organization frontend and API
are excluded from RUM replay/body capture. Keycloak's own admin console is blocked
at the public proxy; use a restricted operator tunnel for platform administration.

The management client includes the built-in `kc-admin-api` scope required by
Keycloak 26.8. `configure-keycloak.py` applies it to an already imported pilot realm.

## Deployment and backup

`deployment/setup-keycloak.py` runs on EC2 after `compose.keycloak.yaml` is copied
there. It generates credentials on the host, creates a PostgreSQL-backed Keycloak,
imports the realm once and configures HTTPS routing. Secrets are never committed.
Use regular PostgreSQL dumps in addition to the existing LibreChat Mongo backups.
Preserve the `.env` file and Keycloak database when redeploying. Restarting an import
does not overwrite an existing realm. The application release generator enables
organization auth only when `KEYCLOAK_ORIGIN` exists in the host environment.
