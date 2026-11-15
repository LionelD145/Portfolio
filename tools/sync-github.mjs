#!/usr/bin/env node
/**
 * Synchronise la section « Dépôts publics » du portfolio avec GitHub.
 *
 *   node tools/sync-github.mjs                     → pseudo par défaut
 *   node tools/sync-github.mjs --user autre        → autre compte
 *   node tools/sync-github.mjs --forks             → inclure les forks
 *   node tools/sync-github.mjs --archived          → inclure les dépôts archivés
 *   node tools/sync-github.mjs --dry               → afficher sans écrire
 *
 * Pour les dépôts privés et un quota plus large, exporter un jeton
 * (aucun scope d'écriture nécessaire, « public_repo » suffit ou lecture seule) :
 *
 *   PowerShell :  $env:GITHUB_TOKEN = "ghp_xxx"   puis  npm run sync
 *   bash       :  GITHUB_TOKEN=ghp_xxx npm run sync
 *
 * Le jeton n'est jamais écrit dans le site.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* Depuis l'ajout de l'administration, data/content.json est la source de vérité et
   index.html en est régénéré : une écriture directe ici serait écrasée au prochain
   enregistrement. On bloque donc (sauf --force) et on renvoie vers l'admin. */
if (existsSync(fileURLToPath(new URL('../data/content.json', import.meta.url))) && !process.argv.includes('--force') && !process.argv.includes('--dry')) {
  console.error('data/content.json existe : le contenu est géré par l\'administration.\n'
    + 'Utilisez  Administration → GitHub → « Importer depuis GitHub », puis « Enregistrer et publier ».\n'
    + '(--force pour écrire quand même dans index.html — la modification sera perdue au prochain enregistrement.)');
  process.exit(1);
}

const DEFAULT_USER = 'LionelD145';
const HTML_PATH = fileURLToPath(new URL('../index.html', import.meta.url));

/* ---------- Arguments ---------- */
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const USER = String(value('user', process.env.GITHUB_USER || DEFAULT_USER)).replace(/^@/, '');
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const INCLUDE_FORKS = flag('forks');
const INCLUDE_ARCHIVED = flag('archived');
const DRY = flag('dry');

/* ---------- Couleurs de langages ---------- */
const LANG_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Python: '#3572A5',
  PHP: '#4F5D95',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  Go: '#00ADD8',
  Rust: '#dea584',
  Ruby: '#701516',
  Shell: '#89e051',
  PowerShell: '#012456',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  Dart: '#00B4AB',
  Kotlin: '#A97BFF',
  Swift: '#F05138',
  Lua: '#000080',
  Dockerfile: '#384d54',
  Makefile: '#427819'
};

const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const frenchDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch {
    return '—';
  }
};

/* ---------- API ---------- */
const headers = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'portfolio-sync-script'
};
if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;

async function api(path) {
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  const res = await fetch(url, { headers });

  if (res.status === 404) {
    throw new Error(`Compte ou ressource introuvable : ${url}\nVérifiez le pseudo « ${USER} ».`);
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    throw new Error(
      'Quota GitHub atteint' + (remaining !== null ? ` (restant : ${remaining})` : '') +
      (reset ? ` — réinitialisation : ${new Date(Number(reset) * 1000).toLocaleString('fr-FR')}` : '') +
      '\n→ Relancez avec un jeton : $env:GITHUB_TOKEN = "ghp_..."'
    );
  }
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status} pour ${url}`);
  return res.json();
}

async function main() {
  console.log(`Synchronisation de @${USER}${TOKEN ? ' (jeton détecté)' : ' (sans jeton — quota public 60/h)'}`);

  const profile = await api(`/users/${USER}`);

  const repos = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await api(`/users/${USER}/repos?per_page=100&page=${page}&sort=pushed&direction=desc`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const kept = repos
    .filter((r) => (INCLUDE_FORKS || !r.fork) && (INCLUDE_ARCHIVED || !r.archived))
    .sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));

  const languages = [...new Set(kept.map((r) => r.language).filter(Boolean))];
  const publicCount = Number(profile.public_repos ?? kept.length);

  /* ---------- Blocs HTML ---------- */
  const stats = [
    '    <div class="gh-stats reveal">',
    `      <p><strong>${publicCount}</strong> dépôt${publicCount > 1 ? 's' : ''} public${publicCount > 1 ? 's' : ''}</p>`,
    `      <p><strong>${languages.length}</strong> langage${languages.length > 1 ? 's' : ''}</p>`,
    `      <p>compte depuis <strong>${frenchDate(profile.created_at)}</strong></p>`,
    '    </div>'
  ].join('\n');

  const repoItems = kept.map((repo) => {
    const lang = repo.language;
    const color = LANG_COLORS[lang] || 'var(--ink-3)';
    const langLabel = lang || '—';
    const homepage = repo.homepage && repo.homepage.trim() && !repo.homepage.includes('github.com/LionelD145')
      ? repo.homepage.trim()
      : '';

    const meta = [
      `<span>Mis à jour en ${frenchDate(repo.pushed_at || repo.updated_at)}</span>`,
      homepage
        ? `<a href="${escapeHtml(homepage)}" target="_blank" rel="noopener noreferrer">Site en ligne</a>`
        : ''
    ].filter(Boolean).join('\n            ');

    return [
      '      <li class="repo reveal">',
      '        <div class="repo__head">',
      `          <a class="repo__name" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener noreferrer">`,
      `            ${escapeHtml(repo.name)} <svg aria-hidden="true"><use href="#i-arrow-up"/></svg>`,
      '          </a>',
      `          <span class="lang"><i style="--c:${color}"></i>${escapeHtml(langLabel)}</span>`,
      '        </div>',
      `        <p class="repo__desc">${escapeHtml((repo.description || 'Dépôt public sans description.').trim())}</p>`,
      '        <div class="repo__meta">',
      `            ${meta}`,
      '        </div>',
      '      </li>'
    ].join('\n');
  });

  const repoList = kept.length
    ? ['    <ol class="repos" id="repos">', ...repoItems, '    </ol>'].join('\n')
    : '    <p class="empty">Aucun dépôt public pour ce compte.</p>';

  /* ---------- Injection ---------- */
  let html = await readFile(HTML_PATH, 'utf8');

  const inject = (source, name, content) => {
    const pattern = new RegExp(`(<!-- BEGIN:${name}[^>]*-->)[\\s\\S]*?(<!-- END:${name} -->)`);
    if (!pattern.test(source)) throw new Error(`Repère « ${name} » absent de index.html`);
    return source.replace(pattern, (_, start, end) => `${start}\n${content}\n${end}`);
  };

  html = inject(html, 'GITHUB-STATS', stats);
  html = inject(html, 'GITHUB-REPOS', repoList);
  html = html.replace(/(data-repo-count>)\s*\d+\s*(<)/, `$1${String(publicCount).padStart(2, '0')}$2`);

  if (DRY) {
    console.log('\n--- Aperçu (aucune écriture) ---\n');
    console.log(repoList);
    return;
  }

  await writeFile(HTML_PATH, html, 'utf8');
  console.log(`\n${kept.length} dépôt(s) écrit(s) dans index.html`);
  console.log(`Langages : ${languages.join(', ') || 'aucun'}`);
  console.log('Ouvrez ou rechargez le site pour voir le résultat.');
}

main().catch((err) => {
  console.error(`\nÉchec de la synchronisation :\n${err.message}`);
  process.exitCode = 1;
});
