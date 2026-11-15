/* Moteur de rendu : content.json  →  index.html.
   Le balisage reproduit celui du site d'origine (mêmes classes, même
   structure) : seuls les textes, liens et images viennent des données. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, esc, inline, pad2, isExternal } from './util.mjs';
import { LANG_COLORS } from './langs.mjs';

const SPRITE = readFileSync(join(ROOT, 'backend', 'templates', 'sprite.html'), 'utf8').trimEnd();

const THEME_SCRIPT = `<script>
  // Applique le thème avant le premier rendu pour éviter tout flash.
  (function () {
    var root = document.documentElement;
    root.classList.remove('no-js');
    root.classList.add('js');
    var stored = null;
    try { stored = localStorage.getItem('theme'); } catch (e) {}
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    root.dataset.theme = stored || (prefersLight ? 'light' : 'dark');
  })();
</script>`;

const ICON = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const attr = (name, value) => (value ? ` ${name}="${esc(value)}"` : '');
const ext = (href) => (isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '');

function tags(items, small) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return '';
  return `<ul class="tags${small ? ' tags--sm' : ''}">${list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

function image(im, cls, loading, extra = '') {
  if (!im || !im.src) return '';
  const size = im.width && im.height ? ` width="${im.width}" height="${im.height}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(im.src)}"${size} loading="${loading}" decoding="async"${extra}\n             alt="${esc(im.alt)}">`;
}

function head(h, { lede = true } = {}) {
  return [
    `<p class="eyebrow"><span class="eyebrow__num">${esc(h.num)}</span> ${esc(h.eyebrow)}</p>`,
    h.title ? `<h2 class="section__title">${esc(h.title)}</h2>` : '',
    lede && h.lede ? `<p class="section__lede">\n        ${inline(h.lede)}\n      </p>` : ''
  ].filter(Boolean);
}

/* ---------- <head> ---------- */
function renderHead(c, { base }) {
  const s = c.site;
  const ogImage = esc(s.ogImage);
  return `<head>
<meta charset="utf-8">${base ? '\n<base href="/">' : ''}
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.description)}">
<meta name="author" content="${esc(s.author)}">
<meta name="theme-color" content="#0b0908" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#faf6f0" media="(prefers-color-scheme: light)">${s.canonical ? `\n<link rel="canonical" href="${esc(s.canonical)}">` : ''}
<link rel="icon" href="${esc(s.favicon)}" type="image/svg+xml">
<link rel="apple-touch-icon" href="${esc(s.favicon)}">

<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(s.ogTitle)}">
<meta property="og:description" content="${esc(s.ogDescription)}">${s.canonical ? `\n<meta property="og:url" content="${esc(s.canonical)}">` : ''}
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(s.ogImageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(s.ogTitle)}">
<meta name="twitter:description" content="${esc(s.ogDescription)}">
<meta name="twitter:image" content="${ogImage}">

${THEME_SCRIPT}
<link rel="stylesheet" href="assets/css/style.css">
</head>`;
}

/* ---------- Navigation ---------- */
function renderNav(c) {
  const links = c.nav.links.map((l) => `      <a href="${esc(l.href)}">${esc(l.label)}</a>`).join('\n');
  return `<header class="nav" id="nav">
  <div class="nav__inner">
    <a class="brand" href="#haut" aria-label="${esc(c.site.brandAria)}">
      <span class="brand__mark" aria-hidden="true">${esc(c.site.brandMark)}</span>
      <span class="brand__name">${esc(c.site.brandName)}</span>
    </a>

    <nav class="nav__links" id="menu" aria-label="Navigation principale">
${links}
    </nav>

    <div class="nav__actions">
      <button class="icon-btn" id="theme-toggle" type="button" aria-label="Basculer en thème clair" aria-pressed="false">
        <svg class="i-sun" aria-hidden="true"><use href="#i-sun"/></svg>
        <svg class="i-moon" aria-hidden="true"><use href="#i-moon"/></svg>
      </button>
      <a class="btn btn--primary btn--sm nav__cta" href="#contact">${esc(c.nav.cta)}</a>
      <button class="icon-btn nav__burger" id="burger" type="button" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="menu">
        <svg class="i-menu" aria-hidden="true"><use href="#i-menu"/></svg>
        <svg class="i-close" aria-hidden="true"><use href="#i-close"/></svg>
      </button>
    </div>
  </div>
</header>`;
}

