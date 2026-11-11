import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAddon, nativeStreams, normalizeChannels } from './server.mjs';

const payload = { success: true, data: [{ channel_id: '491', channel_name: 'beIN SPORTS Australia 1', logo_url: 'logos/bein.png' }] };
test('normalizes the documented API envelope and relative logos', () => {
  assert.equal(normalizeChannels(payload)[0].poster, 'https://thedaddy.li/logos/bein.png');
  assert.throws(() => normalizeChannels({ success: false }));
});
test('uses direct video URLs and rejects player webpages and unsafe protocols', () => {
  assert.equal(nativeStreams({ 491: [{ url: 'https://example.com/live.m3u8' },
    { url: 'https://thedaddy.li/stream/stream-491.php' }, { url: 'javascript:alert(1)' }] }, '491').length, 1);
  assert.deepEqual(nativeStreams({}, '491'), []);
});
test('serves manifest, filtered catalog, metadata and native streams over HTTP', async t => {
  let calls = 0;
  const server = createAddon({ apiKey: 'test-secret', fetchImpl: async () => {
    calls++; return { ok: true, json: async () => payload };
  }, readStreams: async () => ({ 491: [{ url: 'https://example.com/live.m3u8' }] }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async route => (await fetch(base + route)).json();
  assert.equal((await get('/manifest.json')).types[0], 'tv');
  assert.equal((await get('/catalog/tv/daddy-channels/search=bein.json')).metas.length, 1);
  assert.equal((await get('/catalog/tv/daddy-channels/search=absent.json')).metas.length, 0);
  assert.equal((await get('/meta/tv/daddy%3A491.json')).meta.id, 'daddy:491');
  assert.equal((await get('/stream/tv/daddy%3A491.json')).streams[0].url, 'https://example.com/live.m3u8');
  assert.deepEqual((await get('/stream/tv/daddy%3A999.json')).streams, []);
  assert.equal(calls, 1);
});
test('missing credentials produce an explicit failure without leaking a key', async t => {
  const server = createAddon({ apiKey: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/catalog/tv/daddy-channels.json`);
  assert.equal(response.status, 503);
});
test('resolver mode skips unavailable playlists and sources that fail the video probe', async t => {
  const probes = [];
  let failAll = false;
  const server = createAddon({ apiKey: '', resolverUrl: 'http://localhost:3000',
    resolverPublicUrl: 'https://video.example', servers: ['casting', 'cast', 'watch', 'player', 'stream'],
    probeVideo: async url => {
      assert.equal(url.origin, 'http://localhost:3000');
      const player = url.searchParams.get('server');
      probes.push(player);
      if (failAll && player === 'player') throw new Error('FFmpeg unavailable');
      return player !== 'casting';
    },
    fetchImpl: async url => {
      if (url.pathname === '/api/channels') return { ok: true, json: async () => [{ id: 44, name: 'ESPN' }] };
      assert.equal(url.pathname, '/api/live');
      if (url.searchParams.get('server') === 'cast') return new Response('Forbidden', { status: 403 });
      const body = url.searchParams.get('server') === 'watch'
        ? '#EXTM3U\n#EXT-X-TARGETDURATION:4\n'
        : '#EXTM3U\n#EXTINF:4,\nsegment.ts\n';
      const requested = url.searchParams.get('server');
      return new Response(body, { headers: {
        'Content-Type': 'application/x-mpegURL',
        'X-DaddyLive-Player': requested === 'stream' ? 'cast' : requested
      } });
    } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const catalog = await (await fetch(root + '/catalog/tv/daddy-channels.json')).json();
  assert.equal(catalog.metas[0].name, 'ESPN');
  const response = await (await fetch(root + '/stream/tv/daddy:44.json')).json();
  assert.equal(response.streams.length, 1);
  assert.equal(response.streams[0].url, 'https://video.example/api/live?channel=44&server=player');
  assert.equal(response.streams[0].externalUrl, undefined);
  failAll = true;
  const fallback = await (await fetch(root + '/stream/tv/daddy:44.json')).json();
  assert.deepEqual(fallback.streams.map(s => s.name), ['DaddyLive · casting', 'DaddyLive · player']);
  assert.ok(fallback.streams.every(s => s.description.includes('secours')));
  assert.deepEqual(probes.sort(), ['casting', 'casting', 'player', 'player']);
});
