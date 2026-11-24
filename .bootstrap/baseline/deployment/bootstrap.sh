#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 python3 curl
systemctl enable --now docker
install -d -m 700 /opt/librechat-hermes
python3 - <<'PY'
from pathlib import Path
import secrets
p = Path('/opt/librechat-hermes')
api_key = secrets.token_hex(32)
dashboard_password = secrets.token_urlsafe(24)
env = {
 'HOST':'0.0.0.0','PORT':'3080','MONGO_URI':'mongodb://mongodb:27017/LibreChat',
 'DOMAIN_CLIENT':'http://localhost:3080','DOMAIN_SERVER':'http://localhost:3080',
 'ENDPOINTS':'custom','SEARCH':'false','ALLOW_EMAIL_LOGIN':'true',
 'ALLOW_REGISTRATION':'true','ALLOW_SOCIAL_LOGIN':'false',
 'JWT_SECRET':secrets.token_hex(32),'JWT_REFRESH_SECRET':secrets.token_hex(32),
 'CREDS_KEY':secrets.token_hex(32),'CREDS_IV':secrets.token_hex(16),
 'HERMES_API_KEY':api_key,
 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME':'pilot',
 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD':dashboard_password,
}
f=p/'.env'
if not f.exists():
 f.write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
 f.chmod(0o600)
 f=p/'dashboard-login.txt'
 f.write_text('Username: pilot\nPassword: '+dashboard_password+'\n')
 f.chmod(0o600)
PY
cat > /opt/librechat-hermes/librechat.yaml <<'YAML'
version: 1.3.19
cache: true
endpoints:
  custom:
    - name: Hermes
      apiKey: '${HERMES_API_KEY}'
      baseURL: http://hermes:8642/v1
      models:
        default: [hermes-agent]
        fetch: false
      titleConvo: false
      summarize: false
      modelDisplayLabel: Hermes
YAML
cat > /opt/librechat-hermes/compose.yaml <<'YAML'
name: librechat-hermes-pilot
services:
  librechat:
    image: registry.librechat.ai/librechat-ai/librechat@sha256:51550d041e298f0740d98743a3ffdeac9be4cf6dcb1bcd938e6db8779c420fc4
    restart: unless-stopped
    env_file: .env
    environment:
      CONFIG_PATH: /app/librechat.yaml
    ports:
      - 127.0.0.1:3080:3080
    volumes:
      - ./librechat.yaml:/app/librechat.yaml:ro
      - ./.env:/app/.env:ro
      - librechat_uploads:/app/uploads
      - librechat_logs:/app/logs
      - librechat_images:/app/client/public/images
      - librechat_data:/app/data
    depends_on:
      mongodb:
        condition: service_healthy
    networks: [app, data, agent]
  mongodb:
    image: mongo:8.0.20
    restart: unless-stopped
    command: [mongod, --noauth, --bind_ip_all]
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: [CMD, mongosh, --quiet, --eval, "db.adminCommand('ping').ok"]
      interval: 10s
      timeout: 5s
      retries: 12
    networks: [data]
  hermes:
    image: nousresearch/hermes-agent@sha256:41468459379a943cf0a25a55589e230d244bd9f95b83cff5eca789470c892fac
    restart: unless-stopped
    environment:
      API_SERVER_ENABLED: 'true'
      API_SERVER_HOST: 0.0.0.0
      API_SERVER_PORT: '8642'
      API_SERVER_KEY: '${HERMES_API_KEY}'
      HERMES_DASHBOARD: '1'
      HERMES_DASHBOARD_HOST: 0.0.0.0
      HERMES_DASHBOARD_PORT: '9119'
      HERMES_DASHBOARD_BASIC_AUTH_USERNAME: '${HERMES_DASHBOARD_BASIC_AUTH_USERNAME}'
      HERMES_DASHBOARD_BASIC_AUTH_PASSWORD: '${HERMES_DASHBOARD_BASIC_AUTH_PASSWORD}'
    command: [gateway, run]
    ports:
      - 127.0.0.1:9119:9119
      - 127.0.0.1:8642:8642
    volumes:
      - hermes_data:/opt/data
    networks: [agent]
volumes:
  mongo_data:
  librechat_uploads:
  librechat_logs:
  librechat_images:
  librechat_data:
  hermes_data:
networks:
  app: {}
  data:
    internal: true
  agent: {}
YAML
chmod 600 /opt/librechat-hermes/.env
cd /opt/librechat-hermes
docker compose config --quiet
docker compose pull
docker compose up -d
touch /opt/librechat-hermes/bootstrap-complete
