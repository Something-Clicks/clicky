import "server-only";

import { lookup as dnsLookup } from "node:dns";
import net from "node:net";

import { Agent, fetch as undiciFetch } from "undici";

/**
 * Fetches a customer's public web page without letting the request reach
 * anything private (SSRF defense):
 *   - only http/https on the default ports, no credentials in the URL;
 *   - every address the hostname resolves to must be public, and the
 *     connection itself uses the validated address (no DNS re-binding window);
 *   - redirects are followed by hand (at most 3), each one re-validated;
 *   - HTML only, a hard size cap, and a timeout.
 */

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

const v4ToInt = (ip: string) => ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !BLOCKED_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

function expandV6(ip: string): number[] {
  const [head, tail = ""] = ip.split("::");
  const parse = (s: string) => (s ? s.split(":") : []);
  let h = parse(head!);
  let t = parse(tail);
  // Embedded IPv4 in the last group (e.g. ::ffff:1.2.3.4)
  const last = (t.length ? t : h).at(-1);
  if (last && last.includes(".")) {
    const n = v4ToInt(last);
    const groups = [(n >>> 16).toString(16), (n & 0xffff).toString(16)];
    if (t.length) t = [...t.slice(0, -1), ...groups];
    else h = [...h.slice(0, -1), ...groups];
  }
  const fill = ip.includes("::") ? 8 - h.length - t.length : 0;
  return [...h, ...Array(fill).fill("0"), ...t].map((g) => parseInt(g || "0", 16));
}

function isPublicV6(ip: string): boolean {
  const g = expandV6(ip.toLowerCase().split("%")[0]!);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return false;
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  // IPv4-mapped / IPv4-compatible / NAT64: judge the embedded IPv4 address.
  const embedded = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPublicV4(embedded());
  if (g[0] === 0x64 && g[1] === 0xff9b) return isPublicV4(embedded());
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (first === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return false; // discard-only
  return true;
}

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchBlockedError";
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
  redirects: string[];
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Tests only: override which resolved addresses may be contacted. */
  isAllowedAddress?: (ip: string) => boolean;
  /** Tests only: override the allowed ports. */
  allowedPorts?: string[];
  /** Tests only: override DNS resolution. */
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

const systemResolve = (hostname: string) =>
  new Promise<{ address: string; family: number }[]>((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );

const BLOCKED_HOST = /(^|\.)(localhost|local|internal|intranet|home|lan|corp)$/i;

export function validateUrl(raw: string, allowedPorts = ["", "80", "443"]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchBlockedError("Not a valid web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("Only web addresses can be fetched.");
  if (url.username || url.password) throw new FetchBlockedError("Web addresses with passwords are not allowed.");
  if (!allowedPorts.includes(url.port)) throw new FetchBlockedError("Only standard web ports are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host)) throw new FetchBlockedError("That address is not public.");
  if (net.isIP(host) && !isPublicAddress(host)) throw new FetchBlockedError("That address is not public.");
  return url;
}

export function createSafeFetcher(options: SafeFetchOptions = {}) {
  const {
    maxBytes = 2_000_000,
    timeoutMs = 10_000,
    maxRedirects = 3,
    isAllowedAddress = isPublicAddress,
    allowedPorts,
    resolve = systemResolve,
  } = options;

  // The connection resolves through this lookup, so the address that is checked
  // is the address that is used.
  const agent = new Agent({
    connect: {
      lookup(hostname, opts, callback) {
        resolve(hostname).then(
          (list) => {
            if (list.length === 0 || !list.every((a) => isAllowedAddress(a.address))) {
              return callback(new FetchBlockedError("That website points to a private address."), "", 0);
            }
            const wantAll = (opts as { all?: boolean }).all;
            if (wantAll) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
            callback(null, list[0]!.address, list[0]!.family);
          },
          (err: Error) => callback(err as NodeJS.ErrnoException, "", 0),
        );
      },
    },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  return async function safeFetch(raw: string): Promise<FetchedPage> {
    const redirects: string[] = [];
    let current = validateUrl(raw, allowedPorts);
    const deadline = AbortSignal.timeout(timeoutMs);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      let res;
      try {
        res = await undiciFetch(current, {
          dispatcher: agent,
          redirect: "manual",
          signal: deadline,
          headers: {
            "user-agent": "SomethingClicksBot/1.0 (+website analysis requested by the site owner)",
            accept: "text/html,application/xhtml+xml",
          },
        });
      } catch (error) {
        const cause = (error as { cause?: unknown }).cause;
        if (cause instanceof FetchBlockedError) throw cause;
        if (error instanceof FetchBlockedError) throw error;
        throw new Error(`Could not reach ${current.hostname}.`, { cause: error });
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        if (hop === maxRedirects) throw new FetchBlockedError("Too many redirects.");
        const next = new URL(res.headers.get("location")!, current);
        current = validateUrl(next.toString(), allowedPorts);
        redirects.push(current.toString());
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        await res.body?.cancel();
        throw new FetchBlockedError("That address did not return a web page.");
      }
      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > maxBytes * 4) {
        await res.body?.cancel();
        throw new FetchBlockedError("That page is too large to analyze.");
      }

      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
            truncated = true;
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }
      const body = new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
      return { url: current.toString(), status: res.status, contentType, body, truncated, redirects };
    }
    throw new FetchBlockedError("Too many redirects.");
  };
}
