#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
commit=${1:?Missing commit SHA}
digest=${2:?Missing image digest}
[[ "$commit" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid image digest' >&2; exit 2; }
ROOT=/opt/librechat-hermes
REGISTRY=807467871114.dkr.ecr.ca-central-1.amazonaws.com
REPOSITORY=open-harness/librechat
IMAGE="$REGISTRY/$REPOSITORY@$digest"
ORIGIN=${OPEN_HARNESS_PUBLIC_ORIGIN:-https://chat.16-52-156-144.sslip.io}
test -f "$ROOT/.env"
exec 9>"$ROOT/.deploy.lock"
flock -w 600 9
release="$ROOT/releases/$commit"
backup="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)-$commit"
mkdir -p "$release/tools" "$release/deployment" "$backup"
chmod 700 "$ROOT/releases" "$ROOT/backups" "$release" "$backup"
export DOCKER_CONFIG="$release/.docker"
mkdir -p "$DOCKER_CONFIG"
changed=0
base=(docker compose --project-directory "$ROOT" -f "$ROOT/compose.yaml")
for file in compose.override.yaml compose.features.yaml; do
  if test -f "$ROOT/$file"; then base+=(-f "$ROOT/$file"); fi
done
old=("${base[@]}")
if test -f "$ROOT/compose.autodeploy.yaml"; then old+=(-f "$ROOT/compose.autodeploy.yaml"); fi
current=("${base[@]}" -f "$ROOT/compose.autodeploy.yaml")
aws_cli() {
  if command -v aws >/dev/null; then aws "$@";
  else docker run --rm --network host public.ecr.aws/aws-cli/aws-cli@sha256:6c24ad4e8cdf12defd41c7e6d2ed836e73da9cbfecc1e9d7fd148bb9f4ea5eb2 "$@"; fi
}
rollback() {
  code=$?
  trap - ERR
  if (( changed )); then
    echo 'Verification failed; restoring the previous deployment.' >&2
    cp "$backup/.env" "$ROOT/.env"
    for file in integration.librechat.yaml compose.autodeploy.yaml; do
      if test -f "$backup/$file"; then cp "$backup/$file" "$ROOT/$file"; fi
    done
    "${old[@]}" up -d --no-deps --no-build --pull never librechat hermes >/dev/null || true
  fi
  exit "$code"
}
trap rollback ERR
trap 'rm -f "$DOCKER_CONFIG/config.json"' EXIT
echo "Preparing release $commit"
for file in tools/prepare-integration.cjs deployment/verify-live.cjs; do
  curl --fail --silent --show-error --retry 3 "https://raw.githubusercontent.com/naqibfaiyaz/open_harness/$commit/$file" -o "$release/$file"
done
aws_cli ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
docker pull "$IMAGE" >/dev/null
actual=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")
test "$actual" = "$commit"
cp "$ROOT/.env" "$backup/.env"
cp "$ROOT/librechat.yaml" "$backup/librechat.yaml"
for file in integration.librechat.yaml compose.autodeploy.yaml; do
  if test -f "$ROOT/$file"; then cp "$ROOT/$file" "$backup/$file"; fi
done
"${old[@]}" exec -T mongodb mongodump --archive --gzip --db LibreChat >"$backup/mongodb.archive.gz" 2>"$backup/mongodb.log"
cp "$ROOT/.env" "$release/deployment/.env"
cp "$ROOT/librechat.yaml" "$release/deployment/librechat.yaml"
docker run --rm --user 0 --entrypoint node -v "$release:/release" "$IMAGE" /release/tools/prepare-integration.cjs --origin "$ORIGIN"
python3 - "$ROOT" "$release" "$IMAGE" "$commit" <<'PY'
import json, pathlib, sys
root, release = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
image, commit = sys.argv[3:5]
files = ['compose.yaml'] + [n for n in ['compose.override.yaml','compose.features.yaml'] if (root/n).exists()] + ['compose.autodeploy.yaml']
envfile = release/'deployment/.env'
lines = [s for s in envfile.read_text().splitlines() if not s.startswith('COMPOSE_FILE=')]
envfile.write_text('\n'.join(lines + ['COMPOSE_FILE=' + ':'.join(files)]) + '\n')
config = {'services': {'librechat': {'image': image, 'labels': {'io.open-harness.commit': commit}, 'environment': {
  'HERMES_BRIDGE_KEY': '${HERMES_BRIDGE_KEY}', 'HERMES_API_KEY': '${HERMES_API_KEY}',
  'HERMES_DASHBOARD_USERNAME': '${HERMES_DASHBOARD_BASIC_AUTH_USERNAME}',
  'HERMES_DASHBOARD_PASSWORD': '${HERMES_DASHBOARD_BASIC_AUTH_PASSWORD}', 'HERMES_DASHBOARD_PROVIDER': 'basic'},
  'volumes': ['./integration.librechat.yaml:/app/librechat.yaml:ro']},
  'hermes': {'environment': {'GATEWAY_MULTIPLEX_PROFILES':'true','API_SERVER_ENABLED':'true',
  'HERMES_DASHBOARD_PUBLIC_URL': '${DOMAIN_CLIENT}/hermes-workspace'}}}}
(release/'compose.autodeploy.yaml').write_text(json.dumps(config, indent=2) + '\n')
PY
changed=1
cp "$release/deployment/.env" "$ROOT/.env"
cp "$release/deployment/integration.librechat.yaml" "$ROOT/integration.librechat.yaml"
cp "$release/compose.autodeploy.yaml" "$ROOT/compose.autodeploy.yaml"
"${current[@]}" config --quiet
"${current[@]}" up -d --no-deps --no-build --pull never librechat hermes >/dev/null
ready=0
for attempt in $(seq 1 80); do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3080/readyz >/dev/null; then ready=1; break; fi
  sleep 3
done
test "$ready" = 1
admin=$("${current[@]}" exec -T mongodb mongosh --quiet LibreChat --eval 'const u=db.users.findOne({role:"ADMIN"});if(u)print(u._id.toString())')
[[ "$admin" =~ ^[a-f0-9]{24}$ ]]
container=$("${current[@]}" ps -q librechat)
docker cp "$release/deployment/verify-live.cjs" "$container:/tmp/open-harness-verify.cjs"
docker exec --user 0 "$container" node /tmp/open-harness-verify.cjs "$admin" "$ORIGIN"
curl --fail --silent --max-time 15 "$ORIGIN/health" >/dev/null
python3 - "$ROOT" "$commit" "$IMAGE" <<'PY'
import datetime, json, pathlib, sys
p = pathlib.Path(sys.argv[1])/'deployment-history.json'
rows = json.loads(p.read_text()) if p.exists() else []
rows.append({'commit':sys.argv[2],'image':sys.argv[3],'deployedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
p.write_text(json.dumps(rows[-20:], indent=2) + '\n')
keep = {r['image'] for r in rows[-3:]}
stale = sorted({r['image'] for r in rows[:-3]} - keep)
(p.parent/'retired-images.txt').write_text('\n'.join(stale) + ('\n' if stale else ''))
PY
while IFS= read -r retired; do
  if [[ "$retired" == "$REGISTRY/$REPOSITORY@sha256:"* ]]; then docker image rm "$retired" >/dev/null 2>&1 || true; fi
done <"$ROOT/retired-images.txt"
echo "Deployment verified: $commit"
