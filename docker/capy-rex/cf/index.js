// Cloudflare Workers entry for Rex Widgets Hub 3.6.0.
// Every request is forwarded to the single Durable Object that owns the data.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { registerPwaFiles, pwaResponse } from '../pwa.js';
import i192 from '../public/app-icons/rex-mulberry-v1-192.png';
import i512 from '../public/app-icons/rex-mulberry-v1-512.png';
import m192 from '../public/app-icons/rex-mulberry-v1-maskable-192.png';
import m512 from '../public/app-icons/rex-mulberry-v1-maskable-512.png';
import i180 from '../public/app-icons/rex-mulberry-v1-180.png';
import i32 from '../public/app-icons/rex-mulberry-v1-32.png';
import i16 from '../public/app-icons/rex-mulberry-v1-16.png';
import favicon from '../public/app-icons/favicon.ico';

import c0 from '../public/app-icons/capy-v1-48.png';
import c1 from '../public/app-icons/capy-v1-96.png';
import c2 from '../public/app-icons/capy-v1-192.png';
import c3 from '../public/app-icons/capy-v1-512.png';
import c4 from '../public/app-icons/capy-v13-16.png';
import c5 from '../public/app-icons/capy-v13-32.png';
import c6 from '../public/app-icons/capy-v13-180.png';
import c7 from '../public/app-icons/capy-v13-maskable-192.png';
import c8 from '../public/app-icons/capy-v13-maskable-512.png';
export { RexHub } from './hub.js';

const files = {
  'capy-v1-48.png': c0,
  'capy-v1-96.png': c1,
  'capy-v1-192.png': c2,
  'capy-v1-512.png': c3,
  'capy-v13-16.png': c4,
  'capy-v13-32.png': c5,
  'capy-v13-180.png': c6,
  'capy-v13-maskable-192.png': c7,
  'capy-v13-maskable-512.png': c8,

  'rex-mulberry-v1-192.png': i192, 'rex-mulberry-v1-512.png': i512,
  'rex-mulberry-v1-maskable-192.png': m192, 'rex-mulberry-v1-maskable-512.png': m512,
  'rex-mulberry-v1-180.png': i180, 'rex-mulberry-v1-32.png': i32, 'rex-mulberry-v1-16.png': i16,
  'favicon.ico': favicon,
};
registerPwaFiles(name => files[name]);

const hub = env => env.HUB.get(env.HUB.idFromName('hub'));

// 3.6.0：图标、favicon、manifest 和 CORS 预检不需要数据，直接在 Worker 里回，不再算 Durable Object 请求。
const PREFLIGHT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Cookie, If-None-Match',
  'Access-Control-Max-Age': '86400',
};
function localResponse(request) {
  const resource = pwaResponse(request);
  if (resource) return resource;
  if (request.method === 'OPTIONS') return new Response(null, { headers: PREFLIGHT_HEADERS });
  return null;
}

// Worker 主文件只导出 default、RexHub、PublicCache（其它导出会被 Cloudflare 当成入口）。
// 3.6.0（可选，默认关闭）：边缘缓存。Rex 拉合集、下载模块这些公开 GET 交给 Cloudflare 的 Workers Cache，
// 命中时不进 Durable Object（不算 DO 请求、不读行；仍算一次 Worker 请求）。
// 打开方法见 wrangler.toml 末尾和 CF-DEPLOY.md；没打开时这里完全不走。
const EDGE_PATHS = /^\/api\/collections\/[^/]+$|^\/api\/modules\/[^/]+(?:\/file\/[^/]+\.js|\/raw)?$|^\/[a-f0-9-]{36}(?:\.js)?$/i;
function edgeCacheable(request, env) {
  if (String(env.EDGE_CACHE || '') !== '1') return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return EDGE_PATHS.test(new URL(request.url).pathname);
}
// 缓存里只放公开内容：去掉 Cookie / Authorization，保证同一个地址所有人拿到的都一样。
function publicRequest(request) {
  const headers = new Headers(request.headers);
  headers.delete('cookie'); headers.delete('authorization');
  return new Request(request.url, { method: request.method, headers });
}
export class PublicCache extends WorkerEntrypoint {
  async fetch(request) { return hub(this.env).fetch(request); }
}

export default {
  async fetch(request, env, ctx) {
    const local = localResponse(request);
    if (local) return local;
    if (!env.HUB) {
      return new Response(JSON.stringify({ error: '未绑定 Durable Object：请检查 wrangler.toml 里的 HUB 绑定后重新部署' }),
        { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (edgeCacheable(request, env) && ctx?.exports?.PublicCache) {
      try { return await ctx.exports.PublicCache.fetch(publicRequest(request)); }
      catch (error) { console.error('Edge cache:', error?.message || error); }
    }
    return hub(env).fetch(request);
  },
  async scheduled(event, env, ctx) {
    if (env.HUB) ctx.waitUntil(hub(env).tick());
  },
};
