import dns from 'node:dns/promises';
import net from 'node:net';
import { ValidationError } from '../core/errors';

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
export const defaultResolver: Resolver = (h) => dns.lookup(h, { all: true });

const v4 = (ip: string): number[] | null => {
  const p = ip.split('.').map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? p : null;
};
const inV4 = (o: number[], base: string, bits: number): boolean => {
  const b = v4(base)!;
  const toN = (x: number[]) => ((x[0]! << 24) | (x[1]! << 16) | (x[2]! << 8) | x[3]!) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toN(o) & mask) === (toN(b) & mask);
};
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function expandV6(ip: string): number[] | null {
  let s = ip.split('%')[0]!.toLowerCase();
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { const q = v4(m[1]!); if (!q) return null; s = s.replace(m[1]!, ((q[0]! << 8) | q[1]!).toString(16) + ':' + (((q[2]! << 8) | q[3]!).toString(16))); }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for any address that is not a normal public unicast address (fail closed on unparseable input). */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const o = v4(ip);
    return !o || BLOCKED_V4.some(([b, bits]) => inV4(o, b, bits));
  }
  if (kind === 6) {
    const g = expandV6(ip);
    if (!g) return true;
    const embedded = (hi: number, lo: number) => isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(g[6]!, g[7]!); // ::ffff:v4
    if (g.slice(0, 6).every((x) => x === 0)) return embedded(g[6]!, g[7]!); // ::v4 (deprecated)
    if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6]!, g[7]!); // NAT64
    if (g[0] === 0x2002) return embedded(g[1]!, g[2]!); // 6to4
    if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10
    if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    return false;
  }
  return true;
}

const BAD_SUFFIX = ['.local', '.localhost', '.internal', '.lan', '.home', '.home.arpa', '.corp', '.intranet', '.private'];

/** Validate and normalise a customer-supplied URL. Throws ValidationError with a stable code. */
export function parseSafeUrl(input: string): URL {
  const raw = input.trim();
  if (!raw || raw.length > 2048) throw new ValidationError('URL is empty or too long', 'invalid_url');
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { throw new ValidationError('URL could not be parsed', 'invalid_url'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ValidationError('Only http and https URLs are allowed', 'invalid_url');
  if (u.username || u.password) throw new ValidationError('URLs with credentials are not allowed', 'invalid_url');
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new ValidationError('Port not allowed', 'blocked_address');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || BAD_SUFFIX.some((s) => host.endsWith(s)) || !host.includes('.') && net.isIP(host.replace(/^\[|\]$/g, '')) === 0)
    throw new ValidationError('Host is not a public domain name', 'blocked_address');
  if (net.isIP(host.replace(/^\[|\]$/g, ''))) throw new ValidationError('IP-address URLs are not allowed; use a domain name', 'blocked_address');
  u.hash = '';
  return u;
}

/** Resolve and verify every address is public. Called per redirect hop and again at connect time. */
export async function assertPublicHost(hostname: string, resolve: Resolver = defaultResolver): Promise<void> {
  let addrs: { address: string }[];
  try { addrs = await resolve(hostname); } catch { throw new ValidationError(`DNS lookup failed for ${hostname}`, 'dns_failure'); }
  if (!addrs.length) throw new ValidationError(`No DNS records for ${hostname}`, 'dns_failure');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new ValidationError('Host resolves to a non-public address', 'blocked_address');
}
