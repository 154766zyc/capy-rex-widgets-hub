import { lookup } from 'node:dns';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { assertFetchableUrl, isPrivateAddress } from './remote.js';

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||
      (a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||
      (a===192&&b===0&&(c===0||c===2))||(a===192&&b===88&&c===99)||
      (a===198&&(b===18||b===19||(b===51&&c===100)))||(a===203&&b===0&&c===113));
  }
  // IPv6 global unicast only; reject loopback, mapped IPv4, ULA and link-local.
  if (isIP(address) !== 6 || !/^[23]/i.test(address) || /^(?:2002:|3fff:)/i.test(address)) return false;
  if (/^2001:/i.test(address)) {
    const second = parseInt(address.split(':')[1] || '0', 16);
    if (second === 0 || second === 2 || (second >= 0x10 && second <= 0x3f) || second === 0xdb8) return false;
  }
  return true;
}

function checkedLookup(hostname, options, callback, allowPrivate = false, resolver = lookup, addressCheck = true) {
  resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    // Validate the address actually passed to connect(), not a separate DNS
    // preflight that would permit rebinding on the second resolution.
    if (!addresses.length || (addressCheck && addresses.some(a => !isPublicAddress(a.address) &&
        !(allowPrivate && isIP(a.address) === 4 && isPrivateAddress(a.address))))) {
      return callback(new Error('域名解析到内网或保留地址，已拒绝下载'));
    }
    const preferred = addresses.filter(a => !options.family || options.family===a.family);
    if (!preferred.length) return callback(new Error('域名没有符合地址族要求的可用地址'));
    if (options.all) callback(null, preferred);
    else callback(null, preferred[0].address, preferred[0].family);
  });
}

export function publicLookup(hostname, options, callback) {
  checkedLookup(hostname, options, callback);
}

// Trust is bound to this exact origin and checked against every actual DNS
// answer unless the administrator explicitly disables address checks.
export function createSourceLookup(raw, policy, resolver = lookup) {
  const url = assertFetchableUrl(raw, policy);
  const allowPrivate = policy?.allowsPrivateOrigin(url) === true;
  return (hostname, options, callback) => {
    if (hostname.toLowerCase() !== url.hostname.toLowerCase()) return callback(new Error('下载主机与可信来源不匹配'));
    checkedLookup(hostname, options, callback, allowPrivate, resolver, policy?.addressCheck !== false);
  };
}

// Node transport for the Docker process. No shared credentials, proxy env or
// automatic redirects; fetchRemote validates each redirect and bounds the body.
export function createPublicFetch(policy) {
  return function sourceFetch(raw, { headers, signal } = {}) {
    return new Promise((resolve, reject) => {
      const url = assertFetchableUrl(raw, policy);
      if (policy?.addressCheck !== false && isIP(url.hostname) && !isPublicAddress(url.hostname) &&
          !(policy?.allowsPrivateOrigin(url) && isPrivateAddress(url.hostname))) return reject(new Error('不允许的地址'));
      const request = (url.protocol==='https:'?httpsRequest:httpRequest)(url, {
        method: 'GET', headers, signal, lookup: createSourceLookup(url.href, policy), agent: false
      }, response => {
        try {
          const responseHeaders = new Headers();
          for (const [name,value] of Object.entries(response.headers)) if(value!==undefined) responseHeaders.set(name,Array.isArray(value)?value.join(', '):value);
          resolve(new Response([204,205,304].includes(response.statusCode)?null:Readable.toWeb(response), {
            status:response.statusCode,headers:responseHeaders
          }));
          if ([204,205,304].includes(response.statusCode)) response.resume();
        } catch (error) { response.destroy(); reject(error); }
      });
      request.on('error',reject);
      request.end();
    });
  };
}

export const publicFetch = createPublicFetch();
