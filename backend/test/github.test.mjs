import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchGithub } from '../lib/github.mjs';

const json = (data, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: (k) => headers[k] ?? null }, json: async () => data });

test('importe les dépôts publics, ignore forks et archivés', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.endsWith('/users/moi')) return json({ public_repos: 3, created_at: '2025-03-10T00:00:00Z' });
    return json([
      { name: 'a', html_url: 'https://github.com/moi/a', language: 'JavaScript', description: 'Un site ', homepage: 'https://moi.github.io/a/', pushed_at: '2026-10-05T00:00:00Z', fork: false, archived: false },
      { name: 'fork', html_url: 'https://github.com/moi/fork', fork: true, archived: false, pushed_at: '2026-10-06T00:00:00Z' },
      { name: 'vieux', html_url: 'https://github.com/moi/vieux', fork: false, archived: true, pushed_at: '2020-01-01T00:00:00Z' },
      { name: 'b', html_url: 'https://github.com/moi/b', language: null, description: null, homepage: 'javascript:alert(1)', pushed_at: '2025-04-01T00:00:00Z', fork: false, archived: false }
    ]);
  };
  const data = await fetchGithub({ user: 'moi', fetchImpl: fakeFetch });
  assert.deepEqual(data.repos.map((r) => r.name), ['a', 'b']);
  assert.equal(data.repos[0].homepage, 'https://moi.github.io/a/');
  assert.equal(data.repos[1].homepage, '');          // schéma dangereux écarté
  assert.equal(data.repos[0].description, 'Un site');
  assert.deepEqual(data.stats, { count: 3, languages: 1, since: 'mars 2025' });
  assert.equal(data.repos[0].updated, 'octobre 2026');
});

test('pseudo invalide, compte inconnu, quota atteint', async () => {
  await assert.rejects(fetchGithub({ user: '../etc', fetchImpl: async () => json({}) }), /invalide/);
  await assert.rejects(fetchGithub({ user: 'x', fetchImpl: async () => json({}, 404) }), /introuvable/);
  await assert.rejects(fetchGithub({ user: 'x', fetchImpl: async () => json({}, 403, { 'x-ratelimit-reset': '1900000000' }) }), /Quota/);
});
