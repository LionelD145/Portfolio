#!/usr/bin/env node
/* Serveur du portfolio + API d'administration. Aucune dépendance.
   Usage : npm run admin      →  http://127.0.0.1:5174  (admin : /admin/)  */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { ROOT, mediaCandidates } from './lib/util.mjs';
import { readContent, saveContent, publish, listBackups, readBackup, INDEX_PATH } from './lib/store.mjs';
import { normalizeContent } from './lib/schema.mjs';
import { renderSite } from './lib/render.mjs';
import {
  loadCredentials, saveCredentials, verifyHash, passwordProblem, createSession, verifySession,
  LoginLimiter, parseCookies, SESSION_TTL
} from './lib/auth.mjs';
import { listMedia, saveUpload, deleteMedia, httpError, MAX_IMAGE, MAX_DOC } from './lib/media.mjs';
import { fetchGithub } from './lib/github.mjs';

const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || '127.0.0.1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const COOKIE = 'portfolio_admin';
const ADMIN_DIR = join(ROOT, 'backend', 'admin');
const ADMIN_FILES = { 'index.html': 'text/html; charset=utf-8', 'admin.css': 'text/css; charset=utf-8', 'admin.js': 'text/javascript; charset=utf-8' };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2'
};

const limiter = new LoginLimiter();
let previewHtml = '';

/* ---------- Utilitaires HTTP ---------- */
const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for']
  ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
  : req.socket.remoteAddress) || 'inconnu';
const isSecure = (req) => req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

function baseHeaders(extra = {}) {
  return { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...extra };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, baseHeaders({ 'content-length': Buffer.byteLength(body), ...headers }));
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) return reject(httpError(413, `Fichier trop volumineux (max ${Math.round(limit / 1048576)} Mo).`));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(httpError(413, `Fichier trop volumineux (max ${Math.round(limit / 1048576)} Mo).`)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1024 * 1024) {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString('utf8') || '{}'); }
  catch { throw httpError(400, 'Corps de requête JSON invalide.'); }
}

/* ---------- Sécurité des requêtes ---------- */
const ADMIN_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function assertSameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'portfolio-admin') throw httpError(403, 'Requête refusée (en-tête manquant).');
  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* origine invalide */ }
    if (host !== req.headers.host) throw httpError(403, 'Requête refusée (origine différente).');
  }
}

async function session(req) {
  const creds = await loadCredentials();
  if (!creds) return { creds: null, ok: false };
  const token = parseCookies(req.headers.cookie)[COOKIE];
  return { creds, ok: await verifySession(token, creds.version) };
}

async function requireAuth(req) {
  const s = await session(req);
  if (!s.ok) throw httpError(401, 'Connexion requise.');
  return s;
}

const cookieHeader = (req, value, maxAge) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;

/* ---------- Routes API ---------- */
async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (req.method !== 'GET' && req.method !== 'HEAD') assertSameOrigin(req);

  if (route === 'GET /api/session') {
    const s = await session(req);
    return sendJson(res, 200, { configured: Boolean(s.creds), authenticated: s.ok });
  }

  if (route === 'POST /api/login') {
    const creds = await loadCredentials();
    if (!creds) throw httpError(503, 'Aucun mot de passe défini. Lancez « npm run password » sur le serveur.');
    const ip = clientIp(req);
    const wait = limiter.check(ip);
    if (wait) throw Object.assign(httpError(429, `Trop de tentatives. Réessayez dans ${Math.ceil(wait / 60)} min.`), { retryAfter: wait });
    const body = await readJson(req, 4096);
    const ok = typeof body.password === 'string' && body.password.length <= 200 && await verifyHash(body.password, creds.hash);
    if (!ok) { limiter.fail(ip); throw httpError(401, 'Mot de passe incorrect.'); }
    limiter.ok(ip);
    const token = await createSession(creds.version);
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookieHeader(req, token, SESSION_TTL) });
  }

  if (route === 'POST /api/logout') {
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookieHeader(req, '', 0) });
  }

  await requireAuth(req);

  if (route === 'GET /api/content') return sendJson(res, 200, await readContent());

  if (route === 'PUT /api/content') {
    const body = await readJson(req);
    const result = await saveContent(body.content, typeof body.rev === 'string' ? body.rev : null);
    return sendJson(res, 200, result);
  }

  if (route === 'POST /api/preview') {
    const body = await readJson(req);
    previewHtml = renderSite(normalizeContent(body.content).content, { base: true });
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /api/media') return sendJson(res, 200, { media: await listMedia((await readContent()).content) });

  if (route === 'POST /api/media') {
    const kind = url.searchParams.get('kind') === 'doc' ? 'doc' : 'image';
    const name = String(url.searchParams.get('name') || 'fichier').slice(0, 120);
    const buf = await readBody(req, kind === 'doc' ? MAX_DOC : MAX_IMAGE);
    return sendJson(res, 201, await saveUpload(buf, name, kind));
  }

  if (route === 'POST /api/media/delete') {
    const body = await readJson(req, 4096);
    await deleteMedia(String(body.path || ''), (await readContent()).content);
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /api/backups') return sendJson(res, 200, { backups: await listBackups() });

  if (route === 'POST /api/backups/restore') {
    const body = await readJson(req, 4096);
    const restored = await readBackup(String(body.id || '')).catch(() => { throw httpError(404, 'Sauvegarde introuvable.'); });
    return sendJson(res, 200, await saveContent(restored, null));
  }

  if (route === 'POST /api/github/sync') {
    const body = await readJson(req, 4096);
    const user = String(body.user || '').replace(/^@/, '');
    try {
      const data = await fetchGithub({ user, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '', forks: Boolean(body.forks), archived: Boolean(body.archived) });
      return sendJson(res, 200, data);
    } catch (err) { throw httpError(502, err.message); }
  }

  if (route === 'POST /api/password') {
    const body = await readJson(req, 4096);
    const creds = await loadCredentials();
    if (typeof body.current !== 'string' || !(await verifyHash(body.current, creds.hash))) throw httpError(403, 'Mot de passe actuel incorrect.');
    const problem = passwordProblem(body.next);
    if (problem) throw httpError(422, problem);
    const fresh = await saveCredentials(body.next);
    const token = await createSession(fresh.version);
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookieHeader(req, token, SESSION_TTL) });
  }

  throw httpError(404, 'Route inconnue.');
}

