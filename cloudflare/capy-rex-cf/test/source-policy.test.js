import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createSourcePolicy, assertFetchableUrl, fetchRemote, isPrivateAddress } from '../remote.js';
import { createPublicFetch, createSourceLookup, publicFetch } from '../network.js';
import { createHubServer } from '../server.js';
import { parseManifest } from '../subscriptions.js';
import { listen, close, temporary, api, login } from './helpers.js';

const lan = 'http://192.168.1.5:2233';
const policy = createSourcePolicy(lan);
const code = (id, version = 1) => `WidgetMetadata={id:'${id}',title:'LAN module',version:'${version}'};\nfunction load(){return [];}`;
const json = async response => { const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body; };
const fakeDns = addresses => (_host, _options, callback) => callback(null, addresses.map(address => ({address, family:address.includes(':') ? 6 : 4})));
const resolveWith = (lookup, host, options = {all:true}) => new Promise((resolve, reject) => lookup(host, options,
  (error, result, family) => error ? reject(error) : resolve(options.all ? result : {address:result,family})));

async function open(t, { directory = temporary(t), trusted = '', remoteFetch, config = {} } = {}) {
  const {server, base} = await listen({DATA_DIR:directory, ADMIN_SECRET:'test-password', DISABLE_SCHEDULER:'true', PUBLIC_URL:'https://hub.example',
    TRUSTED_SOURCE_ORIGINS:trusted, ...config}, {remoteFetch});
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await close(server); } };
  t.after(stop);
  const cookie = await login(base, 'test-password');
  return {directory, base, stop, call:(path, options={}) => api(base, path, {cookie, ...options})};
}

async function cycle(s, id) {
  for (let n=0; n<10; n++) {
    const result = await json(await s.call('/api/admin/subscriptions/'+id+'/sync', {method:'POST'}));
    if (result.done) return result;
  }
  throw new Error('Subscription did not finish');
}

test('source origins are optional, canonical, comma-separated and isolated between policies', () => {
  assert.throws(() => createSourcePolicy().assertUrl(lan+'/a.js'), /内网地址/);
  assert.equal(policy.assertUrl(lan+'/bridge/widget.js').origin, lan);
  const multiple = createSourcePolicy(' HTTP://192.168.1.5:2233/ , http://10.1.2.3:80 ');
  assert.equal(multiple.assertUrl('http://10.1.2.3/a.js').origin, 'http://10.1.2.3');
  assert.throws(() => policy.assertUrl('http://10.1.2.3/a.js'), /内网地址/);
  assert.equal(assertFetchableUrl('https://public.example/a.js').hostname, 'public.example');
  assert.throws(() => assertFetchableUrl(lan+'/a.js'), /内网地址/);
});

test('invalid source settings fail closed, including paths, credentials, wildcards and reserved addresses', async t => {
  for (const value of ['192.168.1.5:2233', 'ftp://192.168.1.5:2233', lan+'/bridge', lan+'/?q=1', lan+'/#fragment',
    'http://admin:secret@192.168.1.5:2233', 'http://*.example', 'http://127.0.0.1', 'http://localhost',
    'http://169.254.169.254', 'http://198.18.1.1', 'http://100.64.0.1', 'http://[::1]', 'http://[fd00::1]']) {
    assert.throws(() => createSourcePolicy(value), /TRUSTED_SOURCE_ORIGINS/, value);
  }
  const directory = join(temporary(t), 'not-created');
  await assert.rejects(createHubServer({DATA_DIR:directory, ADMIN_SECRET:'test-password', TRUSTED_SOURCE_ORIGINS:lan+'/bridge'}), /TRUSTED_SOURCE_ORIGINS/);
  assert.equal(existsSync(directory), false, 'bad policy must fail before opening or migrating the database');
});

test('trust is exact by scheme, host and port, not a prefix, subnet or hostname suffix', () => {
  for (const raw of ['https://192.168.1.5:2233/a.js', 'http://192.168.1.5:2234/a.js', 'http://192.168.1.5/a.js',
    'http://192.168.1.6:2233/a.js', 'http://192.168.1.50:2233/a.js', 'http://user@192.168.1.5:2233/a.js']) {
    assert.throws(() => policy.assertUrl(raw), /地址/, raw);
  }
  const named = createSourcePolicy('http://bridge.local:2233');
  assert.equal(named.assertUrl('http://bridge.local:2233/a.js').hostname, 'bridge.local');
  assert.throws(() => named.assertUrl('http://other.bridge.local:2233/a.js'), /地址/);
});

