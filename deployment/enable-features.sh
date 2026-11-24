#!/usr/bin/env bash
set -euo pipefail
cd /opt/librechat-hermes
backup="backups/features-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 700 "$backup"
cp -p .env librechat.yaml compose.yaml compose.override.yaml "$backup/"
python3 - <<'PY'
from pathlib import Path
import json,secrets,subprocess,urllib.request
p=Path('/opt/librechat-hermes')
helper='''import sys,json
sys.path.insert(0,"/opt/hermes")
import hermes_yaml as yaml
from pathlib import Path
from hermes_cli.runtime_provider import load_pool,choose_pool_key
c=yaml.safe_load(Path("/opt/data/config.yaml").read_text())
picked=choose_pool_key(load_pool("openrouter"),"openrouter",endpoint_url="https://openrouter.ai/api/v1",mode="choose")
if picked is None: raise SystemExit("No OpenRouter credential available")
print(json.dumps({"api_key":picked.api_key,"model":c.get("model",{}).get("default")}))
'''
raw=subprocess.check_output(['docker','compose','exec','-T','--user','hermes','hermes','/opt/hermes/.venv/bin/python','-'],input=helper,text=True)
provider=json.loads(raw)
env=dict(l.split('=',1) for l in (p/'.env').read_text().splitlines() if l and not l.startswith('#') and '=' in l)
env.update({'ENDPOINTS':'custom,agents','OPENROUTER_API_KEY':provider['api_key'],
 'RAG_API_URL':'http://rag_api:8000','RAG_PORT':'8000','RAG_OPENAI_BASEURL':'https://openrouter.ai/api/v1',
 'RAG_OPENAI_API_KEY':provider['api_key'],'EMBEDDINGS_PROVIDER':'openai','EMBEDDINGS_MODEL':'openai/text-embedding-3-small',
 'POSTGRES_DB':'librechat_rag','POSTGRES_USER':'librechat','DB_HOST':'vectordb','DB_PORT':'5432',
 'SEARCH':'true','MEILI_HOST':'http://meilisearch:7700','USE_REDIS':'true','USE_REDIS_STREAMS':'true',
 'REDIS_URI':'redis://redis:6379','SCHEDULES_SINGLE_PROCESS':'true'})
