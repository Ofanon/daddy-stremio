import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve('src/api/resolve.ts');
const source = await readFile(file, 'utf8');
const fallback = 'const candidateServers = [server, ...PLAYER_IDS.filter((s) => s !== server)];';
const response = 'if (result.status < 400) {';
const importMarker = 'serverProfile, PLAYER_IDS, type ServerKind';
if (!source.includes(fallback) || !source.includes(response) || !source.includes(importMarker)) {
  throw new Error('La version du resolver ne correspond pas au correctif attendu.');
}
const updated = source
  .replace(fallback, 'const candidateServers = [server];')
  .replace(importMarker, 'serverProfile, type ServerKind')
  .replace(response, response + '\n        res.setHeader("X-DaddyLive-Player", s);');
await writeFile(file, updated);
