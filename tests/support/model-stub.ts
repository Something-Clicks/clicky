/**
 * A local stand-in for a model server, for protocol tests ONLY. It answers the chat-completions request shape the
 * self-hosted adapter sends. It is not a model: anything it returns proves how our code handles an answer, never that a
 * model can produce it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Seen {
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

export interface Stub {
  url: string;
  seen: Seen[];
  close(): Promise<void>;
}

type Handler = (seen: Seen, res: ServerResponse) => void | Promise<void>;

export async function startStub(handler: Handler): Promise<Stub> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      const s: Seen = { url: req.url ?? "", headers: req.headers, body };
      seen.push(s);
      void handler(s, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

export const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

/** A chat-completions answer carrying `content` as the model's text. */
export const completion = (content: string, extra: Record<string, unknown> = {}) => ({
  id: "stub", model: "stub-model-served", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 40 }, ...extra,
});

/** The smallest value that satisfies a JSON schema (strings "x", arrays empty, first enum member). */
export function sampleFromSchema(schema: unknown): unknown {
  const s = (schema ?? {}) as Record<string, unknown>;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.anyOf)) return sampleFromSchema(s.anyOf[0]);
  switch (s.type) {
    case "object": {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = (s.required ?? Object.keys(props)) as string[];
      return Object.fromEntries(required.filter((k) => k in props).map((k) => [k, sampleFromSchema(props[k])]));
    }
    case "array": return [];
    case "number": case "integer": return 1;
    case "boolean": return true;
    default: return "x";
  }
}