test('only RFC1918 private IPv4 ranges may be trusted; unusual URL forms cannot escape the origin boundary', () => {
  for (const host of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.255.254']) {
    assert.equal(isPrivateAddress(host), true);
    assert.equal(createSourcePolicy('http://'+host).assertUrl('http://'+host+'/a.js').hostname, host);
  }
  for (const host of ['127.0.0.1', '169.254.169.254', '198.18.52.83', '172.32.0.1', '192.168.1.999']) assert.equal(isPrivateAddress(host), false);
  for (const raw of ['http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1', 'http://[::ffff:127.0.0.1]']) {
    assert.throws(() => createSourcePolicy(raw), /TRUSTED_SOURCE_ORIGINS/);
  }
});

test('DNS connection checks allow private answers only for the approved origin and preserve family handling', async () => {
  const named = createSourcePolicy('http://bridge.example:2233');
  const addresses = ['192.168.1.5', '8.8.8.8'];
  const lookup = createSourceLookup('http://bridge.example:2233/a.js', named, fakeDns(addresses));
  assert.equal((await resolveWith(lookup, 'bridge.example')).length, 2);
  assert.deepEqual(await resolveWith(lookup, 'bridge.example', {family:4}), {address:'192.168.1.5',family:4});
  await assert.rejects(resolveWith(lookup, 'other.example'), /不匹配/);
  for (const origin of ['http://bridge.example:2234', 'https://bridge.example:2233', 'http://other.example:2233']) {
    const host = new URL(origin).hostname;
    await assert.rejects(resolveWith(createSourceLookup(origin, named, fakeDns(addresses)), host), /内网|保留/);
  }
});

test('an approved DNS hostname still rejects reserved, loopback, metadata and mixed unsafe answers on every lookup', async () => {
  const named = createSourcePolicy('http://bridge.example:2233');
  for (const address of ['127.0.0.1', '169.254.169.254', '198.18.52.83', '198.19.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1']) {
    const lookup = createSourceLookup('http://bridge.example:2233/a.js', named, fakeDns(['192.168.1.5', address]));
    await assert.rejects(resolveWith(lookup, 'bridge.example'), /内网|保留/, address);
  }
  let answer = '192.168.1.5';
  const lookup = createSourceLookup('http://bridge.example:2233', named, (...args) => fakeDns([answer])(...args));
  await resolveWith(lookup, 'bridge.example');
  answer = '169.254.169.254';
  await assert.rejects(resolveWith(lookup, 'bridge.example'), /内网|保留/);
});

test('redirects check each new origin and never inherit trust from the previous hop', async () => {
  for (const target of ['http://192.168.1.6:2233/a.js', 'http://192.168.1.5:2234/a.js', 'https://192.168.1.5:2233/a.js',
    'http://169.254.169.254/a.js', 'http://127.0.0.1/a.js', 'http://user@192.168.1.5:2233/a.js']) {
    const visited = [];
    await assert.rejects(fetchRemote(lan+'/redirect', 1024, {assertUrl:policy.assertUrl, transport:async url => {
      visited.push(url); return new Response(null, {status:302, headers:{location:target}});
    }}), /地址/, target);
    assert.deepEqual(visited, [lan+'/redirect'], 'forbidden target must not be contacted');
  }
  let requests = 0;
  const result = await fetchRemote(lan+'/redirect', 1024, {assertUrl:policy.assertUrl, transport:async () => ++requests === 1
    ? new Response(null, {status:302, headers:{location:'/bridge/widget.js'}}) : new Response('safe module')});
  assert.equal(new TextDecoder().decode(result.bytes), 'safe module');
  assert.equal(result.url, lan+'/bridge/widget.js');
  // Public redirects are still allowed by the normal public-only policy.
  requests = 0;
  await fetchRemote(lan+'/redirect', 1024, {assertUrl:policy.assertUrl, transport:async () => ++requests === 1
    ? new Response(null, {status:302, headers:{location:'https://public.example/a.js'}}) : new Response('module')});
  assert.equal(requests, 2);
});

