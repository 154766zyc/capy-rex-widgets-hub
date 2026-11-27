// Run the whole HTTP test suite against the Cloudflare Durable Object build,
// plus the CF-only tests. Docker-only behaviour (LAN/Fake-IP address switches,
// reverse-proxy trust, gzip in server.js, on-disk upgrade snapshots, legacy
// Docker database files) does not exist on Cloudflare and is skipped by name.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dockerOnly = [
  'real HTTP transport and Hub import allow previously blocked addresses',
  'compatibility imports, manual refresh and scheduled subscription updates preserve IDs, aliases, order and bytes across re-enabling checks',
  'Docker 2.1 migration',
  'HTTP authentication, proxy trust',
  'HTTP adapter accepts trusted proxy identity',
  'shutdown aborts active background transport',
  'offline recovery verifies snapshots',
  'v3.1 upgrade snapshots the database',
  'v1 SQLite upgrades in place',
  'explicit backup opt-out migrates',
  'legacy fallback widget IDs',
  'HTTP API cannot self-authorize LAN downloads',
  'scheduled LAN subscription and single-JS refresh',
  '3.5 UI gzip',
  '3.5 creates an upgrade snapshot once',
  'real LAN HTTP download works only with the configured origin',
];
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const files = [
  ...readdirSync(root).filter(f => f.endsWith('.test.mjs')),
  ...readdirSync(root + 'test').filter(f => f.endsWith('.test.js')).map(f => 'test/' + f),
  ...readdirSync(root + 'test/cf').filter(f => f.endsWith('.test.js')).map(f => 'test/cf/' + f),
];
const result = spawnSync(process.execPath, ['--import', './test/cf/register.mjs', '--test',
  '--test-skip-pattern', dockerOnly.map(escape).join('|'), ...files],
  { cwd: root, stdio: 'inherit', env: { ...process.env, REX_TEST_RUNTIME: 'cf' } });
process.exit(result.status ?? 1);
