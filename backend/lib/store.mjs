/* Stockage : data/content.json (source de vérité), sauvegardes horodatées,
   écriture atomique et régénération d'index.html. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA_DIR } from './util.mjs';
import { normalizeContent } from './schema.mjs';
import { renderSite } from './render.mjs';

export const CONTENT_PATH = join(DATA_DIR, 'content.json');
export const BACKUP_DIR = join(DATA_DIR, 'backups');
export const SEED_PATH = join(ROOT, 'backend', 'seed', 'content.default.json');
export const INDEX_PATH = process.env.INDEX_PATH || join(ROOT, 'index.html');
const MAX_BACKUPS = 60;

export const revOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

export async function atomicWrite(file, data, mode = 0o644) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, file);
}

/** Lecture du contenu (le crée depuis le modèle par défaut au premier lancement). */
export async function readContent() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(CONTENT_PATH)) await copyFile(SEED_PATH, CONTENT_PATH);
  const text = await readFile(CONTENT_PATH, 'utf8');
  const { content } = normalizeContent(JSON.parse(text));
  return { content, rev: revOf(text) };
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export async function listBackups() {
  if (!existsSync(BACKUP_DIR)) return [];
  const names = (await readdir(BACKUP_DIR)).filter((n) => /^content-[\d-]+-[0-9a-f]+\.json$/.test(n));
  const out = [];
  for (const name of names) {
    const info = await stat(join(BACKUP_DIR, name));
    out.push({ id: name.slice(0, -5), createdAt: info.mtime.toISOString(), size: info.size });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function backupCurrent() {
  if (!existsSync(CONTENT_PATH)) return;
  await mkdir(BACKUP_DIR, { recursive: true });
  const text = await readFile(CONTENT_PATH, 'utf8');
  const file = join(BACKUP_DIR, `content-${stamp()}-${revOf(text).slice(0, 6)}.json`);
  if (!existsSync(file)) await writeFile(file, text, { mode: 0o600 });
  const all = await listBackups();
  for (const old of all.slice(MAX_BACKUPS)) await rm(join(BACKUP_DIR, `${old.id}.json`), { force: true });
}

export async function readBackup(id) {
  if (!/^content-[\d-]+-[0-9a-f]+$/.test(id)) throw new Error('Identifiant de sauvegarde invalide.');
  const text = await readFile(join(BACKUP_DIR, `${id}.json`), 'utf8');
  return normalizeContent(JSON.parse(text)).content;
}

/** Régénère index.html à partir du contenu. */
export async function publish(content) {
  await atomicWrite(INDEX_PATH, renderSite(content));
}

/**
 * Valide, sauvegarde l'ancienne version, écrit le contenu et publie.
 * @param {object} incoming  contenu envoyé par l'admin
 * @param {string|null} expectedRev  révision vue par l'admin (contrôle de concurrence)
 */
export async function saveContent(incoming, expectedRev = null) {
  const current = await readContent();
  if (expectedRev && expectedRev !== current.rev) {
    const err = new Error('Le contenu a été modifié ailleurs (autre onglet ou autre appareil). Rechargez la page avant d\'enregistrer.');
    err.status = 409;
    throw err;
  }
  const { content, errors } = normalizeContent(incoming);
  const text = JSON.stringify(content, null, 2) + '\n';
  if (text !== (await readFile(CONTENT_PATH, 'utf8'))) await backupCurrent();
  await atomicWrite(CONTENT_PATH, text, 0o600);
  await publish(content);
  return { content, rev: revOf(text), warnings: errors };
}
