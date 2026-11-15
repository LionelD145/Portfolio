import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Environnement isolé : données, envois et index.html dans un dossier temporaire. */
export function isolate() {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-test-'));
  process.env.DATA_DIR = join(dir, 'data');
  process.env.UPLOADS_DIR = join(dir, 'uploads');
  process.env.INDEX_PATH = join(dir, 'index.html');
  process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
  process.env.TRUST_PROXY = '1'; // une IP simulée par client (le blocage anti-force-brute est par IP)
  return dir;
}

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.ip = `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; }
  async req(method, path, body, { raw, headers = {}, csrf = true } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers };
    if (csrf) h['x-requested-with'] = 'portfolio-admin';
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (raw) { payload = raw; h['content-type'] = 'application/octet-stream'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* pas du JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
  login(password = 'mot-de-passe-de-test') { return this.req('POST', '/api/login', { password }); }
}

// Petits fichiers valides pour les tests d'envoi.
export const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
