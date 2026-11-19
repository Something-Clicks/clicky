import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSafeFetcher, FetchBlockedError, isPublicAddress, validateUrl } from "@/lib/server/safe-fetch";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1",
    "2001:db8::1", "ff02::1", "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe("validateUrl", () => {
  it.each([
    "file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "http://user:pw@example.com",
    "http://example.com:8080", "http://localhost", "http://printer.local", "http://127.0.0.1",
    "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://10.0.0.5", "not a url",
  ])("rejects %s", (u) => {
    expect(() => validateUrl(u)).toThrow(FetchBlockedError);
  });
  it("accepts a normal public site", () => {
    expect(validateUrl("https://example.com/page?x=1").hostname).toBe("example.com");
  });
});

describe("safeFetch against a local server", () => {
  let server: http.Server;
  let port: string;
  // Tests resolve "localhost" (blocked by default) via an explicit allow for 127.0.0.1 only,
  // and use 127.0.0.1.nip-like host names through the system resolver for localhost.
  const allowLoopback = (ip: string) => ip === "127.0.0.1" || ip === "::1";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/page") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><head><title>Hello</title></head><body>Hi</body></html>");
      } else if (req.url === "/redirect") {
        res.writeHead(302, { location: "/page" });
        res.end();
      } else if (req.url === "/to-private") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        res.end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { location: "/loop" });
        res.end();
      } else if (req.url === "/json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(50_000));
      } else {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("missing");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = String((server.address() as AddressInfo).port);
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // "localtest.me"-style names need DNS; instead use a hostname the OS resolves locally.
  const base = () => `http://loopback-test.example:${port}`;
  const resolve = async (host: string) => {
    if (host === "loopback-test.example") return [{ address: "127.0.0.1", family: 4 }];
    if (host === "private-target.example") return [{ address: "10.0.0.7", family: 4 }];
    throw new Error("unknown host");
  };
  const fetcherFor = (extra: Parameters<typeof createSafeFetcher>[0] = {}) =>
    createSafeFetcher({ allowedPorts: ["", "80", "443", port], isAllowedAddress: allowLoopback, resolve, ...extra });

  it("fetches an HTML page", async () => {
    const page = await fetcherFor()(`${base()}/page`);
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>Hello</title>");
  });

  it("follows a same-site redirect and records it", async () => {
    const page = await fetcherFor()(`${base()}/redirect`);
    expect(page.url).toBe(`${base()}/page`);
    expect(page.redirects).toHaveLength(1);
  });

  it("refuses a redirect to a private address", async () => {
    await expect(fetcherFor()(`${base()}/to-private`)).rejects.toThrow(FetchBlockedError);
  });

  it("refuses a hostname that resolves to a private address, at connect time", async () => {
    const f = createSafeFetcher({ allowedPorts: ["", "80", "443", port], resolve });
    await expect(f(`http://private-target.example:${port}/page`)).rejects.toThrow(/private address/);
  });

  it("refuses the loopback host under the default (production) policy", async () => {
    const f = createSafeFetcher({ allowedPorts: ["", "80", "443", port], resolve });
    await expect(f(`${base()}/page`)).rejects.toThrow(FetchBlockedError);
  });

  it("stops redirect loops", async () => {
    await expect(fetcherFor()(`${base()}/loop`)).rejects.toThrow(/Too many redirects/);
  });

  it("refuses non-HTML responses", async () => {
    await expect(fetcherFor()(`${base()}/json`)).rejects.toThrow(/did not return a web page/);
  });

  it("caps the size it reads", async () => {
    const page = await fetcherFor({ maxBytes: 1000 })(`${base()}/big`);
    expect(page.truncated).toBe(true);
    expect(page.body.length).toBe(1000);
  });
});
