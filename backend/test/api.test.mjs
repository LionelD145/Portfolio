import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { isolate, Client, PNG_1x1 } from './helpers.mjs';

const dir = isolate();
const { start } = await import('../server.mjs');
let srv, base, admin;

before(async () => {
  const s = await start({ port: 0, quiet: true });
  srv = s.server; base = `http://127.0.0.1:${s.port}`;
  admin = new Client(base);
});
after(() => srv.close());

const fresh = () => new Client(base);
const indexHtml = () => readFileSync(process.env.INDEX_PATH, 'utf8');

test('site public servi, fichiers internes introuvables', async () => {
  const c = fresh();
  assert.equal((await c.req('GET', '/')).status, 200);
  assert.match((await c.req('GET', '/')).text, /<title>Angel Ionel Digbeu/);
  assert.equal((await c.req('GET', '/assets/css/style.css')).status, 200);
  for (const p of ['/data/content.json', '/data/auth.json', '/backend/server.mjs', '/package.json', '/.env',
    '/assets/../data/content.json', '/assets/%2e%2e/data/content.json', '/assets/%2e%2e%2fdata%2fauth.json',
    '/assets/img/', '/assets/%00', '/tools/serve.mjs']) {
    const r = await c.req('GET', p);
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!r.text.includes('"hash"'), p);
  }
});

