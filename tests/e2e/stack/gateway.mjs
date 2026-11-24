// Local stand-in for the Supabase API gateway (e2e only):
//   /auth/v1/*  → GoTrue (Supabase Auth)   on :9999
//   /rest/v1/*  → PostgREST                on :3001
//   /templates/* → email templates (same text as recommended for production)
import { createReadStream } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.GATEWAY_PORT ?? 54321);
const routes = [
  ["/auth/v1", 9999],
  ["/rest/v1", 3001],
];

http
  .createServer((req, res) => {
    if (req.url.startsWith("/templates/")) {
      const name = req.url.slice("/templates/".length).replace(/[^a-z_.]/g, "");
      res.setHeader("content-type", "text/html");
      createReadStream(join(here, "templates", name)).on("error", () => res.writeHead(404).end()).pipe(res);
      return;
    }
    const route = routes.find(([p]) => req.url === p || req.url.startsWith(`${p}/`) || req.url.startsWith(`${p}?`));
    if (!route) return res.writeHead(404).end();
    const [prefix, target] = route;
    const headers = { ...req.headers, host: `127.0.0.1:${target}` };
    const up = http.request({ host: "127.0.0.1", port: target, path: req.url.slice(prefix.length) || "/", method: req.method, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => res.writeHead(502).end());
    req.pipe(up);
  })
  .listen(port, "127.0.0.1", () => console.log(`gateway on :${port}`));
