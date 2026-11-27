// Test harness: serve the Cloudflare Durable Object build over node:http, so the
// existing HTTP-level test suite can run against the CF storage layer
// (REX_TEST_RUNTIME=cf). Mirrors what Cloudflare does in front of the object:
// sets CF-Connecting-IP from the socket and forwards everything else unchanged.
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RexHub } from '../../cf/hub.js';
import { fakeState } from './fake-do.js';

function bodyStream(incoming) {
  const safe = fn => { try { fn(); } catch {} };
  return new ReadableStream({
    start(c) {
      incoming.on('data', d => safe(() => c.enqueue(new Uint8Array(d))));
      incoming.on('end', () => safe(() => c.close()));
      incoming.on('error', e => safe(() => c.error(e)));
      incoming.on('aborted', () => safe(() => c.error(new Error('aborted'))));
    },
    cancel() { incoming.resume(); },
  });
}

export async function createCfServer(config = {}, { remoteFetch } = {}) {
  const directory = resolve(config.DATA_DIR || './data');
  mkdirSync(directory, { recursive: true });
  const state = fakeState(resolve(directory, 'rex.sqlite'));
  const schedulerOn = config.DISABLE_SCHEDULER !== 'true';
  let timer = null, closed = false;
  const hub = new RexHub(state, { ADMIN_PASSWORD: config.ADMIN_SECRET });
  if (remoteFetch) hub.hubEnv.REMOTE_FETCH = remoteFetch;
  const alarms = new Set();
  state.storage.onAlarm = at => {
    if (!schedulerOn || closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      state.storage.alarm = null;
      const job = hub.alarm().catch(e => console.error('alarm', e)).finally(() => alarms.delete(job));
      alarms.add(job);
    }, Math.max(0, at - Date.now()));
    timer.unref();
  };
  await hub.ready;
  const requests = new Set();
  const server = createServer(async (incoming, outgoing) => {
    const work = (async () => {
      try {
        // Stream the body like Cloudflare does, so a client disconnect surfaces
        // inside the Durable Object while it reads the upload.
        const hasBody = !['GET', 'HEAD'].includes(incoming.method);
        const headers = new Headers();
        for (const [k, v] of Object.entries(incoming.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        headers.set('CF-Connecting-IP', incoming.socket.remoteAddress || '127.0.0.1');
        const host = headers.get('host') || 'localhost';
        const request = new Request('http://' + host + incoming.url, { method: incoming.method, headers, ...(hasBody ? { body: bodyStream(incoming), duplex: 'half' } : {}) });
        const response = await hub.fetch(request);
        const out = Object.fromEntries(response.headers);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) out['set-cookie'] = cookies;
        outgoing.writeHead(response.status, out);
        if (incoming.method === 'HEAD' || !response.body) outgoing.end();
        else await pipeline(Readable.fromWeb(response.body), outgoing);
      } catch (error) {
        console.error('cf harness:', error);
        if (!outgoing.headersSent) { outgoing.writeHead(500); outgoing.end(); } else outgoing.destroy();
      }
    })();
    requests.add(work); work.finally(() => requests.delete(work));
  });
  let finish;
  server.hubClosed = new Promise(r => { finish = r; });
  server.hub = hub; server.state = state;
  server.on('close', () => {
    closed = true; clearTimeout(timer);
    void Promise.allSettled([...requests, ...alarms, hub.scheduling, ...state.pending].filter(Boolean))
      // A Durable Object is simply evicted: no graceful restore-job close runs.
      .then(() => hub.store.gate.pending)
      .finally(() => { state.storage.close(); finish(); });
  });
  return server;
}
