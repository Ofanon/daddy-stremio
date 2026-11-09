import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = 'https://thedaddy.li/';
const directory = path.dirname(fileURLToPath(import.meta.url));
export const manifest = {
  id: 'org.oscar.daddy.live', version: '0.2.0', name: 'Daddy Live — Oscar',
  description: 'Chaînes DaddyLive et lecture intégrée via daddylive-stream-resolver.',
  types: ['tv'], resources: ['catalog', 'meta', 'stream'], idPrefixes: ['daddy:'],
  catalogs: [{ type: 'tv', id: 'daddy-channels', name: 'DaddyLive — Chaînes',
    extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }] }]
};
function webUrl(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; }
  catch { return undefined; }
}
export function normalizeChannels(payload) {
  if (payload?.success === false) throw new Error('API refusée');
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('Format chaînes inattendu');
  const seen = new Set();
  return rows.flatMap(row => {
    if (!row || row.channel_id == null || !row.channel_name) return [];
    const id = String(row.channel_id);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    let poster;
    try { poster = row.logo_url ? webUrl(new URL(row.logo_url, base).href) : undefined; } catch {}
    return [{ id: `daddy:${id}`, type: 'tv', name: String(row.channel_name),
      ...(poster ? { poster, posterShape: 'square' } : {}),
      description: 'Télévision en direct — DaddyLive' }];
  });
}
export function nativeStreams(mapping, channelId) {
  const entries = mapping?.[channelId];
  if (!Array.isArray(entries)) return [];
  return entries.flatMap(entry => {
    const url = webUrl(entry?.url);
    if (!url) return [];
    // A player webpage cannot be passed off as a video stream.
    if (/\.php(?:[?#]|$)|\.html?(?:[?#]|$)/i.test(url)) return [];
    return [{ name: String(entry.name || 'DaddyLive'), url,
      behaviorHints: { notWebReady: true } }];
  });
}
export function createAddon({ apiKey = process.env.DADDY_API_KEY, fetchImpl = fetch, readStreams,
  resolverUrl = process.env.RESOLVER_URL,
  resolverPublicUrl = process.env.RESOLVER_PUBLIC_URL || resolverUrl,
  servers = (process.env.RESOLVER_SERVERS || 'casting,player,cast,stream,watch').split(','),
  cacheMs = 300000 } = {}) {
  if (resolverUrl && (!webUrl(resolverUrl) || !webUrl(resolverPublicUrl))) throw new Error('Adresse resolver invalide');
  const allowedServers = new Set(['stream', 'cast', 'watch', 'casting', 'player']);
  servers = [...new Set(servers.map(s => s.trim()).filter(s => allowedServers.has(s)))];
  async function resolverRequest(route) {
    const response = await fetchImpl(new URL(route, resolverUrl), {
      signal: AbortSignal.timeout(20000), redirect: 'error'
    });
    if (!response.ok) throw new Error('Resolver indisponible');
    return response.json();
  }
  let cached, expires = 0, pending;
  async function channels() {
    if (!apiKey && !resolverUrl) throw new Error('Configuration manquante');
    if (cached && Date.now() < expires) return cached;
    if (!pending) pending = (async () => {
      if (resolverUrl) {
        const rows = await resolverRequest('/api/channels');
        if (!Array.isArray(rows) || rows.length === 0) throw new Error('Catalogue resolver vide');
        cached = normalizeChannels(rows.map(row => ({ channel_id: row.id, channel_name: row.name })));
        expires = Date.now() + cacheMs;
        return cached;
      }
      const url = new URL('daddyapi.php', base);
      url.search = new URLSearchParams({ key: apiKey, endpoint: 'channels' }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('API indisponible');
      cached = normalizeChannels(await response.json());
      expires = Date.now() + cacheMs;
      return cached;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  async function streams() {
    if (readStreams) return readStreams();
    try { return JSON.parse(await readFile(path.join(directory, 'streams.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`,
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    if (req.method === 'OPTIONS') return send(204, '');
    if (req.method !== 'GET') return send(405, { error: 'Méthode non autorisée' });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/manifest.json') return send(200, manifest);
      if (url.pathname === '/health') return send(200, { status: resolverUrl || apiKey ? 'configured' : 'missing-configuration', mode: resolverUrl ? 'resolver' : 'api' });
      if (url.pathname === '/') return send(200,
        '<!doctype html><html lang="fr"><meta charset="utf-8"><title>DaddyLive Stremio</title><h1>DaddyLive pour Stremio</h1><p>Ajoutez l’adresse de ce serveur suivie de /manifest.json dans Stremio.</p><p>Le service daddylive-stream-resolver doit être lancé. Consultez README.md.</p></html>', 'text/html');
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[1] !== 'tv') return send(404, { error: 'Ressource inconnue' });
      if (parts[0] === 'catalog' && ['daddy-channels', 'daddy-channels.json'].includes(parts[2]) && parts.length <= 4) {
        const extra = new URLSearchParams((parts[3] || '').replace(/\.json$/, ''));
        const search = (extra.get('search') || '').toLocaleLowerCase();
        const rawSkip = Number(extra.get('skip') || 0);
        const skip = Number.isSafeInteger(rawSkip) && rawSkip >= 0 ? rawSkip : 0;
        return send(200, { metas: (await channels()).filter(c => c.name.toLocaleLowerCase().includes(search)).slice(skip, skip + 100) });
      }
      if (parts.length !== 3 || !parts[2].endsWith('.json')) return send(404, { error: 'Ressource inconnue' });
      const id = parts[2].slice(0, -5);
      if (!/^daddy:[a-zA-Z0-9_-]+$/.test(id)) return send(404, { error: 'Identifiant inconnu' });
      const channel = (await channels()).find(c => c.id === id);
      if (parts[0] === 'meta') return send(200, { meta: channel || null });
      if (parts[0] === 'stream') {
        if (!channel) return send(200, { streams: [] });
        if (!resolverUrl) return send(200, { streams: nativeStreams(await streams(), id.slice(6)) });
        const results = await Promise.allSettled(servers.map(async server => {
          const query = new URLSearchParams({ channel: id.slice(6), server });
          const result = await resolverRequest(`/api/resolve?${query}`);
          if (result.isHls !== true || !webUrl(result.live)) throw new Error('Flux HLS absent');
          // Construct a stable endpoint on the configured public origin. Do not
          // return an upstream signed URL or trust a returned third-party host.
          const live = new URL(`/api/live?${query}`, resolverPublicUrl).href;
          return { name: `DaddyLive · ${server}`, url: live,
            behaviorHints: { notWebReady: true } };
        }));
        const resolved = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!resolved.length) return send(503, { streams: [], error: 'Aucun serveur vidéo disponible pour cette chaîne.' });
        return send(200, { streams: resolved });
      }
      return send(404, { error: 'Ressource inconnue' });
    } catch {
      // Never return upstream exception text: its URL may contain the API key.
      return send(503, { error: 'Le fournisseur ou le resolver est indisponible. Vérifiez la configuration.' });
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 7000);
  const host = process.env.HOST || '127.0.0.1';
  createAddon().listen(port, host, () => console.log(`Addon : http://${host}:${port}/manifest.json`));
}