env.setdefault('POSTGRES_PASSWORD',secrets.token_hex(32))
env.setdefault('MEILI_MASTER_KEY',secrets.token_hex(32))
req=urllib.request.Request('https://openrouter.ai/api/v1/embeddings',data=json.dumps({'model':env['EMBEDDINGS_MODEL'],'input':['pilot feature readiness check']}).encode(),headers={'Authorization':'Bearer '+provider['api_key'],'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=45) as response:
 result=json.load(response)
 print(json.dumps({'embeddings_status':response.status,'dimensions':len(result['data'][0]['embedding'])}))
(p/'.env').write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
(p/'.env').chmod(0o600)
sharing={'use':True,'create':True,'share':True,'public':False}
cfg={
 'version':'1.3.19','cache':True,
 'modelSpecs':{'enforce':False,'prioritize':False,'list':[{'name':'hermes-default','label':'Hermes','showInMenu':False,'preset':{'endpoint':'Hermes','model':'hermes-agent'}}],'addedEndpoints':['Hermes','agents']},
 'interface':{'modelSelect':True,'parameters':True,'presets':True,'bookmarks':True,'multiConvo':True,
  'prompts':sharing,'agents':sharing,'skills':sharing,'remoteAgents':sharing,
  'mcpServers':sharing,'marketplace':{'use':True},'fileSearch':True,'fileCitations':True,
  'webSearch':True,'runCode':False,'contextUsage':True,'contextCost':True,'artifactUndocking':True,
  'feedback':True,'schedules':{'use':True,'create':True,'maxPerUser':10,'minIntervalMinutes':60,'autoDisableAfterFailures':5}},
 'endpoints':{
  'agents':{'disableBuilder':False,'recursionLimit':25,'maxRecursionLimit':50,
   'capabilities':['deferred_tools','file_search','web_search','artifacts','subagents','actions','context','skills','memory','ask_user_question','tools','ocr','run_in_background','tool_intents']},
  'custom':[
   {'name':'Hermes','apiKey':'${HERMES_API_KEY}','baseURL':'http://hermes:8642/v1','models':{'default':['hermes-agent'],'fetch':False},'titleConvo':False,'summarize':False,'modelDisplayLabel':'Hermes'},
   {'name':'OpenRouter','apiKey':'${OPENROUTER_API_KEY}','baseURL':'https://openrouter.ai/api/v1','models':{'default':[provider['model']],'fetch':True},'titleConvo':True,'titleModel':provider['model'],'modelDisplayLabel':'OpenRouter'}]},
 'memory':{'disabled':False,'personalize':True,'tokenLimit':3000,'maxInputTokens':8000,
  'agent':{'enabled':True,'provider':'OpenRouter','model':provider['model']}},
 'webSearch':{'searchProvider':'keenable','scraperProvider':'keenable','rerankerType':'none'},
 'mcpServers':{
  'workspace':{'type':'stdio','command':'npx','args':['--yes','@modelcontextprotocol/server-filesystem@2.4.0','/app/agent-workspace'],'timeout':60000},
  'knowledge-memory':{'type':'stdio','command':'npx','args':['--yes','@modelcontextprotocol/server-memory@2.2.1'],'env':{'MEMORY_FILE_PATH':'/app/agent-workspace/mcp-memory.jsonl'},'timeout':60000}}
}
(p/'librechat.yaml').write_text(json.dumps(cfg,indent=2)+'\n')
features={
 'services':{
  'librechat':{'volumes':['agent_workspace:/app/agent-workspace','mcp_cache:/home/node/.npm'],
   'depends_on':{'rag_api':{'condition':'service_started'},'redis':{'condition':'service_started'},'meilisearch':{'condition':'service_started'}}},
  'vectordb':{'image':'pgvector/pgvector:0.8.0-pg15-trixie','restart':'unless-stopped',
   'environment':{'POSTGRES_DB':'${POSTGRES_DB}','POSTGRES_USER':'${POSTGRES_USER}','POSTGRES_PASSWORD':'${POSTGRES_PASSWORD}'},
   'volumes':['pgvector_data:/var/lib/postgresql/data'],'networks':['data'],
   'healthcheck':{'test':['CMD-SHELL','pg_isready -U librechat -d librechat_rag'],'interval':'10s','timeout':'5s','retries':12}},
  'rag_api':{'image':'registry.librechat.ai/librechat-ai/librechat-rag-api-dev-lite@sha256:4a9ddf164da1858cb06d6cf796b050f680ac6d96b5f0c49cd7a13b8b61140939',
   'restart':'unless-stopped','environment':{k:'${'+k+'}' for k in ['JWT_SECRET','RAG_OPENAI_BASEURL','RAG_OPENAI_API_KEY','EMBEDDINGS_PROVIDER','EMBEDDINGS_MODEL','POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD','DB_HOST','DB_PORT','RAG_PORT']},'depends_on':{'vectordb':{'condition':'service_healthy'}},'networks':['app','data']},
  'redis':{'image':'redis:7.4-alpine','restart':'unless-stopped','command':['redis-server','--appendonly','yes'],
   'volumes':['redis_data:/data'],'networks':['data']},
  'meilisearch':{'image':'getmeili/meilisearch:v1.35.1','restart':'unless-stopped',
   'environment':{'MEILI_MASTER_KEY':'${MEILI_MASTER_KEY}','MEILI_NO_ANALYTICS':'true'},
   'volumes':['meili_data:/meili_data'],'networks':['data']}
 },'volumes':{k:{} for k in ['agent_workspace','mcp_cache','pgvector_data','redis_data','meili_data']}}
(p/'compose.features.yaml').write_text(json.dumps(features,indent=2)+'\n')
env['COMPOSE_FILE']='compose.yaml:compose.override.yaml:compose.features.yaml'
(p/'.env').write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
PY
docker compose exec -T --user hermes hermes hermes tools enable video kanban clarify --platform api_server
docker compose exec -T --user hermes hermes hermes tools enable video kanban --platform cli
docker compose exec -T --user hermes hermes hermes config set model.provider openrouter
docker compose exec -T --user hermes hermes hermes config set image_gen.provider openrouter
docker compose exec -T --user hermes hermes hermes config set tts.provider edge
docker compose exec -T --user hermes hermes hermes tools disable tts --platform api_server
docker compose exec -T --user hermes hermes hermes tools disable tts --platform cli
docker compose config --quiet
docker compose pull rag_api vectordb redis meilisearch
docker compose up -d
docker compose restart hermes
docker compose exec -T mongodb mongosh --quiet LibreChat --eval 'db.roles.updateOne({name:"USER"},{$set:{"permissions.MCP_SERVERS.CREATE":true,"permissions.MCP_SERVERS.SHARE":true,"permissions.AGENTS.SHARE":true,"permissions.PROMPTS.SHARE":true,"permissions.SKILLS.SHARE":true,"permissions.MARKETPLACE.USE":true,"permissions.REMOTE_AGENTS.USE":true,"permissions.REMOTE_AGENTS.CREATE":true}}); print("User feature permissions updated")'
docker compose exec -T --user node librechat sh -c 'mkdir -p /app/agent-workspace && npx --yes --package @modelcontextprotocol/server-filesystem@2.4.0 --package @modelcontextprotocol/server-memory@2.2.1 -c "echo MCP_packages_ready"'
docker compose ps --format '{{.Service}} {{.Status}}'
