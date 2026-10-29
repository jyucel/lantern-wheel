// Minimal static file server for local play and browser tests.
//   node tools/serve.mjs [port] [root] [prefix]
// With a prefix (e.g. /little-orrery/) the site is only served below that
// path, mimicking a GitHub Pages project site.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const port = Number(process.argv[2] || process.env.PORT || 8080);
const root = resolve(process.argv[3] || '.');
const prefix = process.argv[4] || '/';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!path.startsWith(prefix)) {
      if (path + '/' === prefix) {
        res.writeHead(301, { location: prefix });
        return res.end();
      }
      throw new Error('outside prefix');
    }
    path = '/' + path.slice(prefix.length);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, () => console.log(`Lantern Wheel at http://localhost:${port}${prefix}`));
