#!/usr/bin/env node
// Minimal local server for previewing the site without a Firebase login.
// Serves the repo root and applies the exact-path "redirects" and "rewrites"
// from firebase.json, so routes behave as they will on Firebase Hosting.
//
//   npm run dev              http://localhost:5000
//   npm run dev -- 8080      another port

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5000;
const hosting = JSON.parse(await readFile(path.join(ROOT, 'firebase.json'), 'utf8')).hosting;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.usdz': 'model/vnd.usdz+zip'
};

async function resolveFile(urlPath) {
  const file = path.join(ROOT, decodeURIComponent(urlPath));
  if (!file.startsWith(ROOT)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return file;
    if (info.isDirectory()) {
      const index = path.join(file, 'index.html');
      if ((await stat(index)).isFile()) return index;
    }
  } catch {
    // Not found.
  }
  return null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  const redirect = hosting.redirects?.find((r) => r.source === pathname);
  if (redirect) {
    res.writeHead(redirect.type ?? 301, { location: redirect.destination });
    res.end();
    return;
  }

  let file = await resolveFile(pathname);
  if (!file) {
    const rewrite = hosting.rewrites?.find((r) => r.source === pathname);
    if (rewrite) file = await resolveFile(rewrite.destination);
  }

  const status = file ? 200 : 404;
  file ??= await resolveFile('/404.html');
  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }
  res.writeHead(status, {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-store'
  });
  res.end(await readFile(file));
}).listen(PORT, () => {
  console.log(`Serving ${ROOT} at http://localhost:${PORT}`);
  console.log(`Form page: http://localhost:${PORT}/neuromodulation-interest`);
});
