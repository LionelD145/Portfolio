/* Petit serveur statique sans dépendance, pour prévisualiser le site.
   Usage : node tools/serve.mjs [port]   ->  http://127.0.0.1:5173
   (Ouvrir index.html directement dans le navigateur fonctionne aussi.) */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function resolveSafe(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = normalize(clean).replace(/^(\.\.[/\\])+/, '');
  const full = join(ROOT, rel);
  if (!full.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    let path = resolveSafe(req.url === '/' ? '/index.html' : req.url);
    if (!path) { res.writeHead(403).end('Interdit'); return; }

    let info = await stat(path).catch(() => null);
    if (info && info.isDirectory()) {
      path = join(path, 'index.html');
      info = await stat(path).catch(() => null);
    }
    if (!info) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>Page introuvable. <a href="/">Retour à l\'accueil</a></p>');
      return;
    }

    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': MIME[extname(path).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Erreur serveur : ' + err.message);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Portfolio servi sur http://127.0.0.1:${PORT}`);
  console.log('Ctrl+C pour arrêter.');
});