test('page d\'administration : CSP stricte, pas de cadre', async () => {
  const r = await fresh().req('GET', '/admin/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await fresh().req('GET', '/admin/../server.mjs')).status, 404);
});

test('l\'API exige une connexion', async () => {
  const c = fresh();
  for (const [m, p] of [['GET', '/api/content'], ['GET', '/api/media'], ['GET', '/api/backups'], ['GET', '/admin/preview']]) {
    assert.equal((await c.req(m, p)).status, 401, `${m} ${p}`);
  }
  assert.equal((await c.req('PUT', '/api/content', { content: {} })).status, 401);
  assert.equal((await c.req('POST', '/api/media?kind=image&name=a.png', undefined, { raw: PNG_1x1 })).status, 401);
});

test('protection CSRF : en-tête et origine obligatoires', async () => {
  const c = fresh();
  assert.equal((await c.req('POST', '/api/login', { password: 'x' }, { csrf: false })).status, 403);
  const bad = await c.req('POST', '/api/login', { password: 'x' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403);
});

test('connexion : cookie sécurisé, mauvais mot de passe refusé, blocage après 5 échecs', async () => {
  const c = fresh();
  assert.equal((await c.login('mauvais')).status, 401);
  const ok = await c.login();
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  assert.equal((await c.req('GET', '/api/session')).json.authenticated, true);

  const brute = fresh();
  for (let i = 0; i < 5; i += 1) assert.equal((await brute.login('nope' + i)).status, 401);
  const locked = await brute.login();               // même le bon mot de passe est refusé
  assert.equal(locked.status, 429);
  assert.ok(locked.headers.get('retry-after'));
});

test('cookie falsifié ou expiré refusé', async () => {
  const c = fresh();
  c.cookie = 'portfolio_admin=9999999999.env-xx.AAAA';
  assert.equal((await c.req('GET', '/api/content')).status, 401);
});

test('modification du contenu : publication, sauvegarde, concurrence, restauration', async () => {
  assert.equal((await admin.login()).status, 200);
  const first = (await admin.req('GET', '/api/content')).json;
  const edited = structuredClone(first.content);
  edited.hero.badge = 'Disponible dès demain · Yamoussoukro';
  edited.projects.cards[0].title = 'AE Training V2';

  const saved = await admin.req('PUT', '/api/content', { content: edited, rev: first.rev });
  assert.equal(saved.status, 200);
  assert.notEqual(saved.json.rev, first.rev);
  assert.match(indexHtml(), /Disponible dès demain · Yamoussoukro/);
  assert.match(indexHtml(), /AE Training V2/);

  // ancien rev → 409, rien n'est écrasé
  const stale = await admin.req('PUT', '/api/content', { content: first.content, rev: first.rev });
  assert.equal(stale.status, 409);
  assert.match(indexHtml(), /AE Training V2/);

  const backups = (await admin.req('GET', '/api/backups')).json.backups;
  assert.equal(backups.length, 1);
  const restored = await admin.req('POST', '/api/backups/restore', { id: backups[0].id });
  assert.equal(restored.status, 200);
  assert.match(indexHtml(), /Disponible pour des missions · Abidjan/);
  assert.equal((await admin.req('POST', '/api/backups/restore', { id: '../../etc/passwd' })).status, 404);
});

test('contenu hostile : échappé et corrigé, jamais rendu tel quel', async () => {
  const cur = (await admin.req('GET', '/api/content')).json;
  const evil = structuredClone(cur.content);
  evil.about.lead = '<script>alert(document.cookie)</script>';
  evil.contact.githubUrl = 'javascript:alert(1)';
  const r = await admin.req('PUT', '/api/content', { content: evil, rev: cur.rev });
  assert.equal(r.status, 200);
  assert.ok(r.json.warnings.length >= 1);
  assert.ok(!indexHtml().includes('<script>alert('));
  assert.ok(!indexHtml().includes('javascript:'));
});

test('corps invalide ou trop gros', async () => {
  const c = fresh(); await c.login();
  const r = await fetch(base + '/api/content', { method: 'PUT', headers: { cookie: c.cookie, 'x-forwarded-for': c.ip, 'x-requested-with': 'portfolio-admin', 'content-type': 'application/json' }, body: '{pas du json' });
  assert.equal(r.status, 400);
  const big = await fetch(base + '/api/content', { method: 'PUT', headers: { cookie: c.cookie, 'x-forwarded-for': c.ip, 'x-requested-with': 'portfolio-admin', 'content-type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024) });
  assert.equal(big.status, 413);
});

test('envoi de médias : vérification du contenu réel du fichier', async () => {
  const up = await admin.req('POST', '/api/media?kind=image&name=Ma%20Photo%20%C3%A9t%C3%A9.png', undefined, { raw: PNG_1x1 });
  assert.equal(up.status, 201);
  assert.match(up.json.path, /^assets\/img\/ma-photo-ete\.png$/);
  assert.equal(up.json.width, 1);
  assert.equal((await fresh().req('GET', '/' + up.json.path)).status, 200);

  // même nom → pas d'écrasement
  const again = await admin.req('POST', '/api/media?kind=image&name=Ma%20Photo%20%C3%A9t%C3%A9.png', undefined, { raw: PNG_1x1 });
  assert.notEqual(again.json.path, up.json.path);

  const disguised = [
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['HTML', Buffer.from('<html><script>alert(1)</script></html>  padding padding')],
    ['exécutable', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00')]
  ];
  for (const [label, buf] of disguised) {
    const r = await admin.req('POST', '/api/media?kind=image&name=photo.png', undefined, { raw: buf });
    assert.equal(r.status, 415, label);
  }
  assert.equal((await admin.req('POST', '/api/media?kind=doc&name=cv.pdf', undefined, { raw: PNG_1x1 })).status, 415);
  const pdf = await admin.req('POST', '/api/media?kind=doc&name=../../cv.pdf', undefined, { raw: Buffer.from('%PDF-1.4\n%fake test\n1 0 obj<<>>endobj\n') });
  assert.equal(pdf.status, 201);
  assert.match(pdf.json.path, /^assets\/docs\/cv[a-z0-9-]*\.pdf$/);

  const huge = await admin.req('POST', '/api/media?kind=image&name=gros.png', undefined, { raw: Buffer.concat([PNG_1x1, Buffer.alloc(9 * 1024 * 1024)]) });
  assert.equal(huge.status, 413);
});

test('suppression de médias : seulement ce qui n\'est plus utilisé', async () => {
  const list = (await admin.req('GET', '/api/media')).json.media;
  const used = list.find((m) => m.path === 'assets/img/vexora-dashboard.png');
  assert.ok(used && used.used);
  assert.equal((await admin.req('POST', '/api/media/delete', { path: used.path })).status, 409);
  for (const bad of ['../data/auth.json', 'assets/img/../../data/auth.json', '/etc/passwd', 'assets/css/style.css', 'index.html']) {
    assert.equal((await admin.req('POST', '/api/media/delete', { path: bad })).status, 400, bad);
  }
  const free = list.find((m) => m.path.startsWith('assets/img/ma-photo-ete'));
  assert.equal((await admin.req('POST', '/api/media/delete', { path: free.path })).status, 200);
  assert.equal((await fresh().req('GET', '/' + free.path)).status, 404);
});

test('un média envoyé peut être utilisé dans le contenu (dimensions lues par le serveur)', async () => {
  const up = (await admin.req('POST', '/api/media?kind=image&name=nouveau.png', undefined, { raw: PNG_1x1 })).json;
  const cur = (await admin.req('GET', '/api/content')).json;
  const c = structuredClone(cur.content);
  c.projects.cards[2].image = { src: up.path, alt: 'Capture de test' };
  const r = await admin.req('PUT', '/api/content', { content: c, rev: cur.rev });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.content.projects.cards[2].image.width, r.json.content.projects.cards[2].image.height], [1, 1]);
  assert.match(indexHtml(), /src="assets\/img\/nouveau\.png" width="1" height="1"/);
  assert.equal((await admin.req('POST', '/api/media/delete', { path: up.path })).status, 409);
});

test('aperçu : rendu non enregistré, protégé', async () => {
  const cur = (await admin.req('GET', '/api/content')).json;
  const c = structuredClone(cur.content);
  c.hero.badge = 'APERCU-SEULEMENT';
  assert.equal((await admin.req('POST', '/api/preview', { content: c })).status, 200);
  const pv = await admin.req('GET', '/admin/preview');
  assert.match(pv.text, /APERCU-SEULEMENT/);
  assert.match(pv.text, /<base href="\/">/);
  assert.ok(!indexHtml().includes('APERCU-SEULEMENT'));
});

test('changement de mot de passe : ancien refusé, sessions invalidées', async () => {
  const c = fresh(); await c.login();
  const other = fresh(); await other.login();
  assert.equal((await c.req('POST', '/api/password', { current: 'faux', next: 'nouveau-mot-de-passe' })).status, 403);
  assert.equal((await c.req('POST', '/api/password', { current: 'mot-de-passe-de-test', next: 'court' })).status, 422);
  const ok = await c.req('POST', '/api/password', { current: 'mot-de-passe-de-test', next: 'nouveau-mot-de-passe' });
  assert.equal(ok.status, 200);
  assert.equal((await c.req('GET', '/api/content')).status, 200);       // session courante renouvelée
  assert.equal((await other.req('GET', '/api/content')).status, 401);   // les autres sont déconnectées
  assert.equal((await fresh().login('mot-de-passe-de-test')).status, 401);
  assert.equal((await fresh().login('nouveau-mot-de-passe')).status, 200);
  assert.ok(existsSync(dir + '/data/auth.json'));
  assert.ok(!readFileSync(dir + '/data/auth.json', 'utf8').includes('nouveau-mot-de-passe'));
});
