// 3.5.8：边读边解析备份 JSON，恢复时更省内存。
// 普通字段照常解析（结果与 JSON.parse 相同）；files.<id>.content（已声明 encoding=base64 的模块文件）
// 一边读一边解码，每读完一个文件就交给 stage() 暂存（Cloudflare 版写进 Durable Object 存储）。
// 这样内存里不再同时放「整份备份文本 + 解析后的对象 + 解码后的全部文件」，同一时间只有一个模块文件。
// 暂存的文件 content 为 ''，另带不可枚举的 staged = {key,size,hash,head}。
import {createHash} from 'node:crypto';

const HEAD_BYTES = 32768;
const FILE_LIMIT = 25 * 1024 * 1024;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const bad = message => Object.assign(new Error(message || '备份不是有效的 JSON 文件'), { status: 400 });
const BOM = [0xef, 0xbb, 0xbf];
const isWs = c => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

function setOwn(target, key, value) {
  // 与 JSON.parse 一样把 "__proto__" 当普通键，不改原型。
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}
function hidden(target, key, value) {
  Object.defineProperty(target, key, { value, writable: true, enumerable: false, configurable: true });
}

// 流式 base64 解码：4 个字符一组，校验字符集、补位和大小上限；同时算 SHA-256，保留开头 32 KB。
class BlobSink {
  constructor(id) { this.id = id; this.carry = ''; this.parts = []; this.size = 0; this.hash = createHash('sha256'); this.head = []; this.headSize = 0; this.padded = false; }
  fail() { throw bad('模块 ' + this.id + ' 的 base64 编码无效'); }
  write(text) {
    if (!text) return;
    let s = this.carry + text;
    const usable = s.length - (s.length % 4);
    this.carry = s.slice(usable); s = s.slice(0, usable);
    if (!s) return;
    if (this.padded || !B64.test(s)) this.fail();
    if (s.includes('=')) { if (!/^[^=]*={1,2}$/.test(s)) this.fail(); this.padded = true; }
    const bytes = Buffer.from(s, 'base64');
    this.size += bytes.length;
    if (this.size > FILE_LIMIT) throw bad('模块 ' + this.id + ' 超过 25 MiB');
    this.hash.update(bytes);
    if (this.headSize < HEAD_BYTES) { const take = bytes.subarray(0, HEAD_BYTES - this.headSize); this.head.push(Buffer.from(take)); this.headSize += take.length; }
    this.parts.push(bytes);
  }
  finish() {
    if (this.carry) this.fail();
    const bytes = Buffer.concat(this.parts); this.parts = [];
    return { id: this.id, size: this.size, hash: this.hash.digest('hex'), head: Buffer.concat(this.head), bytes };
  }
}

// 普通字符串：没有转义时按 UTF-8 逐段解码（不复制整串原始字节）；有转义时交给 JSON.parse。
class TextSink {
  constructor() { this.raw = []; this.text = []; this.decoder = new TextDecoder('utf-8'); this.escaped = false; }
  write(bytes) {
    if (this.escaped) { this.raw.push(Buffer.from(bytes)); return; }
    this.text.push(this.decoder.decode(bytes, { stream: true }));
  }
  // 第一次遇到反斜杠：之前的内容都是完整字符（反斜杠是 ASCII），转回 UTF-8 字节，之后整串交给 JSON.parse。
  markEscape() {
    this.text.push(this.decoder.decode());
    this.raw = [Buffer.from(this.text.join(''), 'utf8')]; this.text = []; this.escaped = true;
  }
  finish() {
    if (!this.escaped) { this.text.push(this.decoder.decode()); this.raw = []; return this.text.join(''); }
    try { return JSON.parse('"' + Buffer.concat(this.raw).toString('utf8') + '"'); } catch { throw bad(); }
  }
}

