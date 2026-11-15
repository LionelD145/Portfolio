/* Authentification : mot de passe unique (scrypt), session signée (HMAC)
   en cookie HttpOnly, limitation des tentatives de connexion. */
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './util.mjs';
import { atomicWrite } from './store.mjs';

const AUTH_PATH = join(DATA_DIR, 'auth.json');
const SECRET_PATH = join(DATA_DIR, 'secret.key');
export const SESSION_TTL = 7 * 24 * 3600; // secondes
export const MIN_PASSWORD = 10;

const N = 16384, R = 8, P = 1, KEYLEN = 64;

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyHash(password, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt' || Number(n) !== N || Number(r) !== R || Number(p) !== P) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await derive(password, Buffer.from(saltB64, 'base64'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`;
  if (password.length > 200) return 'Mot de passe trop long.';
  if (/^(.)\1+$/.test(password)) return 'Mot de passe trop simple.';
  return null;
}

/* ---------- Identifiants ---------- */
let envHash = null;

/** @returns {Promise<{hash:string, version:string}|null>} */
export async function loadCredentials() {
  if (existsSync(AUTH_PATH)) {
    const data = JSON.parse(await readFile(AUTH_PATH, 'utf8'));
    if (data.hash && data.version) return data;
  }
  if (process.env.ADMIN_PASSWORD) {
    envHash ??= await hashPassword(process.env.ADMIN_PASSWORD);
    return { hash: envHash, version: 'env-' + envHash.split('$')[4].slice(0, 8) };
  }
  return null;
}

export async function saveCredentials(password) {
  await mkdir(DATA_DIR, { recursive: true });
  const data = { hash: await hashPassword(password), version: randomBytes(8).toString('hex'), updatedAt: new Date().toISOString() };
  await atomicWrite(AUTH_PATH, JSON.stringify(data, null, 2) + '\n', 0o600);
  return data;
}

/* ---------- Sessions ---------- */
let secretCache = null;
async function secret() {
  if (secretCache) return secretCache;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    secretCache = Buffer.from(process.env.SESSION_SECRET);
  } else {
    await mkdir(DATA_DIR, { recursive: true });
    if (!existsSync(SECRET_PATH)) await atomicWrite(SECRET_PATH, randomBytes(48).toString('hex'), 0o600);
    secretCache = Buffer.from((await readFile(SECRET_PATH, 'utf8')).trim());
  }
  return secretCache;
}

const sign = (key, text) => createHmac('sha256', key).update(text).digest('base64url');

export async function createSession(version) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const body = `${exp}.${version}`;
  return `${body}.${sign(await secret(), body)}`;
}

export async function verifySession(token, version) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [exp, ver, sig] = parts;
  const expected = sign(await secret(), `${exp}.${ver}`);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return ver === version && Number(exp) > Date.now() / 1000;
}

/* ---------- Limitation des tentatives ---------- */
export class LoginLimiter {
  constructor({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max; this.windowMs = windowMs; this.hits = new Map();
  }
  /** @returns {number} secondes à attendre (0 = autorisé) */
  check(key) {
    const e = this.hits.get(key);
    if (!e) return 0;
    if (Date.now() - e.first > this.windowMs) { this.hits.delete(key); return 0; }
    return e.count >= this.max ? Math.ceil((e.first + this.windowMs - Date.now()) / 1000) : 0;
  }
  fail(key) {
    const e = this.hits.get(key);
    if (!e || Date.now() - e.first > this.windowMs) this.hits.set(key, { first: Date.now(), count: 1 });
    else e.count += 1;
    if (this.hits.size > 5000) this.hits.clear();
  }
  ok(key) { this.hits.delete(key); }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
