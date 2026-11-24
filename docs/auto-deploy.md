# GitHub to EC2 deployment

Push application or deployment changes to `main` to run `.github/workflows/deploy.yml`. Documentation-only changes are skipped. The workflow can also be run manually from GitHub Actions.

The workflow installs locked dependencies, builds shared packages, checks API and client TypeScript, runs integration and workspace/privacy tests, then builds the LibreChat image. It publishes a unique immutable tag to ECR and deploys the resulting digest through the `OpenHarness-DeployRelease` Systems Manager document. Concurrent releases are serialized.

## Resources

- AWS region: `ca-central-1`
- EC2: `i-03a2c308345461f07`
- ECR: `807467871114.dkr.ecr.ca-central-1.amazonaws.com/open-harness/librechat`
- GitHub role: `arn:aws:iam::807467871114:role/open-harness/GitHubActions-OpenHarnessDeploy`
- Site: https://chat.16-52-156-144.sslip.io/hermes

GitHub authenticates with OIDC; there are no AWS access-key secrets in the repository. The trust policy accepts only this repository's immutable owner/repository IDs and the `main` branch:

`repo:naqibfaiyaz@25023996/open_harness@1469503468:ref:refs/heads/main`

The deployment role can publish to this ECR repository and invoke the fixed deployment document on this instance. It cannot submit arbitrary SSM shell commands. The EC2 role can pull from this ECR repository. The SSM dispatcher validates the commit and digest, then fetches the committed rollout script from this repository.

## Server state and rollback

Runtime secrets stay in `/opt/librechat-hermes/.env`. The rollout preserves existing keys, provider credentials and data volumes. It backs up configuration and MongoDB before replacing LibreChat, generates the integrated configuration, then starts the new image and verifies authenticated administrator access to the Hermes dashboard, profiles and model catalog. These checks do not consume inference tokens.

Failed application verification restores the prior configuration and image. Database backups are retained for manual recovery; automated rollback does not overwrite MongoDB. Successful releases are recorded in `/opt/librechat-hermes/deployment-history.json`. The server retains its three most recent recorded image digests; ECR retains twenty release tags. Backups require periodic retention review as data grows.

To redeploy an earlier version, revert the relevant commit on `main`; GitHub will build and verify a fresh release. Inspect failed runs and the SSM command output before retrying a timed-out deployment.

Hermes remains on the existing pinned upstream image. This pipeline deploys the LibreChat integration and Hermes configuration; it does not automatically upgrade upstream Hermes or migrate the database. Provider configuration, skills and tools remain in the Hermes data volume and are managed through the integrated workspace.

The pilot uses a shared trusted Hermes workspace. Chat identity is propagated from LibreChat, but profiles, credentials, tools, memory and files are not isolated into independent user tenants. Only administrators or explicitly allowed operators can open management.
