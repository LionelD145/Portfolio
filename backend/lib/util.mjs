/* Utilitaires partagés : échappement HTML, mini-balisage, chemins. */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
/** Dossier où sont écrits les fichiers envoyés (par défaut : assets/ du site).
 *  Sur un hébergeur à disque éphémère, pointer UPLOADS_DIR vers un volume persistant. */
export const UPLOADS_ROOT = process.env.UPLOADS_DIR || join(ROOT, 'assets');

/** Chemins disque possibles d'un fichier « assets/... » (site, puis dossier d'envoi). */
export function mediaCandidates(rel) {
  const sub = rel.replace(/^assets\//, '');
  return [join(ROOT, 'assets', sub), join(UPLOADS_ROOT, sub)];
}

/** Échappe le texte pour le HTML. Les espaces insécables deviennent &nbsp;. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/ /g, '&nbsp;');
}

/**
 * Mini-balisage autorisé dans les champs de texte (tout le reste est échappé) :
 *   {hl|texte}    mot mis en valeur (dégradé)
 *   {code|texte}  code en ligne
 *   {dim|…} {cm|…} {ok|…} {arg|…} {cmd|…}   couleurs du terminal
 *   {br}          saut de ligne      {caret}   curseur clignotant
 */
const TOKEN = /\{(hl|code|dim|cm|ok|arg|cmd)\|([^{}]*)\}|\{(br|caret)\}/g;
export function inline(value) {
  return esc(value).replace(TOKEN, (_m, tag, text, single) => {
    if (single === 'br') return '<br>';
    if (single === 'caret') return '<span class="caret" aria-hidden="true"></span>';
    if (tag === 'code') return `<code>${text}</code>`;
    return `<span class="${tag}">${text}</span>`;
  });
}

export const pad2 = (n) => String(n).padStart(2, '0');

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'fichier';
}

export const isExternal = (url) => /^https?:\/\//i.test(url || '');
