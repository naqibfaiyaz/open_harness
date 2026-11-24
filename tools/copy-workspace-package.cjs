// On hosts where directory symlinks are unavailable, copy built workspace artifacts.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/LibreChat');
const folder = process.argv[2];
if (!['data-provider', 'data-schemas', 'api', 'client', 'chat', 'channel-gateway'].includes(folder)) throw new Error('Unknown workspace');
const source = path.join(root, 'packages', folder);
const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
const target = path.join(root, 'node_modules', pkg.name);
fs.mkdirSync(target, { recursive: true });
fs.copyFileSync(path.join(source, 'package.json'), path.join(target, 'package.json'));
fs.cpSync(path.join(source, 'dist'), path.join(target, 'dist'), { recursive: true, force: true });
if (fs.existsSync(path.join(source, 'node_modules'))) {
  fs.cpSync(path.join(source, 'node_modules'), path.join(target, 'node_modules'), { recursive: true, force: true });
}
console.log(`Copied built ${pkg.name}`);