/* ---------- Fichiers statiques ---------- */
async function serveFile(req, res, file, { cache = 'no-cache' } = {}) {
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) return notFound(res);
  const body = await readFile(file);
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, baseHeaders({ 'content-type': type, 'content-length': body.length, 'cache-control': cache }));
  res.end(req.method === 'HEAD' ? undefined : body);
}

const notFound = (res) => send(res, 404, '<h1>404</h1><p>Page introuvable. <a href="/">Retour à l\'accueil</a></p>', { 'content-type': 'text/html; charset=utf-8' });

function publicPath(pathname) {
  let clean;
  try { clean = decodeURIComponent(pathname); } catch { return null; }
  if (clean.includes('\0')) return null;
  if (clean === '/' || clean === '/index.html') return INDEX_PATH;
  if (!clean.startsWith('/assets/')) return null; // seul index.html et assets/ sont publics
  const assetsRoot = join(ROOT, 'assets') + sep;
  const full = normalize(join(ROOT, clean));
  if (!full.startsWith(assetsRoot)) return null;
  if (full.split(sep).some((part) => part.startsWith('.'))) return null;
  // Fichier du site, sinon fichier envoyé depuis l'admin (UPLOADS_DIR).
  const sub = full.slice(assetsRoot.length).split(sep).join('/');
  return mediaCandidates(`assets/${sub}`).find((f) => existsSync(f)) || full;
}

/* ---------- Routage principal ---------- */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);

    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Méthode non autorisée.');

    if (url.pathname === '/admin') return send(res, 302, '', { location: '/admin/' });
    if (url.pathname === '/admin/preview') {
      await requireAuth(req);
      return send(res, 200, previewHtml || '<p>Aucun aperçu.</p>', {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "frame-ancestors 'self'"
      });
    }
    if (url.pathname.startsWith('/admin/')) {
      const name = url.pathname.slice('/admin/'.length) || 'index.html';
      if (!Object.hasOwn(ADMIN_FILES, name)) return notFound(res);
      const body = await readFile(join(ADMIN_DIR, name));
      return send(res, 200, req.method === 'HEAD' ? '' : body, {
        'content-type': ADMIN_FILES[name], 'cache-control': 'no-cache',
        ...(name === 'index.html' ? { 'content-security-policy': ADMIN_CSP, 'x-frame-options': 'DENY' } : {})
      });
    }

    const file = publicPath(url.pathname);
    if (!file) return notFound(res);
    const isMedia = /\.(jpe?g|png|webp|gif|pdf|svg)$/i.test(file);
    return await serveFile(req, res, file, { cache: isMedia ? 'public, max-age=3600' : 'no-cache' });
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    const headers = err.retryAfter ? { 'retry-after': String(err.retryAfter) } : {};
    if (url.pathname.startsWith('/api/')) {
      return sendJson(res, status, { error: status === 500 ? 'Erreur interne du serveur.' : err.message }, headers);
    }
    return send(res, status, status === 500 ? 'Erreur serveur' : err.message, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  }
});

server.requestTimeout = 60_000;
server.headersTimeout = 20_000;

export async function start({ port = PORT, host = HOST, quiet = false } = {}) {
  // index.html doit toujours refléter data/content.json.
  const { content } = await readContent();
  const expected = renderSite(content);
  const current = existsSync(INDEX_PATH) ? await readFile(INDEX_PATH, 'utf8') : '';
  // Comparaison insensible aux espaces et commentaires : tant que rien n'a été modifié depuis
  // l'admin, le index.html d'origine reste strictement intact (aucune réécriture au démarrage).
  const strip = (s) => s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<span id="year">\d+<\/span>/, '')
    .replace(/\s+/g, ' ').replace(/> /g, '>').replace(/ </g, '<').trim();
  if (strip(current) !== strip(expected)) await publish(content);

  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  if (!quiet) {
    console.log(`Portfolio       http://${host}:${actual}/`);
    console.log(`Administration  http://${host}:${actual}/admin/`);
    if (!(await loadCredentials())) console.log('\n⚠  Aucun mot de passe défini : lancez « npm run password » pour pouvoir vous connecter.');
    if (host !== '127.0.0.1' && host !== 'localhost' && !TRUST_PROXY) console.log('\n⚠  Exposé sur le réseau : placez le serveur derrière HTTPS (TRUST_PROXY=1 si proxy inverse).');
  }
  return { server, port: actual };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.mjs')) {
  start().catch((err) => { console.error(err); process.exit(1); });
}
