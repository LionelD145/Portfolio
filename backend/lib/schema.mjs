/* Schéma du contenu + normalisation stricte.
   Tout ce qui arrive de l'API passe ici : types forcés, longueurs bornées,
   URLs et chemins de fichiers contrôlés, clés inconnues supprimées. */
import { readFileSync } from 'node:fs';
import { mediaCandidates } from './util.mjs';
import { imageSize } from './imagesize.mjs';

/* ---------- Constructeurs de schéma ---------- */
const str = (max = 400, def = '') => ({ t: 'str', max, def });
const text = (max = 2000, def = '') => ({ t: 'str', max, def });
const url = (def = '') => ({ t: 'url', def });
const path = (def = '') => ({ t: 'path', def });
const bool = (def = false) => ({ t: 'bool', def });
const int = (def = 0, min = 0, max = 100000) => ({ t: 'int', def, min, max });
const color = () => ({ t: 'color', def: '' });
const slug = (def = '') => ({ t: 'slug', def });
const list = (item, max = 50) => ({ t: 'list', item, max });
const obj = (fields) => ({ t: 'obj', fields });
const img = () => ({ t: 'img' });
const lines = (max = 30, len = 200) => list(str(len), max);

const heading = (withLede = true) => obj({
  num: str(8), eyebrow: str(60), title: str(160), ...(withLede ? { lede: text(600) } : {})
});
const link = () => obj({ label: str(80), href: url() });

export const SCHEMA = obj({
  version: int(1, 1, 1),
  site: obj({
    lang: str(8, 'fr'),
    title: str(200), description: text(400), author: str(100),
    canonical: url(), ogTitle: str(200), ogDescription: text(400),
    ogImage: path(), ogImageAlt: str(300), favicon: path(),
    brandMark: str(3), brandName: str(60), brandAria: str(160),
    cvFile: path(), cvDownloadName: str(80, 'CV.pdf')
  }),
  nav: obj({ links: list(link(), 8), cta: str(60) }),
  hero: obj({
    badge: str(120), title: text(300), lede: text(800),
    primary: link(), secondary: link(), cvLabel: str(40),
    facts: list(obj({ label: str(40), value: str(80) }), 6),
    console: obj({
      aria: text(500), title: str(80),
      lines: list(obj({
        kind: { t: 'enum', values: ['cmd', 'out'], def: 'out' },
        cmd: str(80), arg: str(80), text: str(200)
      }), 30)
    }),
    chips: lines(6, 60)
  }),
  marquee: lines(40, 40),
  projects: obj({
    head: heading(),
    featured: obj({
      enabled: bool(true), eyebrow: str(60), title: str(120), description: text(900),
      bullets: lines(8, 220), tags: lines(12, 40),
      image: img(), phone: img(),
      note: str(200), noteLinkLabel: str(80), noteLinkHref: url()
    }),
    subtitle: str(80), allLabel: str(30),
    categories: list(obj({ id: slug(), label: str(40) }), 10),
    emptyText: str(160),
    cards: list(obj({
      category: slug(), chip: str(30), title: str(100), sub: str(60),
      description: text(900), tags: lines(12, 40), image: img(),
      links: list(obj({ label: str(40), url: url() }), 4),
      muted: str(60), kind: str(60)
    }), 60)
  }),
  about: obj({
    head: heading(false),
    lead: text(900), body: text(1500),
    skills: list(obj({ label: str(60), value: text(300) }), 10),
    card: obj({ mark: str(3), name: str(80), role: str(100), where: str(100), state: str(100) }),
    stats: list(obj({ num: str(10), label: str(60), auto: bool(false) }), 8)
  }),
  timeline: obj({
    head: heading(false),
    items: list(obj({ year: str(30), title: str(160), description: text(900), tags: lines(12, 40) }), 30)
  }),
  github: obj({
    head: heading(),
    user: str(60), buttonLabel: str(60), buttonUrl: url(),
    stats: obj({ count: int(0, 0, 100000), languages: int(0, 0, 1000), since: str(40) }),
    repos: list(obj({
      name: str(120), url: url(), language: str(40), color: color(),
      description: str(300), updated: str(40), homepage: url()
    }), 100),
    note: str(300)
  }),
  contact: obj({
    head: heading(false),
    title: str(200), lede: text(500), email: str(120),
    copyLabel: str(60), cvLabel: str(60),
    githubLabel: str(80), githubUrl: url(), location: str(100)
  }),
  footer: obj({ name: str(80), mark: str(3), note: str(160), topLabel: str(40) })
});

