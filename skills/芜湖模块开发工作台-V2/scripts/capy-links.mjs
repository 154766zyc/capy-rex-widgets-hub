#!/usr/bin/env node
// Host-side string helper; no network, module execution, or secret handling.
import assert from 'node:assert/strict';

function publicShape(value) {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u0020\u007f]/u.test(value)) throw new Error('需要无空白的 HTTP(S) URL');
  const u = new URL(value);
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password) throw new Error('URL 协议或用户信息不允许');
  return u;
}
function widget(url) {
  publicShape(url);
  const data = Buffer.from(url, 'utf8').toString('base64url');
  assert.equal(Buffer.from(data, 'base64url').toString('utf8'), url);
  return 'com.feifeiduck.capyplayer://add-widget?data=' + data;
}
function proxy(base, image) {
  const u = publicShape(base);
  publicShape(image);
  if (u.search || u.hash || base.includes('?') || base.includes('#')) throw new Error('代理基础 URL 不能有查询或片段');
  return base.replace(/\/+$/u, '') + '/cover?url=' + encodeURIComponent(image);
}
function selfTest() {
  let checks = 0;
  for (const url of ['https://example.com/widget.js', 'https://example.com/模块.js?q=中文&n=2#分区', 'https://example.com/a?x=%2F%2B#z']) {
    const out = widget(url);
    const data = out.split('?data=')[1];
    assert.match(data, /^[A-Za-z0-9_-]+$/u);
    assert.equal(Buffer.from(data, 'base64url').toString('utf8'), url);
    checks++;
  }
  const image = 'https://cdn.example.com/图.jpg?x=a&y=%2F#part';
  for (const base of ['https://example.com/images', 'https://example.com/images/', 'https://example.com/images///']) {
    assert.equal(proxy(base, image), 'https://example.com/images/cover?url=' + encodeURIComponent(image));
    checks++;
  }
  assert.equal(proxy('https://example.com/', image), 'https://example.com/cover?url=' + encodeURIComponent(image)); checks++;
  for (const bad of ['/local/a.js', 'file:///a.js', 'javascript:alert(1)', 'https://user:pass@example.com/a', ' https://example.com/a', 'https://example.com/a\n']) {
    assert.throws(() => widget(bad)); checks++;
  }
  for (const bad of ['https://example.com/images?q=1', 'https://example.com/images#x', 'https://example.com/images?', 'https://example.com/images#']) {
    assert.throws(() => proxy(bad, image)); checks++;
  }
  assert.throws(() => proxy('https://example.com/images', 'file:///x')); checks++;
  console.log(JSON.stringify({ok: true, checks, scope: 'strings-only; no DNS, network, App or decryption tests'}));
}
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'self-test' && args.length === 0) selfTest();
  else if (command === 'widget' && args.length === 1) console.log(widget(args[0]));
  else if (command === 'proxy' && args.length === 2) console.log(proxy(args[0], args[1]));
  else throw new Error('用法: node scripts/capy-links.mjs self-test | widget URL | proxy BASE IMAGE');
} catch {
  console.error('参数或自检失败；请检查命令、HTTP(S) URL 及代理基础路径。');
  process.exitCode = 1;
}
