const MAX_REDIRECTS = 5;

// Display compatibility for old stored errors; never guess that an unqualified
// AbortError was a timeout, and never rewrite the historical database rows.
export function displayRemoteError(value) {
  const message=String(value||'');
  if(/^(?:AbortError: )?(?:The|This) operation was aborted\.?$/i.test(message.trim()))return '下载请求被中止，请重试';
  if(/^(?:TimeoutError: )?The operation was aborted due to timeout\.?$/i.test(message.trim()))return '下载超时，请稍后重试';
  return message;
}
export function remoteErrorText(error,{retained=false}={}) {
  const raw=String(error?.message||error),message=displayRemoteError(raw);
  const download=/^REMOTE_(?:TIMEOUT|ABORTED|SHUTDOWN|CONNECTION)$/.test(error?.code||'')||message!==raw;
  return (message+(retained&&download?'；已保留旧版本':'')).slice(0,500);
}
function remoteFailure(error,combined,timeout) {
  let code='',message='';const chain=[],seen=new Set();
  for(let e=error;e&&chain.length<8&&!seen.has(e);e=e.cause){seen.add(e);chain.push(e);}
  if(combined.aborted){
    if(timeout.aborted&&combined.reason===timeout.reason){code='REMOTE_TIMEOUT';message='下载超时（20 秒），请稍后重试';}
    else if(combined.reason?.code==='HUB_SHUTDOWN'){code='REMOTE_SHUTDOWN';message='服务重启，本次同步已中止';}
    else{code='REMOTE_ABORTED';message='下载请求被中止，请重试';}
  }else if(chain.some(e=>e.name==='TimeoutError'||['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(e.code))){code='REMOTE_TIMEOUT';message='下载超时，请稍后重试';}
  else if(chain.some(e=>e.name==='AbortError'||e.code==='ABORT_ERR')){code='REMOTE_ABORTED';message='下载请求被中止，请重试';}
  else if(chain.some(e=>['ECONNRESET','ECONNABORTED','EPIPE','UND_ERR_SOCKET'].includes(e.code))){code='REMOTE_CONNECTION';message='下载连接中断，请稍后重试';}
  return code?Object.assign(new Error(message,{cause:error}),{code}):error;
}

// Only RFC 1918 IPv4 addresses can be explicitly trusted. Loopback, link-local,
// cloud metadata, fake-IP/benchmark and other reserved ranges stay blocked.
export function isPrivateAddress(address) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some(n => n < 0 || n > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Immutable per-server policy: never let one Hub instance change another's
// permissions, and never inherit trust from the parent manifest/redirect.
export function createSourcePolicy(value = '', { addressCheck = true } = {}) {
  if (typeof addressCheck !== 'boolean') throw new Error('SOURCE_ADDRESS_CHECK must be true or false');
  if (typeof value !== 'string') throw new Error('TRUSTED_SOURCE_ORIGINS must be a comma-separated list of HTTP(S) origins');
  const origins = new Set();
  let index = 0;
  for (const entry of value.split(',').map(v => v.trim()).filter(Boolean)) {
    index++;
    let url;
    try {
      url = new URL(entry);
      if (url.pathname !== '/' || url.search || url.hash || url.username || url.password || url.hostname.includes('*')) throw new Error('origin only');
      assertFetchableUrl(url.href, { allowsPrivateOrigin: () => true });
    } catch {
      throw new Error('Invalid TRUSTED_SOURCE_ORIGINS entry #' + index + ' (use an HTTP(S) origin such as http://192.168.1.5:2233; no paths, credentials, wildcards or reserved addresses)');
    }
    origins.add(url.origin);
  }
  const policy = Object.freeze({
    addressCheck,
    allowsPrivateOrigin: url => origins.has(url.origin),
    assertUrl: raw => assertFetchableUrl(raw, policy)
  });
  return policy;
}

export function assertFetchableUrl(raw, policy) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL 格式不合法'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持无账号密码的 http/https 地址');
  // Explicit administrator opt-out. Keep HTTP(S), credential, TLS and body
  // checks; do not classify host/IP/DNS ranges in compatibility mode.
  if (policy?.addressCheck === false) { url.hash = ''; return url; }
  const host = url.hostname.toLowerCase();
  const trusted = policy?.allowsPrivateOrigin(url) === true;
  if (!host || host.includes(':') || host === 'localhost' || /\.localhost$/.test(host) ||
      (!trusted && /\.(internal|local)$/.test(host))) throw new Error('不允许的地址');
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const a = +ip[1], b = +ip[2], c = +ip[3];
    if (isPrivateAddress(host) && !trusted) throw new Error('不允许的内网地址，请由管理员配置 TRUSTED_SOURCE_ORIGINS');
    if (a === 0 || a === 127 || (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
        (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113) || a >= 224) throw new Error('不允许的地址');
  }
  url.hash = '';
  return url;
}

// Limit the stream while it arrives, including chunked bodies and redirects.
export async function fetchRemote(raw, maxBytes, { signal, transport = globalThis.fetch, assertUrl = assertFetchableUrl, headers = {}, allowNotModified = false } = {}) {
  let url = assertUrl(raw), response;
  const timeout = AbortSignal.timeout(20_000);
  // Freeze the first abort reason at dispatch time. Some Node 24 releases
  // resolve AbortSignal.any's reason lazily when both inputs abort in one turn.
  const controller = new AbortController();
  const onTimeout = () => controller.abort(timeout.reason);
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) onAbort();
  else {
    signal?.addEventListener('abort',onAbort,{once:true});
    timeout.addEventListener('abort',onTimeout,{once:true});
  }
  const combined = controller.signal;
  try {
  combined.throwIfAborted();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    response = await transport(url.href, { redirect: 'manual', signal: combined, headers: { 'Cache-Control': 'no-cache', ...(hop===0?headers:{}) } });
    combined.throwIfAborted();
    if (allowNotModified && response.status===304) {
      await response.body?.cancel();
      return {bytes:new Uint8Array(),url:url.href,contentType:'',status:304,etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||''};
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location) break;
    await response.body?.cancel();
    if (hop === MAX_REDIRECTS) throw new Error('重定向次数过多');
    url = assertUrl(new URL(location, url).href);
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error('下载失败：HTTP ' + response.status); }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('文件超过大小上限'); }
  const chunks = [], reader = response.body?.getReader();
  let size = 0;
  try {
    while (reader) {
      combined.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('文件超过大小上限');
      chunks.push(value);
    }
  } catch (error) { await reader?.cancel().catch(() => {}); throw error; }
  combined.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, url: url.href, contentType: response.headers.get('content-type') || '', contentDisposition:response.headers.get('content-disposition')||'', status:response.status,
    etag:response.headers.get('etag')||'',lastModified:response.headers.get('last-modified')||'' };
  } catch(error) { throw remoteFailure(error,combined,timeout); }
  finally {
    signal?.removeEventListener('abort',onAbort);
    timeout.removeEventListener('abort',onTimeout);
  }
}

export function assertModuleFile(bytes, contentType = '') {
  if (!bytes.byteLength) throw new Error('模块文件为空');
  const text = new TextDecoder().decode(bytes.subarray(0, 32768)).trimStart();
  if(/^REXENC(?:\r?\n|$)/.test(text)){if(bytes.byteLength<10)throw Error('加密模块缺少内容');return;}
  if (/text\/html|application\/(?:json|problem\+json)/i.test(contentType) || /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(text)) {
    throw new Error('模块地址返回了网页或 JSON，已保留旧版本');
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    try { JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return; }
    throw new Error('模块地址返回了 JSON，已保留旧版本');
  }
}