/* ---------- Hero ---------- */
function consoleLine(l) {
  if (l.kind === 'cmd') {
    const arg = l.arg ? ` <span class="arg">${esc(l.arg)}</span>` : '';
    return `          <p><span class="p">$</span> <span class="cmd">${esc(l.cmd)}</span>${arg}</p>`;
  }
  return `          <p class="out">${inline(l.text)}</p>`;
}

function renderHero(c, site) {
  const h = c.hero;
  const facts = h.facts.map((f) => `        <div>
          <dt>${esc(f.label)}</dt>
          <dd>${esc(f.value)}</dd>
        </div>`).join('\n');
  const chips = h.chips.length
    ? `\n      <ul class="hero__chips" aria-label="Points forts">\n${h.chips.map((t) => `        <li>${esc(t)}</li>`).join('\n')}\n      </ul>`
    : '';
  return `<section class="hero" id="haut">
  <div class="hero__glow" aria-hidden="true"></div>
  <div class="hero__spot" aria-hidden="true"></div>

  <div class="container hero__inner">
    <div class="hero__copy">
      <p class="badge">
        <span class="badge__dot" aria-hidden="true"></span>
        ${esc(h.badge)}
      </p>

      <h1 class="hero__title">
        ${inline(h.title)}
      </h1>

      <p class="hero__lede">
        ${inline(h.lede)}
      </p>

      <div class="hero__cta">
        <a class="btn btn--primary" href="${esc(h.primary.href)}"${ext(h.primary.href)}>
          ${esc(h.primary.label)}
          ${ICON('i-arrow')}
        </a>
        <a class="btn btn--ghost" href="${esc(h.secondary.href)}"${ext(h.secondary.href)}>${esc(h.secondary.label)}</a>${site.cvFile ? `
        <a class="btn btn--ghost" href="${esc(site.cvFile)}" download="${esc(site.cvDownloadName)}">
          ${ICON('i-download')}
          ${esc(h.cvLabel)}
        </a>` : ''}
      </div>

      <dl class="hero__facts">
${facts}
      </dl>
    </div>

    <div class="hero__panel">
      <div class="console" role="img" aria-label="${esc(h.console.aria)}">
        <div class="console__bar">
          <span class="console__dot"></span>
          <span class="console__dot"></span>
          <span class="console__dot"></span>
          <em>${esc(h.console.title)}</em>
        </div>
        <div class="console__body">
${h.console.lines.map(consoleLine).join('\n')}
        </div>
      </div>
${chips}
    </div>
  </div>
</section>`;
}

/* ---------- Bandeau ---------- */
function renderMarquee(c) {
  if (!c.marquee.length) return '';
  const group = `    <span class="marquee__group">\n      ${c.marquee.map((t) => `<span>${esc(t)}</span>`).join('')}\n    </span>`;
  return `<div class="marquee" aria-hidden="true">
  <div class="marquee__track">
${group}
${group}
  </div>
</div>`;
}

/* ---------- Projets ---------- */
function linkArrow(l) {
  return `<a class="link-arrow" href="${esc(l.url)}"${ext(l.url)}>
              ${esc(l.label)} ${ICON('i-arrow-up')}
            </a>`;
}

