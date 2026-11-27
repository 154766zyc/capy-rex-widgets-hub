import test from 'node:test';
import assert from 'node:assert/strict';
import { pwaResponse } from '../pwa.js';
import { listen, close, temporary, api } from './helpers.js';

const request = (path, method='GET') => new Request('https://rex.example'+path, {method});
test('PWA manifest uses stable same-origin identity and separate opaque any/maskable PNGs', async () => {
  const response = pwaResponse(request('/manifest.webmanifest'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  assert.equal(response.headers.get('cache-control'), 'no-cache');
  const manifest = await response.json();
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(icon => icon.purpose===purpose && icon.sizes===size+'x'+size);
      assert.ok(icon);
      const resource = pwaResponse(request(icon.src));
      const png = Buffer.from(await resource.arrayBuffer());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
      assert.equal(png[25], 2, 'RGB without transparent corners');
      assert.equal(resource.headers.get('content-type'), 'image/png');
    }
  }
});
test('PWA resources support HEAD and reject writes and arbitrary file paths', async () => {
  for (const path of ['/manifest.webmanifest','/app-icons/rex-mulberry-v1-180.png','/favicon.ico']) {
    assert.equal(await pwaResponse(request(path, 'HEAD')).text(), '');
    assert.equal(pwaResponse(request(path, 'POST')).status, 405);
  }
  for (const path of ['/app-icons/.env','/app-icons/../data/rex.sqlite','/app-icons/missing.png','/api/admin/modules']) {
    assert.equal(pwaResponse(request(path)), null);
  }
});
test('HTTP homepage links manifest, Apple and favicons without changing API authentication', async t => {
  const {server, base}=await listen({DATA_DIR:temporary(t),ADMIN_SECRET:'test-password',DISABLE_SCHEDULER:'true'});
  t.after(()=>close(server));
  const homepage=await api(base, '/');
  const html=await homepage.text();
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.doesNotMatch(html, /rel="icon"[^>]*data:image/);
  assert.match(homepage.headers.get('content-security-policy'), /manifest-src 'self'/);
  assert.equal(homepage.headers.get('cache-control'), 'no-store');
  assert.equal((await api(base,'/manifest.webmanifest')).status,200);
  assert.equal((await api(base,'/app-icons/rex-mulberry-v1-180.png')).status,200);
  assert.equal((await api(base,'/api/admin/modules')).status,401);
  assert.equal((await api(base,'/app-icons/missing.png')).status,404);
});