/* ---------- Normalisation ---------- */
const SAFE_URL = /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+|tel:[^\s"<>]+|#[\w-]*|\/[^\s"<>]*|[\w][\w./~%+-]*(\?[^\s"<>]*)?(#[\w-]*)?)$/i;
const MEDIA_PATH = /^assets\/(img|docs)\/(?!\.)[A-Za-z0-9._-]+$/;

/* eslint-disable no-control-regex */
const cleanText = (s) => s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');

function norm(spec, v, errors, where, ctx) {
  switch (spec.t) {
    case 'str': {
      if (typeof v !== 'string') return spec.def ?? '';
      let s = cleanText(v);
      if (s.length > spec.max) { errors.push(`${where} : trop long (max ${spec.max} caractères).`); s = s.slice(0, spec.max); }
      return s;
    }
    case 'url': {
      if (typeof v !== 'string') return spec.def;
      const s = v.trim();
      if (!s) return '';
      if (!SAFE_URL.test(s) || /^(javascript|data|vbscript|file):/i.test(s)) {
        errors.push(`${where} : lien non autorisé (« ${s.slice(0, 40)} »).`);
        return '';
      }
      return s;
    }
    case 'path': {
      if (typeof v !== 'string') return spec.def;
      const s = v.trim();
      if (!s) return '';
      if (!MEDIA_PATH.test(s) || s.includes('..')) { errors.push(`${where} : fichier non autorisé.`); return ''; }
      return s;
    }
    case 'bool': return typeof v === 'boolean' ? v : spec.def;
    case 'int': {
      const num = Number(v);
      if (!Number.isFinite(num)) return spec.def;
      return Math.min(spec.max, Math.max(spec.min, Math.round(num)));
    }
    case 'color': {
      if (typeof v !== 'string' || !v.trim()) return '';
      const s = v.trim();
      if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
      errors.push(`${where} : couleur invalide (attendu #rrggbb).`);
      return '';
    }
    case 'slug': {
      if (typeof v !== 'string') return '';
      return v.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    }
    case 'enum': return spec.values.includes(v) ? v : spec.def;
    case 'list': {
      if (!Array.isArray(v)) return [];
      if (v.length > spec.max) errors.push(`${where} : trop d'éléments (max ${spec.max}).`);
      return v.slice(0, spec.max).map((item, i) => norm(spec.item, item, errors, `${where} #${i + 1}`, ctx));
    }
    case 'img': {
      const src = norm(path(), v && v.src, errors, `${where} (image)`, ctx);
      const alt = norm(str(400), v && v.alt, errors, `${where} (texte alternatif)`, ctx);
      const out = { src, alt, width: 0, height: 0 };
      if (src) {
        const dims = ctx.dims(src);
        if (dims) { out.width = dims.width; out.height = dims.height; }
        else if (!ctx.exists(src)) errors.push(`${where} : le fichier « ${src} » n'existe pas.`);
      }
      return out;
    }
    case 'obj': {
      const out = {};
      const src = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      for (const [key, sub] of Object.entries(spec.fields)) {
        out[key] = norm(sub, src[key], errors, where ? `${where} › ${key}` : key, ctx);
      }
      return out;
    }
    default: throw new Error(`Schéma inconnu : ${spec.t}`);
  }
}

const defaultCtx = () => {
  const cache = new Map();
  const read = (rel) => {
    if (!cache.has(rel)) {
      let buf = null;
      for (const file of mediaCandidates(rel)) {
        try { buf = readFileSync(file); break; } catch { /* essai suivant */ }
      }
      cache.set(rel, buf);
    }
    return cache.get(rel);
  };
  return {
    exists: (rel) => read(rel) !== null,
    dims: (rel) => { const b = read(rel); return b ? imageSize(b) : null; }
  };
};

/**
 * @returns {{content: object, errors: string[]}}
 * Les erreurs sont des corrections appliquées (troncature, lien refusé…) :
 * l'API les renvoie à l'utilisateur pour qu'il sache ce qui a été modifié.
 */
export function normalizeContent(raw, ctx = defaultCtx()) {
  const errors = [];
  const content = norm(SCHEMA, raw, errors, '', ctx);
  content.version = 1;
  // Les catégories référencées par les cartes doivent exister.
  const ids = new Set(content.projects.categories.map((c) => c.id));
  content.projects.cards.forEach((card, i) => {
    if (!ids.has(card.category)) {
      errors.push(`Projet #${i + 1} (« ${card.title} ») : catégorie inconnue, ajoutez-la dans la liste des catégories.`);
    }
  });
  return { content, errors };
}

export { defaultCtx };
