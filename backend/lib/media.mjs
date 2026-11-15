/* Médiathèque : liste, envoi et suppression des images et du CV.
   Le type réel est détecté par la signature du fichier (pas par l'extension
   annoncée) ; les SVG sont refusés à l'envoi car ils peuvent contenir du script. */
import { mkdir, readdir, readFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, UPLOADS_ROOT, slugify, mediaCandidates } from './util.mjs';
import { sniff, imageSize } from './imagesize.mjs';
import { atomicWrite } from './store.mjs';

export const MAX_IMAGE = 8 * 1024 * 1024;
export const MAX_DOC = 12 * 1024 * 1024;
const SUBDIRS = ['img', 'docs'];
const LISTED = /\.(jpe?g|png|webp|gif|svg|pdf)$/i;

export const MEDIA_PATH = /^assets\/(img|docs)\/(?!\.)[A-Za-z0-9._-]+$/;

export async function listMedia(content) {
  const used = collectPaths(content);
  const out = [];
  const seen = new Set();
  const roots = [join(ROOT, 'assets'), UPLOADS_ROOT];
  for (const dir of SUBDIRS) for (const root of roots) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    for (const name of await readdir(abs)) {
      if (!LISTED.test(name)) continue;
      const rel = `assets/${dir}/${name}`;
      if (seen.has(rel)) continue;
      const info = await stat(join(abs, name));
      if (!info.isFile()) continue;
      seen.add(rel);
      const entry = { path: rel, name, size: info.size, type: extname(name).slice(1).toLowerCase(), used: used.has(rel), width: 0, height: 0 };
      if (dir === 'img' && entry.type !== 'svg') {
        const dims = imageSize(await readFile(join(abs, name)));
        if (dims) { entry.width = dims.width; entry.height = dims.height; }
      }
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Tous les chemins de médias référencés par le contenu. */
export function collectPaths(content) {
  const found = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (MEDIA_PATH.test(v)) found.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(content);
  return found;
}

/**
 * Enregistre un fichier envoyé.
 * @param {Buffer} buf
 * @param {string} originalName
 * @param {'image'|'doc'} kind
 */
export async function saveUpload(buf, originalName, kind) {
  const type = sniff(buf);
  if (kind === 'image' && !['jpg', 'png', 'webp', 'gif'].includes(type)) {
    throw httpError(415, 'Format d\'image non accepté (JPEG, PNG, WebP ou GIF uniquement).');
  }
  if (kind === 'doc' && type !== 'pdf') throw httpError(415, 'Seuls les fichiers PDF sont acceptés pour les documents.');
  if (kind !== 'image' && kind !== 'doc') throw httpError(400, 'Type d\'envoi inconnu.');

  const dims = kind === 'image' ? imageSize(buf) : null;
  if (kind === 'image' && (!dims || !dims.width || !dims.height)) throw httpError(422, 'Image illisible ou corrompue.');
  if (dims && (dims.width > 12000 || dims.height > 12000)) throw httpError(422, 'Image trop grande (12000 px maximum de chaque côté).');

  const dir = kind === 'image' ? 'img' : 'docs';
  const target = join(UPLOADS_ROOT, dir);
  await mkdir(target, { recursive: true });
  const base = slugify(String(originalName).replace(/\.[^.]*$/, ''));
  const ext = type === 'jpg' ? 'jpg' : type;
  let name = `${base}.${ext}`;
  const taken = (n) => mediaCandidates(`assets/${dir}/${n}`).some((f) => existsSync(f));
  while (taken(name)) name = `${base}-${randomBytes(2).toString('hex')}.${ext}`;

  await atomicWrite(join(target, name), buf);
  return { path: `assets/${dir}/${name}`, name, size: buf.length, width: dims?.width || 0, height: dims?.height || 0 };
}

/** Supprime un fichier, sauf s'il est encore utilisé. */
export async function deleteMedia(rel, content) {
  if (!MEDIA_PATH.test(rel) || rel.includes('..')) throw httpError(400, 'Chemin invalide.');
  if (collectPaths(content).has(rel)) throw httpError(409, 'Ce fichier est encore utilisé sur le site : retirez-le d\'abord.');
  // Fichiers référencés en dur dans la feuille de style ou le script.
  const name = rel.split('/').pop();
  for (const f of ['assets/css/style.css', 'assets/js/main.js']) {
    try { if ((await readFile(join(ROOT, f), 'utf8')).includes(name)) throw httpError(409, `Ce fichier est utilisé par ${f}.`); }
    catch (e) { if (e.status) throw e; }
  }
  const abs = mediaCandidates(rel).find((f) => existsSync(f));
  if (!abs) throw httpError(404, 'Fichier introuvable.');
  await rm(abs);
}

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}
