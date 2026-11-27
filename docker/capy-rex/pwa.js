// Docker/Node reads the icon files from disk; the Cloudflare entry registers
// the same bytes through registerPwaFiles() (bundled as Data modules).
const nodeFs = globalThis.navigator?.userAgent === 'Cloudflare-Workers' ? null
  : globalThis.process?.getBuiltinModule?.('node:fs');

const icons = [
  ['capy-v1-192.png', '192x192', 'any'],
  ['capy-v1-512.png', '512x512', 'any'],
  ['capy-v13-maskable-192.png','192x192','maskable'],
  ['capy-v13-maskable-512.png','512x512','maskable'],

];
const manifest = {
  id: '/', name: 'Capy/Rex模块管理', short_name: 'Capy/Rex',
  description: '帮你管理模块链接和模块，生成合集链接。', lang: 'zh-CN',
  start_url: '/', scope: '/', display: 'standalone',
  background_color: '#f2f2f6', theme_color: '#f2f2f6',
  icons: icons.map(([name, sizes, purpose]) => ({
    src: '/app-icons/' + name, sizes, type: 'image/png', purpose,
  })),
};
const resources = new Map([
  ['/manifest.webmanifest', {
    body: JSON.stringify(manifest), type: 'application/manifest+json; charset=utf-8', cache: 'no-cache',
  }],
]);
export const PWA_FILES = [...icons.map(([name]) => name),
  'capy-v13-16.png','capy-v13-32.png','capy-v13-180.png','rex-mulberry-v1-192.png','rex-mulberry-v1-512.png','rex-mulberry-v1-maskable-192.png','rex-mulberry-v1-maskable-512.png','rex-mulberry-v1-180.png', 'rex-mulberry-v1-32.png', 'rex-mulberry-v1-16.png', 'favicon.ico', 'capy-v1-48.png', 'capy-v1-96.png', 'capy-v1-192.png', 'capy-v1-512.png'];
export function registerPwaFiles(read) {
 for (const name of PWA_FILES) {
  const resource = {
    body: new Uint8Array(read(name)),
    type: name.endsWith('.ico') ? 'image/x-icon' : 'image/png',
    cache: 'public, max-age=31536000, immutable',
  };
  resources.set('/app-icons/' + name, resource);
  if (name === 'capy-v1-48.png') resources.set('/favicon.ico', { ...resource, cache: 'no-cache' });
 }
}
if (nodeFs) registerPwaFiles(name => nodeFs.readFileSync(new URL('./public/app-icons/' + name, import.meta.url)));

// Explicit allowlist: no arbitrary paths, authentication bypass, or data-file serving.
export function pwaResponse(request) {
  const resource = resources.get(new URL(request.url).pathname);
  if (!resource) return null;
  const headers = {
    'Content-Type': resource.type, 'Cache-Control': resource.cache,
    'X-Content-Type-Options': 'nosniff',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  }
  return new Response(request.method === 'HEAD' ? null : resource.body, { headers });
}
