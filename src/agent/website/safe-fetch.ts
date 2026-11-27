import dns from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { ValidationError } from '../core/errors';
import { assertPublicHost, defaultResolver, isPrivateIp, parseSafeUrl, type Resolver } from './url-guard';

export type FetchFailureCode =
  | 'invalid_url' | 'blocked_address' | 'dns_failure' | 'timeout' | 'network_error' | 'too_many_redirects'
  | 'redirect_loop' | 'unsafe_redirect' | 'http_error' | 'rate_limited' | 'bot_protection'
  | 'unsupported_content_type' | 'robots_disallowed';

export interface FetchResult {
  ok: boolean;
  requestedUrl: string;
  finalUrl: string;
  status?: number;
  redirects: { from: string; to: string; status: number }[];
  contentType?: string;
  body?: string;
  truncated?: boolean;
  elapsedMs: number;
  failure?: { code: FetchFailureCode; message: string };
}
export interface SafeFetchOptions {
  timeoutMs?: number; maxBytes?: number; maxRedirects?: number; userAgent?: string;
  fetchImpl?: typeof fetch; resolve?: Resolver; acceptAnyText?: boolean;
}

/** Connection-time pinning: validates the IPs actually dialled, closing the DNS-rebinding gap. */
const pinnedAgent = new Agent({
  connect: {
    lookup: ((host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      dns.lookup(host, { all: true }, (err, addrs) => {
        if (err) return cb(err);
        if (addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('blocked_address'));
        return opts?.all ? cb(null, addrs) : cb(null, addrs[0]!.address, addrs[0]!.family);
      });
    }) as never,
  },
});
const defaultFetch: typeof fetch = ((url: string, init: object) => undiciFetch(url, { ...init, dispatcher: pinnedAgent } as never)) as never;

export const USER_AGENT = 'SomethingClicksBot/0.1 (+website analysis requested by the site owner)';
const TEXT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'application/xml', 'text/xml'];

async function readCapped(res: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: (await res.text()).slice(0, maxBytes), truncated: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0; let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { chunks.push(value.slice(0, value.byteLength - (size - maxBytes))); truncated = true; await reader.cancel(); break; }
    chunks.push(value);
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks)), truncated };
}

export async function safeFetch(input: string, o: SafeFetchOptions = {}): Promise<FetchResult> {
  const started = Date.now();
  const timeoutMs = o.timeoutMs ?? 10_000;
  const maxRedirects = o.maxRedirects ?? 5;
  const doFetch = o.fetchImpl ?? defaultFetch;
  const resolve = o.resolve ?? defaultResolver;
  const redirects: FetchResult['redirects'] = [];
  const visited = new Set<string>();
  const fail = (code: FetchFailureCode, message: string, extra: Partial<FetchResult> = {}): FetchResult => ({
    ok: false, requestedUrl: input, finalUrl: current, redirects, elapsedMs: Date.now() - started, failure: { code, message }, ...extra,
  });
  let current = input;
  const deadline = started + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try { url = parseSafeUrl(current); await assertPublicHost(url.hostname, resolve); }
    catch (e) {
      const code = (e as ValidationError).code as FetchFailureCode;
      return fail(hop > 0 && (code === 'blocked_address' || code === 'invalid_url') ? 'unsafe_redirect' : code ?? 'invalid_url', (e as Error).message);
    }
    current = url.toString();
    if (visited.has(current)) return fail('redirect_loop', 'Redirect loop detected');
    visited.add(current);

    let res: Response;
    try {
      res = await doFetch(current, {
        redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        headers: { 'user-agent': o.userAgent ?? USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1' },
      });
    } catch (e) {
      const err = e as Error & { cause?: Error };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') return fail('timeout', `No response within ${timeoutMs}ms`);
      if (/blocked_address/.test(String(err.cause?.message ?? err.message))) return fail('blocked_address', 'Connection target resolved to a non-public address');
      return fail('network_error', err.cause?.message ?? err.message);
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      let next: string;
      try { next = new URL(res.headers.get('location')!, current).toString(); } catch { return fail('unsafe_redirect', 'Invalid redirect target', { status: res.status }); }
      redirects.push({ from: current, to: next, status: res.status });
      await res.body?.cancel().catch(() => undefined);
      if (hop === maxRedirects) return fail('too_many_redirects', `More than ${maxRedirects} redirects`, { status: res.status });
      current = next;
      continue;
    }

    const server = (res.headers.get('server') ?? '').toLowerCase();
    const ct = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const { text, truncated } = res.status === 204 ? { text: '', truncated: false } : await readCapped(res, o.maxBytes ?? 1_500_000);
    const base = { requestedUrl: input, finalUrl: current, status: res.status, redirects, contentType: ct, elapsedMs: Date.now() - started };

    if ((res.status === 403 || res.status === 503 || res.status === 429) &&
        (res.headers.get('cf-mitigated') === 'challenge' || /just a moment|cf-chl|attention required|captcha|access denied/i.test(text.slice(0, 4000)) || (server.includes('cloudflare') && res.status !== 429)))
      return { ...base, ok: false, failure: { code: 'bot_protection', message: 'The site served a bot-protection challenge; content could not be read' } };
    if (res.status === 429) return { ...base, ok: false, failure: { code: 'rate_limited', message: `Rate limited${res.headers.get('retry-after') ? ` (retry-after ${res.headers.get('retry-after')})` : ''}` } };
    if (res.status >= 400) return { ...base, ok: false, failure: { code: 'http_error', message: `HTTP ${res.status}` } };
    if (ct && !TEXT_TYPES.includes(ct) && !(o.acceptAnyText && ct.startsWith('text/')))
      return { ...base, ok: false, failure: { code: 'unsupported_content_type', message: `Unsupported content type ${ct}` } };
    return { ...base, ok: true, body: text, truncated };
  }
  return fail('too_many_redirects', 'Too many redirects');
}
