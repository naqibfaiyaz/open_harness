# Verification — 2026-11-23 (America/Toronto)

The integration was built locally in `D:\open_harness`. The existing AWS deployment has not
been updated with these changes.

| Check | Result |
| --- | --- |
| Full LibreChat package and production frontend builds | Passed |
| Full `packages/api` TypeScript check | Passed |
| Full frontend TypeScript check | Passed |
| Focused integration TypeScript check | Passed |
| HTTP/WebSocket integration tests | 17 passed |
| Hermes workspace frontend tests | 7 passed |
| Telemetry privacy tests | 115 passed |
| ESLint on modified integration and wiring files | Passed |
| Scoped import sorting / Prettier | Passed |
| Docker Compose configuration validation | Passed |
| Generated LibreChat configuration schema | Passed |
| Lighthouse | Attempted; blocked by `CHROME_CONNECTION_FAILED` before metrics |

The Lighthouse harness successfully started a disposable MongoDB, launched the real LibreChat
server, registered/logged in its fixture user and loaded its scenario. Its separate Lighthouse
Chrome connection failed in this Windows environment; no performance-budget pass is claimed.
The initial missing OpenSSL issue was resolved using Git's native `mingw64/bin/openssl.exe`.

Integration tests run against a local fake Hermes server with real HTTP and WebSocket
connections. They verify authorization, private credential handling, service-key checks,
profile routing, user/conversation session separation, streaming/cancellation, expired-login
recovery, file ranges, binary uploads, lossless JSON/form proxying, and rejection of the native
LibreChat execution path. They do not claim a live-provider inference test.

The local Docker daemon was unavailable, so the production compose stack was not started here.
The image source and compose configuration are prepared. No AWS resources, running containers
on EC2, or inference-provider credentials were changed during this integration work.

The current identity model is a shared trusted workspace. Private per-user Hermes profiles,
tenant storage and execution isolation remain outside this pilot. See `architecture.md`.

## Source provenance and history

- LibreChat v0.8.9 source baseline: `d4e85d2205c78413ee27d631d7e3b7313556f21d`.
- Hermes v0.23.3 source baseline: `caafe5389ae585ef77387a962aee05b1bcf17029`.
- Original upstream license notices are retained under each source directory.
- The baseline and integration are recorded separately so future changes can be reviewed
  against the original sources and deployment. Full upstream ancestry remains available in
  the upstream repositories; this project vendors pinned snapshots.

Private `.env` files, provider credentials, dependency directories, build artifacts, downloaded
MongoDB binaries, browser authentication state and generated test reports are excluded from
the published source. The GitHub one-time import workflow performs repository publication,
not AWS deployment.
