// Preload for npm only on Windows hosts that prohibit directory symlinks.
// Preserve npm ci's lockfile and dependency graph; copy local workspaces at its link seam.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../src/LibreChat');
const nativeLink = fsp.symlink.bind(fsp);
fsp.symlink = async (target, destination, type) => {
  const source = path.resolve(path.dirname(destination), target);
  const relative = path.relative(root, source);
  const isWorkspace = !relative.startsWith('..') && !path.isAbsolute(relative) &&
    !relative.split(path.sep).includes('node_modules') && fs.existsSync(path.join(source, 'package.json'));
  if (!isWorkspace) return nativeLink(target, destination, type);
  await fsp.cp(source, destination, { recursive: true, force: true,
    filter: (item) => {
      const segments = path.relative(source, item).split(path.sep);
      return !segments.some((part) => ['node_modules', 'dist', '.git'].includes(part)) &&
        !fs.lstatSync(item).isSymbolicLink();
    },
  });
};