function renderFeatured(f) {
  if (!f.enabled) return '';
  const phone = image(f.phone, 'featured__phone', 'eager');
  const bullets = f.bullets.length
    ? `\n        <ul class="feature-list">\n${f.bullets.map((b) => `          <li>${inline(b)}</li>`).join('\n')}\n        </ul>`
    : '';
  const note = f.note
    ? `\n        <p class="featured__note">
          <span class="lock" aria-hidden="true">◆</span>
          ${esc(f.note)}${f.noteLinkLabel ? `
          <a href="${esc(f.noteLinkHref)}"${ext(f.noteLinkHref)}>${esc(f.noteLinkLabel)}</a>` : ''}
        </p>`
    : '';
  return `    <article class="featured reveal">
      <div class="featured__media">
        ${image(f.image, 'featured__shot', 'eager')}${phone ? `\n        ${phone}` : ''}
      </div>

      <div class="featured__body">
        <p class="eyebrow">${esc(f.eyebrow)}</p>
        <h3 class="featured__title">${esc(f.title)}</h3>
        <p class="featured__desc">
          ${inline(f.description)}
        </p>${bullets}
        ${tags(f.tags, false)}${note}
      </div>
    </article>
`;
}

function renderCard(card, index) {
  const media = card.image && card.image.src
    ? `\n        <figure class="card__media">\n          ${image(card.image, '', 'lazy')}\n        </figure>`
    : '';
  const hasFoot = card.links.length || card.muted || card.kind;
  const foot = hasFoot
    ? `\n        <div class="card__foot">${card.links.length
      ? `\n          <div class="card__links">\n            ${card.links.map(linkArrow).join('\n            ')}\n          </div>` : ''}${card.muted
      ? `\n          <span class="muted">${esc(card.muted)}</span>` : ''}${card.kind
      ? `\n          <span class="card__kind">${esc(card.kind)}</span>` : ''}
        </div>`
    : '';
  return `      <article class="card reveal" data-cat="${esc(card.category)}">${media}
        <div class="card__top">
          <span class="card__index">${pad2(index)}</span>
          <span class="chip">${esc(card.chip)}</span>
        </div>
        <h3 class="card__title">${esc(card.title)}${card.sub ? ` <span class="card__sub">${esc(card.sub)}</span>` : ''}</h3>
        <p class="card__desc">
          ${inline(card.description)}
        </p>
        ${tags(card.tags, true)}${foot}
      </article>`;
}

function renderProjects(c) {
  const p = c.projects;
  const first = p.featured.enabled ? 2 : 1;
  const total = p.cards.length;
  const filters = [
    `        <button class="filter is-active" type="button" data-filter="all" aria-pressed="true">${esc(p.allLabel)} <span>${total}</span></button>`,
    ...p.categories.map((cat) => {
      const n = p.cards.filter((card) => card.category === cat.id).length;
      return `        <button class="filter" type="button" data-filter="${esc(cat.id)}" aria-pressed="false">${esc(cat.label)} <span>${n}</span></button>`;
    })
  ].join('\n');

  return `<section class="section" id="projets">
  <div class="container">
    <div class="section__head reveal">
      ${head(p.head).join('\n      ')}
    </div>

${renderFeatured(p.featured)}
    <div class="projects__bar reveal">
      <h3 class="projects__subtitle">${esc(p.subtitle)}</h3>
      <div class="filters" role="group" aria-label="Filtrer les projets par famille">
${filters}
      </div>
    </div>

    <div class="grid" id="projects-grid">

${p.cards.map((card, i) => renderCard(card, first + i)).join('\n\n')}

    </div>

    <p class="empty" id="projects-empty" hidden>${esc(p.emptyText)}</p>
  </div>
</section>`;
}

/* ---------- À propos ---------- */
function renderAbout(c) {
  const a = c.about;
  const skills = a.skills.map((s) => `          <div class="skills__row">
            <dt>${esc(s.label)}</dt>
            <dd>${esc(s.value)}</dd>
          </div>`).join('\n');
  const stats = a.stats.map((s) => {
    const num = s.auto ? pad2(c.github.stats.count) : s.num;
    return `          <div class="stat">
            <span class="stat__num"${s.auto ? ' data-repo-count' : ''}>${esc(num)}</span>
            <span class="stat__label">${esc(s.label)}</span>
          </div>`;
  }).join('\n');
  return `<section class="section section--alt" id="apropos">
  <div class="container">
    <div class="section__head reveal">
      ${head(a.head, { lede: false }).join('\n      ')}
    </div>

    <div class="about">
      <div class="about__text reveal">
        <p class="about__lead">
          ${inline(a.lead)}
        </p>${a.body ? `
        <p>
          ${inline(a.body)}
        </p>` : ''}

        <dl class="skills">
${skills}
        </dl>
      </div>

      <aside class="about__side reveal">
        <div class="id-card">
          <div class="id-card__mark" aria-hidden="true">${esc(a.card.mark)}</div>
          <div>
            <p class="id-card__name">${esc(a.card.name)}</p>
            <p class="id-card__role">${esc(a.card.role)}</p>
          </div>
          <p class="id-card__where">
            ${ICON('i-pin')}
            ${esc(a.card.where)}
          </p>
          <p class="id-card__state">
            <span class="badge__dot" aria-hidden="true"></span>
            ${esc(a.card.state)}
          </p>
        </div>

        <div class="stats">
${stats}
        </div>
      </aside>
    </div>
  </div>
</section>`;
}

/* ---------- Parcours ---------- */
function renderTimeline(c) {
  const t = c.timeline;
  const items = t.items.map((it) => `      <li class="reveal">
        <p class="timeline__year">${esc(it.year)}</p>
        <div class="timeline__body">
          <h3>${esc(it.title)}</h3>
          <p>
            ${inline(it.description)}
          </p>
          ${tags(it.tags, true)}
        </div>
      </li>`).join('\n');
  return `<section class="section" id="parcours">
  <div class="container">
    <div class="section__head reveal">
      ${head(t.head, { lede: false }).join('\n      ')}
    </div>

    <ol class="timeline">
${items}
    </ol>
  </div>
</section>`;
}

/* ---------- GitHub ---------- */
function renderRepo(r) {
  const color = r.color || LANG_COLORS[r.language] || 'var(--ink-3)';
  const meta = [
    r.updated ? `<span>Mis à jour en ${esc(r.updated)}</span>` : '',
    r.homepage ? `<a href="${esc(r.homepage)}"${ext(r.homepage)}>Site en ligne</a>` : ''
  ].filter(Boolean).join('\n          ');
  return `      <li class="repo reveal">
        <div class="repo__head">
          <a class="repo__name" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">
            ${esc(r.name)} ${ICON('i-arrow-up')}
          </a>
          <span class="lang"><i style="--c:${esc(color)}"></i>${esc(r.language || '—')}</span>
        </div>
        <p class="repo__desc">${esc(r.description || 'Dépôt public sans description.')}</p>
        <div class="repo__meta">
          ${meta}
        </div>
      </li>`;
}

function renderGithub(c) {
  const g = c.github;
  const { count, languages, since } = g.stats;
  const s = (n) => (n > 1 ? 's' : '');
  const repoBlock = g.repos.length
    ? `    <ol class="repos" id="repos">\n${g.repos.map(renderRepo).join('\n')}\n    </ol>`
    : '    <p class="empty">Aucun dépôt public pour ce compte.</p>';
  return `<section class="section section--alt" id="github">
  <div class="container">
    <div class="section__head section__head--row reveal">
      <div>
        ${head(g.head).join('\n        ')}
      </div>${g.buttonUrl ? `
      <a class="btn btn--ghost btn--sm" href="${esc(g.buttonUrl)}" target="_blank" rel="noopener noreferrer">
        ${ICON('i-github')}
        ${esc(g.buttonLabel)}
      </a>` : ''}
    </div>

    <!-- BEGIN:GITHUB-STATS — régénéré depuis data/content.json -->
    <div class="gh-stats reveal">
      <p><strong>${count}</strong> dépôt${s(count)} public${s(count)}</p>
      <p><strong>${languages}</strong> langage${s(languages)}</p>${since ? `
      <p>compte depuis <strong>${esc(since)}</strong></p>` : ''}
    </div>
    <!-- END:GITHUB-STATS -->

    <!-- BEGIN:GITHUB-REPOS — régénéré depuis data/content.json -->
${repoBlock}
    <!-- END:GITHUB-REPOS -->${g.note ? `

    <p class="gh-note">
      ${ICON('i-code')}
      ${inline(g.note)}
    </p>` : ''}
  </div>
</section>`;
}

/* ---------- Contact & pied de page ---------- */
function renderContact(c, site) {
  const k = c.contact;
  return `<section class="section section--contact" id="contact">
  <div class="container">
    <div class="contact reveal">
      <p class="eyebrow"><span class="eyebrow__num">${esc(k.head.num)}</span> ${esc(k.head.eyebrow)}</p>
      <h2 class="contact__title">
        ${inline(k.title)}
      </h2>
      <p class="contact__lede">
        ${inline(k.lede)}
      </p>

      <div class="contact__actions">${k.email ? `
        <a class="btn btn--primary btn--lg" href="mailto:${esc(k.email)}">
          ${ICON('i-mail')}
          ${esc(k.email)}
        </a>
        <button class="btn btn--ghost btn--lg" type="button" data-copy="${esc(k.email)}">
          ${ICON('i-copy')}
          <span>${esc(k.copyLabel)}</span>
        </button>` : ''}${site.cvFile ? `
        <a class="btn btn--ghost btn--lg" href="${esc(site.cvFile)}" download="${esc(site.cvDownloadName)}">
          ${ICON('i-download')}
          ${esc(k.cvLabel)}
        </a>` : ''}
      </div>

      <ul class="contact__links">${k.githubUrl ? `
        <li>
          <a href="${esc(k.githubUrl)}" target="_blank" rel="noopener noreferrer">
            ${ICON('i-github')}
            ${esc(k.githubLabel)}
          </a>
        </li>` : ''}${k.location ? `
        <li>
          <span>
            ${ICON('i-pin')}
            ${esc(k.location)}
          </span>
        </li>` : ''}
      </ul>
    </div>
  </div>
</section>`;
}

function renderFooter(c) {
  const f = c.footer;
  return `<footer class="footer">
  <div class="container footer__inner">
    <p class="footer__brand">
      <span class="brand__mark brand__mark--sm" aria-hidden="true">${esc(f.mark)}</span>
      ${esc(f.name)}
    </p>
    <p class="footer__note">${esc(f.note)}<span id="year">${new Date().getFullYear()}</span></p>
    <a class="footer__top" href="#haut">
      ${esc(f.topLabel)}
      ${ICON('i-arrow')}
    </a>
  </div>
</footer>`;
}

/**
 * @param {object} c contenu normalisé
 * @param {{base?: boolean}} [opts] base : ajoute <base href="/"> (aperçu dans l'admin)
 */
export function renderSite(c, opts = {}) {
  const parts = [
    `<!doctype html>\n<html lang="${esc(c.site.lang)}" data-theme="dark" class="no-js">`,
    renderHead(c, { base: Boolean(opts.base) }),
    '<body>\n',
    '<a class="skip" href="#contenu">Aller au contenu</a>\n<div class="grain" aria-hidden="true"></div>\n',
    '<!-- ===================== Icônes ===================== -->',
    SPRITE + '\n',
    '<!-- ===================== Navigation ===================== -->',
    renderNav(c) + '\n',
    '<main id="contenu">\n',
    '<!-- ===================== Hero ===================== -->',
    renderHero(c, c.site) + '\n',
    '<!-- ===================== Bandeau technos ===================== -->',
    renderMarquee(c) + '\n',
    '<!-- ===================== Projets ===================== -->',
    renderProjects(c) + '\n',
    '<!-- ===================== À propos ===================== -->',
    renderAbout(c) + '\n',
    '<!-- ===================== Parcours ===================== -->',
    renderTimeline(c) + '\n',
    '<!-- ===================== GitHub ===================== -->',
    renderGithub(c) + '\n',
    '<!-- ===================== Contact ===================== -->',
    renderContact(c, c.site) + '\n',
    '</main>\n',
    renderFooter(c) + '\n',
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>\n',
    '<script src="assets/js/main.js" defer></script>\n</body>\n</html>\n'
  ];
  return parts.join('\n');
}