test('each manifest member is checked independently; a trusted collection cannot authorize another LAN origin', () => {
  const bytes = url => Buffer.from(JSON.stringify({widgets:[{id:'a',url}]}));
  assert.equal(parseManifest(bytes('/bridge/widget.js'), lan+'/list.rex', policy.assertUrl).widgets[0].url, lan+'/bridge/widget.js');
  for (const url of ['http://192.168.1.6:2233/a.js', 'http://192.168.1.5:2234/a.js', 'http://169.254.169.254/a.js']) {
    assert.throws(() => parseManifest(bytes(url), lan+'/list.rex', policy.assertUrl), /地址/);
  }
});

test('real LAN HTTP download works only with the configured origin and rechecks redirect ports', async t => {
  if (process.env.REX_TEST_TRANSPORT === 'memory') return t.skip('socket-free test mode');
  const address = Object.values(networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal && isPrivateAddress(a.address))?.address;
  if (!address) return t.skip('no RFC1918 interface available');
  let hits = 0;
  const server = createServer((req,res) => {
    hits++;
    if (req.url === '/redirect') { res.writeHead(302, {Location:'http://'+address+':1/a.js'}); res.end(); }
    else { res.writeHead(200, {'Content-Type':'application/javascript'}); res.end(code('real.lan')); }
  });
  server.listen(0, address); await once(server, 'listening');
  t.after(async () => { const done=once(server,'close'); server.close(); await done; });
  const origin = 'http://'+address+':'+server.address().port;
  await assert.rejects(publicFetch(origin+'/a.js'), /内网地址/);
  assert.equal(hits, 0);
  const trusted = createSourcePolicy(origin), transport = createPublicFetch(trusted);
  const result = await fetchRemote(origin+'/a.js', 1024, {assertUrl:trusted.assertUrl, transport});
  assert.equal(new TextDecoder().decode(result.bytes), code('real.lan'));
  await assert.rejects(fetchRemote(origin+'/redirect',1024,{assertUrl:trusted.assertUrl,transport}), /内网地址/);
  assert.equal(hits, 2);
  // Exercise the default server transport too, not just an injected mock.
  const hub=await open(t,{trusted:origin});
  const imported=await json(await hub.call('/api/admin/modules/import',{method:'POST',json:{url:origin+'/a.js'}}));
  assert.equal(await (await hub.call('/api/modules/'+imported.added[0].id+'/raw')).text(),code('real.lan'));
  assert.equal(hits,3);
});

test('HTTP API cannot self-authorize LAN downloads; admin-configured import, dedup and manual refresh preserve public identity', async t => {
  let version=1, hits=0;
  const remoteFetch = async () => { hits++; return new Response(code('manual.lan',version)); };
  const denied=await open(t,{remoteFetch});
  const deniedResponse=await denied.call('/api/admin/modules/import',{method:'POST',json:{url:lan+'/bridge/widget.js',
    TRUSTED_SOURCE_ORIGINS:lan,allowPrivate:true}});
  assert.equal(deniedResponse.status,400); assert.equal(hits,0);
  const s=await open(t,{trusted:lan,remoteFetch});
  const imported=await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:lan+'/bridge/widget.js'}}));
  const mid=imported.added[0].id;
  const duplicate=await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:lan+'/bridge/widget.js'}}));
  assert.equal(duplicate.existing,true);
  await json(await s.call('/api/admin/modules?id='+mid,{method:'PATCH',json:{note:'keep this note'}}));
  const col=await json(await s.call('/api/admin/collections',{method:'POST',json:{slug:'lanstable',title:'Mine',moduleIds:[mid]}}));
  const before=await json(await s.call('/api/collections/lanstable.rex'));
  version=2;
  await json(await s.call('/api/admin/modules/'+mid+'/refresh',{method:'POST'}));
  assert.equal(await (await s.call('/api/modules/'+mid+'/raw')).text(),code('manual.lan',2));
  const module=(await json(await s.call('/api/admin/modules')))[0];
  assert.equal(module.id,mid);assert.equal(module.widget_id,'manual.lan');assert.equal(module.note,'keep this note');
  assert.deepEqual((await json(await s.call('/api/admin/collections'))).find(c=>c.id===col.id).moduleIds,[mid]);
  const after=await json(await s.call('/api/collections/lanstable.rex'));
  assert.equal(after.widgets[0].url,before.widgets[0].url);assert.equal(after.widgets[0].id,before.widgets[0].id);
});

