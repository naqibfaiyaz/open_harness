const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argument = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const publicURL = new URL(argument('--origin', 'http://localhost:3080'));
if (!['http:', 'https:'].includes(publicURL.protocol) || publicURL.username || publicURL.password ||
    publicURL.pathname !== '/' || publicURL.search || publicURL.hash) throw new Error('Origin must have no path, credentials or query');
const directory = path.join(root, 'deployment');
const operators = argument('--operators', '').split(',').map((s) => s.trim()).filter(Boolean);
const config = JSON.parse(fs.readFileSync(path.join(directory, 'librechat.yaml'), 'utf8'));
config.hermes = { enabled: true, managedOnly: true, publicOrigin: publicURL.origin,
  dashboardURL: 'http://hermes:9119', runtimeURL: 'http://hermes:8642', endpointName: 'Hermes', allowedUserIds: operators };
config.endpoints = { agents: { capabilities: ['tools', 'artifacts'], disableBuilder: true, allowedProviders: ['Hermes'] },
  custom: [{ name: 'Hermes', apiKey: '${HERMES_BRIDGE_KEY}',
    baseURL: 'http://127.0.0.1:3080/api/hermes/runtime/v1',
    models: { default: ['Agent: default'], fetch: true },
    headers: { 'X-LibreChat-User-Id': '{{LIBRECHAT_USER_ID}}',
      'X-LibreChat-Conversation-Id': '{{LIBRECHAT_BODY_CONVERSATIONID}}',
      'X-LibreChat-Response-Id': '{{LIBRECHAT_BODY_RESPONSEMESSAGEID}}',
      'X-LibreChat-Message-Id': '{{LIBRECHAT_BODY_MESSAGEID}}' },
    titleConvo: true, titleTiming: 'immediate', titleMethod: 'completion',
    titleModel: '__hermes_chat_title__', titlePrompt: '{convo}', titlePromptTemplate: '{input}',
    summarize: false, modelDisplayLabel: 'Hermes' }] };
config.memory = { disabled: true };
delete config.webSearch;
delete config.mcpServers;
// Hide native managers: their records are not Hermes profiles, skills or servers.
config.interface = { ...config.interface,
  agents: { use: false, create: false, share: false, public: false },
  skills: { use: false, create: false, share: false },
  mcpServers: { use: false, create: false, share: false },
  memories: false, schedules: false,
  sharedLinks: { create: true, share: true, public: true },
};
config.modelSpecs = { enforce: false, prioritize: false,
  list: [{ name: 'hermes-default', label: 'Hermes', showInMenu: false,
    preset: { endpoint: 'Hermes', model: 'Agent: default' } }], addedEndpoints: ['Hermes'] };
fs.writeFileSync(path.join(directory, 'integration.librechat.yaml'), JSON.stringify(config, null, 2) + '\n');

const file = path.join(directory, '.env');
let env = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const hasValue = (key) => new RegExp(`^${key}=.+$`, 'm').test(env);
const set = (key, value, replace = false) => {
  if (hasValue(key) && !replace) return;
  const expression = new RegExp(`^${key}=.*(?:\\r?\\n|$)`, 'm');
  env = expression.test(env) ? env.replace(expression, () => `${key}=${value}\n`) : `${env.replace(/\n?$/, '\n')}${key}=${value}\n`;
};
for (const [key, value] of Object.entries({ HOST: '0.0.0.0', PORT: '3080',
  MONGO_URI: 'mongodb://mongodb:27017/LibreChat', ENDPOINTS: 'custom', SEARCH: 'false',
  ALLOW_EMAIL_LOGIN: 'true', ALLOW_REGISTRATION: 'true', ALLOW_SOCIAL_LOGIN: 'false',
  HERMES_DASHBOARD_BASIC_AUTH_USERNAME: 'pilot' })) set(key, value);
for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CREDS_KEY', 'HERMES_API_KEY',
  'HERMES_BRIDGE_KEY', 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD']) set(key, randomBytes(32).toString('hex'));
set('CREDS_IV', randomBytes(16).toString('hex'));
set('ALLOW_SHARED_LINKS', 'true', true);
set('ALLOW_SHARED_LINKS_PUBLIC', 'true', true);
set('TITLE_CONVO', 'true', true);
set('DOMAIN_CLIENT', publicURL.origin, true); set('DOMAIN_SERVER', publicURL.origin, true);
set('LIBRECHAT_PUBLIC_HOST', publicURL.host, true);
fs.writeFileSync(file, env.replace(/^\n/, ''), { mode: 0o600 });
if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
console.log('Prepared integrated LibreChat configuration and private deployment environment. Existing keys were preserved.');
console.log(`Origin: ${publicURL.origin}. Management operators: administrators${operators.length ? ` and ${operators.length} allowlisted user(s)` : ''}.`);
