const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../src/LibreChat');
const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const tasks = [['data-provider', 'build:data-provider'], ['data-schemas', 'build:data-schemas'],
  ['api', 'build:api'], ['client', 'build:client-package'], ['chat', 'build:chat'], [null, 'build:client']];
for (const [workspace, task] of tasks) {
  const log = path.resolve(__dirname, `../tests/${task.replace(':', '-')}.log`);
  const output = fs.openSync(log, 'w');
  console.log(`Building ${workspace ?? 'LibreChat frontend'}...`);
  const result = spawnSync(process.execPath, [npm, 'run', task], {
    cwd: root, stdio: ['ignore', output, output], env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=12288' },
  });
  fs.closeSync(output);
  if (result.status !== 0) {
    console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-35).join('\n'));
    process.exit(result.status ?? 1);
  }
  if (workspace && !fs.lstatSync(path.join(root, 'node_modules',
    workspace === 'data-provider' ? 'librechat-data-provider' : `@librechat/${workspace}`)).isSymbolicLink()) {
    const copy = spawnSync(process.execPath, [path.join(__dirname, 'copy-workspace-package.cjs'), workspace], { stdio: 'inherit' });
    if (copy.status !== 0) process.exit(copy.status ?? 1);
  }
}
console.log('All LibreChat packages and frontend built.');