test('scheduled LAN subscription and single-JS refresh share policy; revoking permission retains IDs, collections and last good bytes', async t => {
  let version=1, malformed=false;
  const remoteFetch=async url=>new Response(url.endsWith('.rex') ? JSON.stringify({title:'LAN subscription',widgets:[
    {id:'sub.remote',url:malformed?'http://192.168.1.6:2233/sub.js':lan+'/sub.js'}]}) : code(url.endsWith('/sub.js')?'sub.lan':'single.lan',version));
  const s=await open(t,{trusted:lan,remoteFetch});
  const single=(await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:lan+'/single.js'}}))).added[0].id;
  const source=(await json(await s.call('/api/admin/modules/import',{method:'POST',json:{url:lan+'/list.rex'}}))).subscription.id;
  await cycle(s,source);
  const mods=await json(await s.call('/api/admin/modules')), sub=mods.find(m=>m.id!==single).id;
  const collection=await json(await s.call('/api/admin/collections',{method:'POST',json:{slug:'lanchosen',title:'Chosen',moduleIds:[sub,single]}}));
  await json(await s.call('/api/admin/modules?id='+sub,{method:'PATCH',json:{note:'subscription note'}}));
  const previous=await json(await s.call('/api/collections/lanchosen.rex'));
  await s.stop();
  const db=new DatabaseSync(join(s.directory,'rex.sqlite'));
  db.prepare('UPDATE modules SET updated_at=1 WHERE id=?').run(single);
  db.prepare('UPDATE subscription_sources SET next_sync_at=0 WHERE kind=\'module\' AND id IN (SELECT source_id FROM subscription_items WHERE module_id=?)').run(single);
  db.prepare('UPDATE subscription_sources SET next_sync_at=? WHERE id=?').run(Date.now()+3600000,source);db.close();
  version=2;
  const singles=await open(t,{directory:s.directory,trusted:lan,remoteFetch,config:{DISABLE_SCHEDULER:'false'}});
  let singleDone=false;
  for(let n=0;n<100;n++){
    const rows=await json(await singles.call('/api/admin/modules'));
    if(rows.find(m=>m.id===single)?.version==='2'){singleDone=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.ok(singleDone,'the standalone JS must refresh in the background');
  await singles.stop();
  const due=new DatabaseSync(join(s.directory,'rex.sqlite'));
  due.prepare('UPDATE subscription_sources SET next_sync_at=0 WHERE id=?').run(source);due.close();
  const resumed=await open(t,{directory:s.directory,trusted:lan,remoteFetch,config:{DISABLE_SCHEDULER:'false'}});
  const deadline=Date.now()+7000;
  let refreshed;
  do {
    refreshed=await json(await resumed.call('/api/admin/modules'));
    if(refreshed.length===2 && refreshed.every(m=>m.version==='2'))break;
    await new Promise(resolve=>setTimeout(resolve,20));
  } while(Date.now()<deadline);
  assert.ok(refreshed.every(m=>m.version==='2'),'both background refresh paths must update');
  assert.deepEqual(new Set(refreshed.map(m=>m.id)),new Set([sub,single]));
  assert.equal(refreshed.find(m=>m.id===sub).note,'subscription note');
  assert.deepEqual((await json(await resumed.call('/api/admin/collections'))).find(c=>c.id===collection.id).moduleIds,[sub,single]);
  assert.deepEqual((await json(await resumed.call('/api/collections/lanchosen.rex'))).widgets.map(w=>w.url),previous.widgets.map(w=>w.url));
  await resumed.stop();
  const revoked=await open(t,{directory:s.directory,remoteFetch});
  assert.equal((await revoked.call('/api/admin/modules/'+single+'/refresh',{method:'POST'})).status,400);
  assert.equal((await revoked.call('/api/admin/subscriptions/'+source+'/sync',{method:'POST'})).status,400);
  for(const [id,widget] of [[single,'single.lan'],[sub,'sub.lan']])assert.equal(await (await revoked.call('/api/modules/'+id+'/raw')).text(),code(widget,2));
  await revoked.stop();
  const approved=await open(t,{directory:s.directory,trusted:lan,remoteFetch});
  malformed=true;
  assert.equal((await approved.call('/api/admin/subscriptions/'+source+'/sync',{method:'POST'})).status,400);
  assert.equal(await (await approved.call('/api/modules/'+sub+'/raw')).text(),code('sub.lan',2));
  const items=await json(await approved.call('/api/admin/subscriptions/'+source+'/items'));
  assert.equal(items.find(i=>i.remote_id==='sub.remote').active,1,'failed validation must not mark the old member removed');
});
