import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const base = 'https://thedaddy.li/';
const directory = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const sampleFrames = 60;
const brokenChannelTtlMs = 10 * 60 * 1000;

async function checkVideo(url, signal) {
  const { stdout, stderr } = await execFileAsync('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-protocol_whitelist', 'http,https,tcp,tls,crypto',
    '-rw_timeout', '4000000', '-f', 'hls',
    '-allowed_extensions', 'ALL', '-extension_picky', '0',
    '-threads', '1', '-i', url.href, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-frames:v', String(sampleFrames), '-threads', '1', '-f', 'null', '-'
  ], { signal, maxBuffer: 128 * 1024, windowsHide: true });
  const frames = [...stdout.matchAll(/^frame=(\d+)/gm)].at(-1);
  // A buffering-period SEI may reference an SPS before the first keyframe.
  // Keep checking frame count and reject every other decode error.
  const decodeErrors = stderr.split(/\r?\n/).filter(line =>
    line.trim() && !/^\[[^\]]+\] non-existing SPS \d+ referenced in buffering period$/.test(line.trim())
  );
  if (decodeErrors.some(line => /^\[(?:dec:[^\s\]]+|h264|hevc|mpeg2video|vp[89]|av1) @/.test(line))) return false;
  if (decodeErrors.length === 0 && Number(frames?.[1]) >= sampleFrames) return true;
  return null;
}

export const manifest = {
  id: 'org.oscar.daddy.live', version: '0.2.7', name: 'Daddy Live — Oscar',
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
  probeVideo = checkVideo,
  resolverUrl = process.env.RESOLVER_URL,
  resolverPublicUrl = process.env.RESOLVER_PUBLIC_URL || resolverUrl,
  servers = (process.env.RESOLVER_SERVERS || 'casting,player,cast,stream,watch').split(','),
  excludedChannelIds = process.env.EXCLUDED_CHANNEL_IDS ?? '950',
  cacheMs = 300000 } = {}) {
  const excluded = new Set(excludedChannelIds.split(',').map(id => id.trim()).filter(Boolean)
    .map(id => `daddy:${id}`));
  const hiddenUntil = new Map();
  function isTemporarilyHidden(id) {
    const expiry = hiddenUntil.get(id);
    if (expiry === undefined) return false;
    if (expiry > Date.now()) return true;
    hiddenUntil.delete(id);
    return false;
  }
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
        cached = normalizeChannels(rows.map(row => ({ channel_id: row.id, channel_name: row.name })))
          .filter(channel => !excluded.has(channel.id));
        expires = Date.now() + cacheMs;
        return cached;
      }
      const url = new URL('daddyapi.php', base);
      url.search = new URLSearchParams({ key: apiKey, endpoint: 'channels' }).toString();
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new Error('API indisponible');
      cached = normalizeChannels(await response.json()).filter(channel => !excluded.has(channel.id));
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
        const metas = (await channels())
          .filter(c => !isTemporarilyHidden(c.id) && c.name.toLocaleLowerCase().includes(search))
          .slice(skip, skip + 100);
        return send(200, { metas });
      }
      if (parts.length !== 3 || !parts[2].endsWith('.json')) return send(404, { error: 'Ressource inconnue' });
      const id = parts[2].slice(0, -5);
      if (!/^daddy:[a-zA-Z0-9_-]+$/.test(id)) return send(404, { error: 'Identifiant inconnu' });
      const channel = (await channels()).find(c => c.id === id);
      if (parts[0] === 'meta') return send(200, { meta: channel || null });
      if (parts[0] === 'stream') {
        if (!channel) return send(200, { streams: [] });
        if (!resolverUrl) return send(200, { streams: nativeStreams(await streams(), id.slice(6)) });
        const signal = AbortSignal.timeout(8000);
        const results = await Promise.allSettled(servers.map(async server => {
          const query = new URLSearchParams({ channel: id.slice(6), server });
          const route = `/api/live?${query}`;
          const internalUrl = new URL(route, resolverUrl);
          const playlist = await fetchImpl(internalUrl, { signal, redirect: 'error' });
          if (!playlist.ok || !/mpegurl/i.test(playlist.headers.get('content-type') || '')) {
            await playlist.body?.cancel();
            throw new Error('Playlist HLS inaccessible');
          }
          const actualPlayer = playlist.headers.get('x-daddylive-player');
          if (actualPlayer && actualPlayer !== server) {
            await playlist.body?.cancel();
            throw new Error('Le resolver a servi un autre lecteur');
          }
          const lines = (await playlist.text()).trimStart();
          if (!/^#EXTM3U\r?\n/.test(lines) || !/^#EXT(?:INF|\-X\-STREAM\-INF):/m.test(lines)) {
            throw new Error('Playlist HLS vide ou invalide');
          }
          let verified = null;
          try {
            verified = await probeVideo(internalUrl, signal);
          } catch {
            // A timeout or an unavailable decoder must not hide a valid playlist.
          }
          const name = actualPlayer ? `DaddyLive · ${actualPlayer}` : `DaddyLive · ${server} (demandé)`;
          return { verified, stream: { name,
            url: new URL(route, resolverPublicUrl).href, behaviorHints: { notWebReady: true } } };
        }));
        const resolved = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        const verified = resolved.filter(source => source.verified === true);
        const unknown = resolved.filter(source => source.verified == null);
        if (verified.length) hiddenUntil.delete(id);
        else if (!signal.aborted && resolved.length && resolved.every(source => source.verified === false)) {
          hiddenUntil.set(id, Date.now() + brokenChannelTtlMs);
        }
        const availableStreams = verified.length
          ? verified.map(source => source.stream)
          : unknown.map(({ stream }) => ({ ...stream, description: 'Source de secours · décodage non validé' }));
        return send(200, { streams: availableStreams });
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
