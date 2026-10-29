// Copies the playable static site into _site/ (what GitHub Pages serves).
// The game has no compile step; this only keeps tests and tooling out of the
// published artifact.
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of ['index.html', 'manifest.webmanifest', 'css', 'js', 'assets', 'LICENSE']) {
  cpSync(join(root, item), join(out, item), { recursive: true });
}
writeFileSync(join(out, '.nojekyll'), '');
console.log('Built _site/');