export function createBackupParser() {
  const stack = []; // {kind:'obj'|'arr', value, key}
  let state = 'value', root, done = false, bom = 0;
  let str = null, lit = null;
  const finished = []; // 已解码完成、等待暂存的文件 {file, entry}

  const top = () => stack[stack.length - 1];
  function afterValue() { state = stack.length ? 'after' : 'end'; }
  function supersede(file) {
    // 同一个文件对象里又出现了 content：以后出现的为准（与 JSON.parse 一致），旧的暂存作废。
    if (file.__staged) { file.__staged.superseded = true; delete file.__staged; }
    if (file.staged) delete file.staged;
  }
  function emit(value) {
    if (!stack.length) { root = value; done = true; afterValue(); return; }
    const t = top();
    if (t.kind === 'arr') t.value.push(value);
    else { if (t.key === 'content' && stack.length === 3) supersede(t.value); setOwn(t.value, t.key, value); }
    afterValue();
  }
  function open(kind) { stack.push({ kind, value: kind === 'obj' ? {} : [], key: null }); state = kind === 'obj' ? 'keyOrEnd' : 'valueOrEnd'; }
  function close() { emit(stack.pop().value); }
  // 当前要开始的字符串值是不是 files.<id>.content，且这个文件已先声明 encoding=base64。
  function blobId() {
    if (stack.length !== 3) return null;
    const [a, b, c] = stack;
    if (a.kind !== 'obj' || a.key !== 'files' || b.kind !== 'obj' || c.kind !== 'obj' || c.key !== 'content') return null;
    return c.value.encoding === 'base64' ? b.key : null;
  }
  function startString(isKey) {
    const id = isKey ? null : blobId();
    str = { isKey, escape: false, blob: id !== null ? new BlobSink(id) : null, text: id !== null ? null : new TextSink() };
    state = 'string';
  }
  function endString() {
    const s = str; str = null;
    if (s.blob) {
      const file = top().value, entry = s.blob.finish();
      supersede(file);
      setOwn(file, 'content', '');
      hidden(file, '__staged', entry);
      finished.push({ file, entry });
      afterValue();
      return;
    }
    const text = s.text.finish();
    if (s.isKey) { top().key = text; state = 'colon'; return; }
    emit(text);
  }
  function endLiteral() {
    let v; try { v = JSON.parse(lit); } catch { throw bad(); }
    lit = null; emit(v);
  }
  function stringChunk(chunk, i, n) {
    if (str.blob) {
      if (str.escape) { // 上一块以反斜杠结尾：base64 里只允许 \/（Mac 风格 JSON）
        if (chunk[i] !== 0x2f) throw bad('备份里的模块内容含有不支持的转义');
        str.blob.write('/'); str.escape = false; return i + 1;
      }
      const q = chunk.indexOf(0x22, i), b = chunk.indexOf(0x5c, i);
      let j = n;
      if (q >= 0) j = q; if (b >= 0 && b < j) j = b;
      if (j > i) str.blob.write(chunk.toString('latin1', i, j));
      if (j >= n) return n;
      if (chunk[j] === 0x22) { endString(); return j + 1; }
      if (j + 1 >= n) { str.escape = true; return n; }
      if (chunk[j + 1] !== 0x2f) throw bad('备份里的模块内容含有不支持的转义');
      str.blob.write('/'); return j + 2;
    }
    let j = i;
    while (j < n) {
      const c = chunk[j];
      if (str.escape) { str.escape = false; j++; continue; }
      if (c === 0x5c) { if (!str.text.escaped) { if (j > i) str.text.write(chunk.subarray(i, j)); i = j; str.text.markEscape(); } str.escape = true; j++; continue; }
      if (c === 0x22) break;
      if (c < 0x20) throw bad();
      j++;
    }
    if (j > i) str.text.write(chunk.subarray(i, j));
    if (j >= n) return n;
    endString(); return j + 1;
  }

  function feed(chunk) {
    let i = 0;
    const n = chunk.length;
    // 开头的 UTF-8 BOM（EF BB BF，可能被拆在几块里）跳过。
    while (bom < 3 && i < n) {
      if (chunk[i] === BOM[bom]) { bom++; i++; continue; }
      if (bom) throw bad();
      bom = 3;
    }
    while (i < n) {
      if (state === 'string') { i = stringChunk(chunk, i, n); continue; }
      const c = chunk[i];
      if (state === 'literal') {
        if (isWs(c) || c === 0x2c || c === 0x7d || c === 0x5d) { endLiteral(); continue; }
        lit += String.fromCharCode(c); if (lit.length > 64) throw bad(); i++; continue;
      }
      if (isWs(c)) { i++; continue; }
      switch (state) {
        case 'valueOrEnd':
          if (c === 0x5d) { i++; close(); break; }
        // falls through
        case 'value':
          if (c === 0x7b) { open('obj'); i++; break; }
          if (c === 0x5b) { open('arr'); i++; break; }
          if (c === 0x22) { startString(false); i++; break; }
          if (c === 0x2d || (c >= 0x30 && c <= 0x39) || c === 0x74 || c === 0x66 || c === 0x6e) { lit = ''; state = 'literal'; break; }
          throw bad();
        case 'keyOrEnd':
          if (c === 0x7d) { i++; close(); break; }
        // falls through
        case 'key':
          if (c === 0x22) { startString(true); i++; break; }
          throw bad();
        case 'colon':
          if (c === 0x3a) { state = 'value'; i++; break; }
          throw bad();
        case 'after': {
          const t = top();
          if (c === 0x2c) { state = t.kind === 'obj' ? 'key' : 'value'; i++; break; }
          if ((t.kind === 'obj' && c === 0x7d) || (t.kind === 'arr' && c === 0x5d)) { i++; close(); break; }
          throw bad();
        }
        default: throw bad();
      }
    }
  }
  return {
    feed,
    takeFinished: () => finished.splice(0),
    end() {
      if (state === 'literal' && !stack.length) endLiteral();
      if (!done || state !== 'end' || str || stack.length) throw bad();
      return root;
    },
  };
}

// 从 ReadableStream 读备份。stage(id, bytes, info) 把一个模块文件暂存起来并返回暂存键。
// 上传大小由外层限制（Cloudflare 100 MB）；这里只在传入 maxBytes 时再检查一次。
export async function readBackupBody(stream, { stage, maxBytes = Infinity } = {}) {
  if (!stream || typeof stream.getReader !== 'function') throw bad();
  const parser = createBackupParser(), reader = stream.getReader();
  async function flush() {
    for (const { file, entry } of parser.takeFinished()) {
      if (entry.superseded) { entry.bytes = null; continue; }
      const key = await stage(entry.id, entry.bytes, entry);
      entry.bytes = null;
      // 暂存期间（同一块里）又被后来的 content 覆盖：这次暂存作废。
      if (entry.superseded || file.__staged !== entry) continue;
      delete file.__staged;
      hidden(file, 'staged', { key, size: entry.size, hash: entry.hash, head: entry.head });
    }
  }
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw bad('备份超过上传大小限制');
      parser.feed(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
      await flush();
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const body = parser.end();
  await flush();
  return body;
}
