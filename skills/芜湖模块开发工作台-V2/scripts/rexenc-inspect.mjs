import {open, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {TextDecoder} from 'node:util';
const MAX = 4 * 1024 * 1024;
function decode64(s) {
  if (typeof s !== 'string' || !s.length || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw Error('Invalid canonical Base64');
  const b = Buffer.from(s, 'base64');
  if (b.toString('base64') !== s) throw Error('Invalid canonical Base64');
  return b;
}
export function inspectBytes(bytes) {
  if (bytes.length > MAX) throw Error('Input exceeds 4 MiB');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length !== 3 || lines[0] !== 'REXENC') throw Error('Not a three-line REXENC envelope');
  const h = JSON.parse(lines[1]);
  if (!h || h.v !== 2 || h.mkv !== 'rex-1' || h.alg !== 'A256GCM') throw Error('Unsupported envelope version or algorithm');
  const iv = decode64(h.iv), kb = decode64(h.kb), payload = decode64(lines[2]);
  if (iv.length !== 12 || kb.length !== 60 || payload.length <= 16) throw Error('Invalid envelope field lengths');
  return {format:'REXENC', v:h.v, mkv:h.mkv, alg:h.alg, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), ivBytes:iv.length, kbBytes:kb.length, payloadBytes:payload.length, authenticated:false, decrypted:false};
}
async function readBounded(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX) throw Error('Expected a regular file of at most 4 MiB');
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(MAX + 1); let at = 0;
    while (at < buf.length) { const {bytesRead} = await handle.read(buf, at, buf.length-at, null); if (!bytesRead) break; at += bytesRead; }
    if (at > MAX) throw Error('Input exceeds 4 MiB');
    return buf.subarray(0, at);
  } finally { await handle.close(); }
}
function selfTest() {
  const header = {v:2,mkv:'rex-1',alg:'A256GCM',iv:Buffer.alloc(12).toString('base64'),kb:Buffer.alloc(60).toString('base64')};
  const make = (h=header,p=Buffer.alloc(17).toString('base64')) => Buffer.from('REXENC\n'+JSON.stringify(h)+'\n'+p);
  let count=0;
  function test(fn) {fn();count++;}
  test(()=>assert.equal(inspectBytes(make()).decrypted,false));
  test(()=>assert.equal(inspectBytes(make()).authenticated,false));
  test(()=>assert.equal(inspectBytes(Buffer.concat([make(),Buffer.from('\n')])).payloadBytes,17));
  test(()=>assert.equal(inspectBytes(Buffer.from(make().toString().replaceAll('\n','\r\n'))).ivBytes,12));
  test(()=>assert.throws(()=>inspectBytes(make({...header,v:3}))));
  test(()=>assert.throws(()=>inspectBytes(make({...header,alg:'AES-CBC'}))));
  test(()=>assert.throws(()=>inspectBytes(make({...header,iv:'AA=='}))));
  test(()=>assert.throws(()=>inspectBytes(make({...header,kb:'AA=='}))));
  test(()=>assert.throws(()=>inspectBytes(make(header,Buffer.alloc(16).toString('base64')))));
  test(()=>assert.throws(()=>inspectBytes(make(header,'!!!!'))));
  test(()=>assert.throws(()=>inspectBytes(Buffer.from('globalThis.shouldNeverRun = true;'))));
  test(()=>assert.throws(()=>inspectBytes(Buffer.concat([make(),Buffer.from('\nextra')]))));
  test(()=>assert.throws(()=>inspectBytes(Buffer.alloc(MAX+1))));
  test(()=>assert.throws(()=>inspectBytes(Buffer.from([255]))));
  test(()=>assert.throws(()=>inspectBytes(make(header,'AB=='))));
  test(()=>assert.throws(()=>inspectBytes(Buffer.from('REXENC\nnull\nAAAA'))));
  test(()=>assert.equal(inspectBytes(make()).sha256.length,64));
  test(()=>assert.equal(JSON.stringify(inspectBytes(make())).includes(header.kb),false));
  console.log(JSON.stringify({ok:true,tests:count,scope:'static synthetic envelope checks; no AES or App execution'}));
}
try {
  const [mode,file] = process.argv.slice(2);
  if(mode==='self-test' && !file) selfTest();
  else if(mode==='inspect' && file && process.argv.length===4) console.log(JSON.stringify(inspectBytes(await readBounded(file)),null,2));
  else throw Error('Usage: node scripts/rexenc-inspect.mjs self-test | inspect <file>');
} catch {
  console.error('Static inspection failed: check command, file size, UTF-8, v2 header and canonical Base64. No input executed or uploaded.');
  process.exitCode=1;
}
