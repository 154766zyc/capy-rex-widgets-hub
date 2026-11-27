import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { createHubServer } from '../server.js';

// Exercise the actual HTTP adapter without opening a socket in restricted CI.
const memoryServers = new Map();
let memoryPort = 18080;

// REX_TEST_RUNTIME=cf runs the same HTTP tests against the Cloudflare
// Durable Object build (needs: node --import ./test/cf/register.mjs).
const createServerFor = process.env.REX_TEST_RUNTIME === 'cf'
  ? (await import('./cf/cf-server.js')).createCfServer : createHubServer;

export async function listen(config, dependencies) {
  const server = await createServerFor(config, dependencies);
  if (process.env.REX_TEST_TRANSPORT === 'memory') {
    const base = `http://127.0.0.1:${memoryPort++}`;
    memoryServers.set(base, server);
    return { server, base };
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

export async function close(server) {
  for (const [base, item] of memoryServers) {
    if (item === server) {
      memoryServers.delete(base);
      server.emit('close');
      await server.hubClosed;
      return;
    }
  }
  const closed = once(server, 'close');
  server.close();
  await closed;
  await server.hubClosed;
}

export function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rex-hub-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export async function api(base, path, { method = 'GET', cookie, json, body, headers = {} } = {}) {
  if (cookie) headers.Cookie = cookie;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (!memoryServers.has(base)) return fetch(base + path, { method, headers, body, redirect: 'manual' });
  const request = new Request(base + path, { method, headers, body });
  const incoming = Readable.from([Buffer.from(await request.arrayBuffer())]);
  incoming.url = path;
  incoming.method = method;
  incoming.headers = Object.fromEntries(request.headers);
  incoming.headers.host ||= new URL(base).host;
  incoming.socket = { remoteAddress: '127.0.0.1' };
  const chunks = [];
  const outgoing = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  let status, responseHeaders;
  outgoing.writeHead = (code, values = {}) => {
    status = code;
    responseHeaders = new Headers(values);
    outgoing.headersSent = true;
  };
  const finished = once(outgoing, 'finish');
  memoryServers.get(base).emit('request', incoming, outgoing);
  await finished;
  return new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers: responseHeaders });
}

export async function login(base, password, endpoint = '/api/admin/auth') {
  const response = await api(base, endpoint, { method: 'POST', json: { password } });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
