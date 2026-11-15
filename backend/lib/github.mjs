/* Récupération des dépôts GitHub (utilisé par l'admin et par tools/sync-github.mjs). */
const frenchDate = (iso) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(iso)); }
  catch { return ''; }
};

/**
 * @param {{user:string, token?:string, forks?:boolean, archived?:boolean, fetchImpl?:typeof fetch}} opts
 * @returns {Promise<{stats:{count:number,languages:number,since:string}, repos:object[]}>}
 */
export async function fetchGithub({ user, token = '', forks = false, archived = false, fetchImpl = fetch }) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(user || '')) throw new Error('Pseudo GitHub invalide.');
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'portfolio-admin' };
  if (token) headers.authorization = `Bearer ${token}`;

  const api = async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15000) });
    if (res.status === 404) throw new Error(`Compte GitHub introuvable : « ${user} ».`);
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get('x-ratelimit-reset');
      throw new Error('Quota GitHub atteint' + (reset ? ` — réessayez après ${new Date(Number(reset) * 1000).toLocaleString('fr-FR')}` : '') + '. Définissez GITHUB_TOKEN pour l\'augmenter.');
    }
    if (!res.ok) throw new Error(`GitHub a répondu ${res.status}.`);
    return res.json();
  };

  const profile = await api(`/users/${user}`);
  const all = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await api(`/users/${user}/repos?per_page=100&page=${page}&sort=pushed&direction=desc`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const kept = all
    .filter((r) => (forks || !r.fork) && (archived || !r.archived))
    .sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));

  const languages = new Set(kept.map((r) => r.language).filter(Boolean));
  const repos = kept.map((r) => {
    const home = (r.homepage || '').trim();
    return {
      name: r.name,
      url: r.html_url,
      language: r.language || '',
      color: '',
      description: (r.description || '').trim(),
      updated: frenchDate(r.pushed_at || r.updated_at),
      homepage: /^https?:\/\//i.test(home) && !home.includes(`github.com/${user}`) ? home : ''
    };
  });
  return {
    stats: { count: Number(profile.public_repos ?? kept.length), languages: languages.size, since: frenchDate(profile.created_at) },
    repos
  };
}
