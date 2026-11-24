#!/usr/bin/env bash
set -euo pipefail
cd /opt/librechat-hermes
proxy_image='caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83'
docker pull "$proxy_image"
python3 - <<'PY'
from pathlib import Path
p=Path('/opt/librechat-hermes')
env=dict(line.split('=',1) for line in (p/'.env').read_text().splitlines() if line and not line.startswith('#') and '=' in line)
caddy='''{
    admin off
}
chat.16-52-156-144.sslip.io {
    reverse_proxy librechat:3080
}
hermes.16-52-156-144.sslip.io {
    reverse_proxy hermes:9119
}
'''
(p/'Caddyfile').write_text(caddy)
(p/'Caddyfile').chmod(0o600)
env['DOMAIN_CLIENT']='https://chat.16-52-156-144.sslip.io'
env['DOMAIN_SERVER']=env['DOMAIN_CLIENT']
(p/'.env').write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
(p/'.env').chmod(0o600)
PY
cat > compose.override.yaml <<'YAML'
services:
  caddy:
    image: caddy@sha256:d8c17a862962def15cde69863a3a463f25a2664942eafd7bdbf050e9c3116b83
    restart: unless-stopped
    ports:
      - 80:80
      - 443:443
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks: [app, agent]
    depends_on: [librechat, hermes]
volumes:
  caddy_data:
  caddy_config:
YAML
docker compose config --quiet
docker compose up -d
docker compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile
