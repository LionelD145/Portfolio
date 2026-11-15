import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolate } from './helpers.mjs';

isolate();
const { normalizeContent } = await import('../lib/schema.mjs');
const { renderSite } = await import('../lib/render.mjs');
const { inline, esc } = await import('../lib/util.mjs');
const seed = JSON.parse(readFileSync(new URL('../seed/content.default.json', import.meta.url), 'utf8'));

const flatten = (html) => html
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s+/g, ' ')
  .replace(/> /g, '>').replace(/ </g, '<')
  .replace(/<span id="year">\d+<\/span>/, '<span id="year"></span>')
  .trim();

test('le contenu par défaut reproduit exactement le site d\'origine', () => {
  const { content, errors } = normalizeContent(seed);
  assert.deepEqual(errors, []);
  const original = readFileSync(fileURLToPath(new URL('./fixtures/original-index.html', import.meta.url)), 'utf8');
  assert.equal(flatten(renderSite(content)), flatten(original));
});

test('toute donnée saisie est échappée (pas d\'injection HTML)', () => {
  const evil = structuredClone(seed);
  evil.site.title = '"><script>alert(1)</script>';
  evil.hero.badge = '<img src=x onerror=alert(1)>';
  evil.hero.title = 'Salut {hl|<b>gras</b>} {br}';
  evil.projects.cards[0].title = '</h3><script>x</script>';
  const html = renderSite(normalizeContent(evil).content);
  assert.ok(!/<script>alert|<img src=x|<script>x<|<b>gras/.test(html));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<span class="hl">&lt;b&gt;gras&lt;\/b&gt;<\/span>/);
});

test('les liens dangereux et chemins hors médias sont refusés', () => {
  const evil = structuredClone(seed);
  evil.hero.primary.href = 'javascript:alert(1)';
  evil.projects.cards[0].links[0].url = 'data:text/html,<script>1</script>';
  evil.site.ogImage = '../data/auth.json';
  evil.site.cvFile = 'assets/docs/../../data/secret.key';
  evil.projects.featured.image.src = '/etc/passwd';
  const { content, errors } = normalizeContent(evil);
  assert.equal(content.hero.primary.href, '');
  assert.equal(content.projects.cards[0].links[0].url, '');
  assert.equal(content.site.ogImage, '');
  assert.equal(content.site.cvFile, '');
  assert.equal(content.projects.featured.image.src, '');
  assert.ok(errors.length >= 5);
});

test('les liens légitimes sont conservés', () => {
  const ok = structuredClone(seed);
  ok.hero.primary.href = '#projets';
  ok.hero.secondary.href = 'mailto:a@b.co';
  ok.projects.cards[0].links[0].url = 'https://exemple.ci/page?a=1&b=2#x';
  const { content, errors } = normalizeContent(ok);
  assert.deepEqual(errors, []);
  assert.equal(content.hero.secondary.href, 'mailto:a@b.co');
  assert.equal(content.projects.cards[0].links[0].url, 'https://exemple.ci/page?a=1&b=2#x');
});

test('mini-balisage et espaces insécables', () => {
  assert.equal(inline('a {hl|b} c{br}d'), 'a <span class="hl">b</span> c<br>d');
  assert.equal(esc('a b & "c"'), 'a&nbsp;b &amp; &quot;c&quot;');
});

test('compteurs, numérotation et options de masquage', () => {
  const c = structuredClone(seed);
  c.projects.cards.pop();
  c.projects.featured.enabled = false;
  c.site.cvFile = '';
  c.github.note = '';
  const html = renderSite(normalizeContent(c).content);
  assert.match(html, /data-filter="all"[^>]*>Tout <span>3<\/span>/);
  assert.match(html, /<span class="card__index">01<\/span>/);
  assert.ok(!html.includes('class="featured reveal"'));
  assert.ok(!html.includes('download='));
  assert.ok(!html.includes('gh-note'));
});

test('les limites de taille et de nombre sont appliquées', () => {
  const c = structuredClone(seed);
  c.hero.badge = 'x'.repeat(5000);
  c.marquee = Array.from({ length: 500 }, () => 'a');
  const { content, errors } = normalizeContent(c);
  assert.equal(content.hero.badge.length, 120);
  assert.equal(content.marquee.length, 40);
  assert.equal(errors.length, 2);
});
