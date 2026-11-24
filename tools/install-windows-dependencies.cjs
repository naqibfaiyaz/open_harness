// Exact upstream npm ci, with directory-copy workspace links on restricted Windows hosts.
// No production manifests or lockfiles are changed.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../src/LibreChat');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const preload = path.join(__dirname, 'workspace-copy-links.cjs');
const result = spawnSync(process.execPath, ['--require', preload, npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: root, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
