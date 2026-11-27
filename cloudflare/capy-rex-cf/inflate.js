// Pure-JavaScript raw DEFLATE decoder (RFC 1951) used for .rex homepage packages.
// Cloudflare's node:zlib does not behave exactly like Node's for every input or
// option, which rejected valid Rex exports there. This decoder gives the same
// result on every runtime and enforces the output limit itself.
// Structure follows the well-known "tiny-inflate" design (MIT).

class Tree {
  constructor() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
}

const LENGTH_BITS = new Uint8Array(30), LENGTH_BASE = new Uint16Array(30);
const DIST_BITS = new Uint8Array(30), DIST_BASE = new Uint16Array(30);
const CLC_ORDER = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

function buildBits(bits, base, delta, first) {
  for (let i = 0; i < delta; i++) bits[i] = 0;
  for (let i = 0; i < 30 - delta; i++) bits[i + delta] = (i / delta) | 0;
  for (let sum = first, i = 0; i < 30; i++) { base[i] = sum; sum += 1 << bits[i]; }
}
buildBits(LENGTH_BITS, LENGTH_BASE, 4, 3);
buildBits(DIST_BITS, DIST_BASE, 2, 1);
// Length code 285 is 258 with no extra bits.
LENGTH_BITS[28] = 0; LENGTH_BASE[28] = 258;

const OFFS = new Uint16Array(16);
function buildTree(t, lengths, off, num) {
  t.table.fill(0);
  for (let i = 0; i < num; i++) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (let sum = 0, i = 0; i < 16; i++) { OFFS[i] = sum; sum += t.table[i]; }
  for (let i = 0; i < num; i++) if (lengths[off + i]) t.trans[OFFS[lengths[off + i]]++] = i;
}

const FIXED_LIT = new Tree(), FIXED_DIST = new Tree();
(() => {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  buildTree(FIXED_LIT, l, 0, 288);
  const d = new Uint8Array(30).fill(5);
  buildTree(FIXED_DIST, d, 0, 30);
})();

class InflateError extends Error {}
const bad = message => { throw new InflateError(message); };

export function inflateRaw(input, maxOutput) {
  const src = input instanceof Uint8Array ? input : new Uint8Array(input);
  let pos = 0, tag = 0, bitcount = 0, outLen = 0;
  let out = new Uint8Array(Math.min(Math.max(1024, src.length * 4), maxOutput + 1));

  const ensure = extra => {
    const need = outLen + extra;
    if (need > maxOutput) bad('解压后超过大小限制');
    if (need <= out.length) return;
    let size = out.length * 2;
    while (size < need) size *= 2;
    const next = new Uint8Array(Math.min(size, maxOutput + 1));
    next.set(out.subarray(0, outLen));
    out = next;
  };
  const getbit = () => {
    if (!bitcount--) {
      if (pos >= src.length) bad('压缩数据不完整');
      tag = src[pos++]; bitcount = 7;
    }
    const bit = tag & 1; tag >>>= 1; return bit;
  };
  const readbits = (num, base) => {
    if (!num) return base;
    let val = 0;
    for (let i = 0; i < num; i++) val |= getbit() << i;
    return val + base;
  };
  const decodeSym = t => {
    let sum = 0, cur = 0, len = 0;
    do {
      cur = 2 * cur + getbit();
      if (++len > 15) bad('压缩数据损坏');
      sum += t.table[len]; cur -= t.table[len];
    } while (cur >= 0);
    return t.trans[sum + cur];
  };

  const lt = new Tree(), dt = new Tree(), codeTree = new Tree();
  const lengths = new Uint8Array(288 + 32);
  const dynamicTrees = () => {
    const hlit = readbits(5, 257), hdist = readbits(5, 1), hclen = readbits(4, 4);
    if (hlit > 286 || hdist > 30) bad('压缩数据损坏');
    lengths.fill(0, 0, 19);
    for (let i = 0; i < hclen; i++) lengths[CLC_ORDER[i]] = readbits(3, 0);
    buildTree(codeTree, lengths, 0, 19);
    for (let num = 0; num < hlit + hdist;) {
      const sym = decodeSym(codeTree);
      if (sym < 16) { lengths[num++] = sym; continue; }
      let prev = 0, length;
      if (sym === 16) { if (!num) bad('压缩数据损坏'); prev = lengths[num - 1]; length = readbits(2, 3); }
      else if (sym === 17) length = readbits(3, 3);
      else length = readbits(7, 11);
      if (num + length > hlit + hdist) bad('压缩数据损坏');
      while (length--) lengths[num++] = prev;
    }
    buildTree(lt, lengths, 0, hlit);
    buildTree(dt, lengths, hlit, hdist);
  };
  const inflateBlock = (lit, dist) => {
    for (;;) {
      const sym = decodeSym(lit);
      if (sym === 256) return;
      if (sym < 256) { ensure(1); out[outLen++] = sym; continue; }
      const li = sym - 257;
      if (li >= 29) bad('压缩数据损坏');
      const length = readbits(LENGTH_BITS[li], LENGTH_BASE[li]);
      const di = decodeSym(dist);
      if (di >= 30) bad('压缩数据损坏');
      const offs = readbits(DIST_BITS[di], DIST_BASE[di]);
      if (offs > outLen) bad('压缩数据损坏');
      ensure(length);
      for (let i = outLen - offs, end = outLen + length; outLen < end;) out[outLen++] = out[i++];
    }
  };
  const storedBlock = () => {
    bitcount = 0; // skip to byte boundary
    if (pos + 4 > src.length) bad('压缩数据不完整');
    const length = src[pos] | (src[pos + 1] << 8), inv = src[pos + 2] | (src[pos + 3] << 8);
    if (length !== (~inv & 0xffff)) bad('压缩数据损坏');
    pos += 4;
    if (pos + length > src.length) bad('压缩数据不完整');
    ensure(length);
    out.set(src.subarray(pos, pos + length), outLen);
    outLen += length; pos += length;
  };

  let final;
  do {
    final = getbit();
    const type = readbits(2, 0);
    if (type === 0) storedBlock();
    else if (type === 1) inflateBlock(FIXED_LIT, FIXED_DIST);
    else if (type === 2) { dynamicTrees(); inflateBlock(lt, dt); }
    else bad('压缩数据损坏');
  } while (!final);
  return out.subarray(0, outLen);
}
