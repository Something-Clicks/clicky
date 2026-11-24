import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

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

/** Why a fetch was refused. Drives the plain-words message the customer sees (see friendlyReason). */
export type FetchBlockKind = "invalid_address" | "not_public" | "redirects" | "not_a_page" | "too_large" | "status" | "other";

export class FetchBlockedError extends Error {
  constructor(
    message: string,
    readonly kind: FetchBlockKind = "other",
    readonly status?: number,
  ) {
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
    throw new FetchBlockedError("Not a valid web address.", "invalid_address");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError("Only web addresses can be fetched.", "invalid_address");
  if (url.username || url.password) throw new FetchBlockedError("Web addresses with passwords are not allowed.", "invalid_address");
  if (!allowedPorts.includes(url.port)) throw new FetchBlockedError("Only standard web ports are allowed.", "invalid_address");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host)) throw new FetchBlockedError("That address is not public.", "not_public");
  if (net.isIP(host) && !isPublicAddress(host)) throw new FetchBlockedError("That address is not public.", "not_public");
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

  // The socket resolves through this lookup, so the address that is checked is the
  // address that is connected to (no DNS re-binding window). Built on node:http so
  // nothing global (proxies, dispatchers) is changed for the rest of the app.
  const lookup = (
    hostname: string,
    opts: { all?: boolean },
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    resolve(hostname).then(
      (list) => {
        if (list.length === 0 || !list.every((a) => isAllowedAddress(a.address))) {
          return callback(new FetchBlockedError("That website points to a private address.", "not_public") as NodeJS.ErrnoException, "", 0);
        }
        if (opts?.all) return callback(null, list);
        callback(null, list[0]!.address, list[0]!.family);
      },
      (err: Error) => callback(err as NodeJS.ErrnoException, "", 0),
    );
  };

  function request(url: URL, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; res: http.IncomingMessage }> {
    return new Promise((resolvePromise, reject) => {
      const lib = url.protocol === "https:" ? https : http;
      const remaining = Math.max(1, deadline - Date.now());
      const req = lib.request(
        url,
        {
          method: "GET",
          lookup: lookup as never,
          timeout: remaining,
          headers: {
            "user-agent": "SomethingClicksBot/1.0 (+website analysis requested by the site owner)",
            accept: "text/html,application/xhtml+xml",
            "accept-encoding": "gzip, deflate, br",
          },
        },
        (res) => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, res }),
      );
      const timer = setTimeout(() => req.destroy(new Error("timeout")), remaining);
      req.on("close", () => clearTimeout(timer));
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.end();
    });
  }

  function readBody(res: http.IncomingMessage, deadline: number): Promise<{ body: string; truncated: boolean }> {
    return new Promise((resolvePromise, reject) => {
      const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      const finish = (truncated: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        res.destroy();
        resolvePromise({ body: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), truncated });
      };
      const timer = setTimeout(() => finish(true), Math.max(1, deadline - Date.now()));
      stream.on("data", (chunk: Buffer) => {
        if (done) return;
        size += chunk.length;
        if (size > maxBytes) {
          chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
          finish(true);
        } else chunks.push(chunk);
      });
      stream.on("end", () => finish(false));
      stream.on("error", (error) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  return async function safeFetch(raw: string): Promise<FetchedPage> {
    const redirects: string[] = [];
    let current = validateUrl(raw, allowedPorts);
    const deadline = Date.now() + timeoutMs;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      let response;
      try {
        response = await request(current, deadline);
      } catch (error) {
        if (error instanceof FetchBlockedError) throw error;
        throw new Error(`Could not reach ${current.hostname}.`, { cause: error });
      }
      const { status, headers, res } = response;

      if (status >= 300 && status < 400 && headers.location) {
        res.destroy();
        if (hop === maxRedirects) throw new FetchBlockedError("Too many redirects.", "redirects");
        current = validateUrl(new URL(headers.location, current).toString(), allowedPorts);
        redirects.push(current.toString());
        continue;
      }

      const contentType = String(headers["content-type"] ?? "");
      if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        res.destroy();
        throw new FetchBlockedError("That address did not return a web page.", "not_a_page");
      }
      if (Number(headers["content-length"] ?? "0") > maxBytes * 4) {
        res.destroy();
        throw new FetchBlockedError("That page is too large to analyze.", "too_large");
      }
      const { body, truncated } = await readBody(res, deadline);
      return { url: current.toString(), status, contentType, body, truncated, redirects };
    }
    throw new FetchBlockedError("Too many redirects.", "redirects");
  };
}
