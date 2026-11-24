const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = path.join(root, 'src/hermes-agent/hermes_cli/web_routers');
const apis = [];
for (const file of fs.readdirSync(routes).filter((name) => name.endsWith('.py'))) {
  const lines = fs.readFileSync(path.join(routes, file), 'utf8').split('\n');
  lines.forEach((line, index) => {
    const match = line.match(/^@\w+\.(get|post|put|patch|delete|websocket)\("([^"]+)"/);
    if (match) apis.push({ method: match[1].toUpperCase(), path: match[2],
      source: `src/hermes-agent/hermes_cli/web_routers/${file}`, line: index + 1 });
  });
}
const app = fs.readFileSync(path.join(root, 'src/hermes-agent/web/src/App.tsx'), 'utf8');
const pages = [...new Set([...app.matchAll(/path: "(\/[^"{}]*)"/g)].map((match) => match[1]))];
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/hermes-capabilities.json'), JSON.stringify({
  sourceVersion: 'v0.23.3 source snapshot',
  management: 'Stock Hermes dashboard, authenticated by LibreChat through /hermes-workspace',
  coverage: 'Dashboard resource routes and plugin routes are proxied. Dashboard login/logout are owned by LibreChat. CLI-only capabilities require Hermes terminal/skills; hardware and credential prerequisites still apply.',
  pages, apis,
}, null, 2) + '\n');
console.log(`Catalogued ${pages.length} dashboard routes and ${apis.length} REST/WebSocket route declarations.`);
