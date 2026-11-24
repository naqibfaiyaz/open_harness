Open Harness pilot

Integration update: see README.md and docs/ for the LibreChat-managed Hermes workspace.
src/LibreChat now includes integration changes; src/hermes-agent remains unmodified.
The generated private deployment environment is excluded from version control.

Deployment code: deployment/bootstrap.sh, compose.yaml, librechat.yaml
Upstream source snapshots: src/LibreChat (v0.8.9), src/hermes-agent (v0.23.3)
Upstream license notices are retained. Source snapshots exclude Git history.
Private credentials are kept in deployment/.env and excluded from version control.

Existing AWS deployment:
Region: ca-central-1
Instance: i-03a2c308345461f07
Public IP at deployment: 16.52.156.144
Public HTTPS is configured; see deployment/PublicAccess.txt for URLs and login instructions.
See deployment/Operations.txt for server commands and current setup.

bootstrap.sh describes the original deployment. Use the integration preparation tool
and compose.integration.yaml from README.md for the new integrated build.
Do not rerun bootstrap.sh against another instance unless you intend to deploy there.


Feature rollout is documented in deployment/FeatureStatus.txt. Current LibreChat configuration and compose.features.yaml are saved in deployment/.
