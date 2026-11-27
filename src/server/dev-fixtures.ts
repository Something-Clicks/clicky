// DEV_MODE only: deterministic fake websites so the full customer journey can be exercised without network access.
// Never loaded in production (container.ts refuses, and env.ts refuses DEV_MODE when NODE_ENV=production).
/** A small fake local-business website, deliberately weak in the ways a real small-business site often is. */
export const SITE: Record<string, { status?: number; headers?: Record<string, string>; body: string }> = {
  'https://summitplumbing.example/': { body: `<!doctype html><html lang="en"><head><title>Welcome to our website</title></head><body>
    <nav><a href="/services">Services</a> <a href="/about">About</a></nav>
    <h1>Welcome</h1><p>We are a family business. We have been working hard for our customers. We care about quality and we value our team. Our team is here and we are ready to help you whenever we can. We love what we do and we think you will too. We offer many things and we are happy to talk about them with anyone who stops by our website today.</p>
    <h2>Water heater repair</h2><h2>Drain cleaning</h2><h2>Pipe replacement</h2>
    <p>Serving Salt Lake City, UT and nearby communities. Homeowners trust us.</p><a href="/about">Learn more</a>
    <img src="a.jpg"><img src="b.jpg"><img src="c.jpg"><img src="d.jpg"><img src="e.jpg" alt="van"></body></html>` },
  'https://summitplumbing.example/services': { body: `<html lang="en"><head><title>Services</title><meta name="description" content="Plumbing services in Salt Lake City."><meta name="viewport" content="width=device-width"></head><body><h1>Our Services</h1><h2>Water heater repair</h2><p>We repair and replace tank and tankless water heaters.</p><h2>Drain cleaning</h2><p>Clogged drains cleared.</p><a href="tel:8015550142">Call (801) 555-0142</a></body></html>` },
  'https://summitplumbing.example/about': { body: `<html lang="en"><head><title>About</title><meta name="viewport" content="width=device-width"></head><body><h1>About Summit Plumbing</h1><p>Summit Plumbing is a family-owned plumbing company based in Salt Lake City, UT.</p></body></html>` },
  'https://summitplumbing.example/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /admin\nSitemap: https://summitplumbing.example/sitemap.xml' },
  'https://rivalplumbing.example/': { body: `<html><head><title>Rival Plumbing | Same-day plumbers</title><meta name="description" content="Same-day plumbing repair. Flat-rate pricing."></head><body><h1>Same-day plumbing repair</h1><a class="btn" href="/quote">Get a free quote</a><a href="tel:8015550999">Call now</a><h2>Flat-rate drain cleaning from $129</h2><p>Book online in two minutes.</p></body></html>` },
};

export const fakeFetch: typeof fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const hit = SITE[url] ?? SITE[url.replace(/\/$/, '')];
  if (!hit) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(hit.body, { status: hit.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...(hit.headers ?? {}) } });
}) as typeof fetch;
export const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

