/**
 * Structured JSON logging to stdout/stderr (collected by the host).
 * Keys that can hold secrets or personal data are redacted before writing.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const REDACT = /pass(word)?|secret|token|key|authorization|cookie|email|phone|jwt/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack.split("\n").slice(0, 6).join("\n") } : {}),
    };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        REDACT.test(k) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  if (typeof value === "string" && value.length > 2000) return `${value.slice(0, 2000)}…`;
  return value;
}

export function formatLine(level: Level, event: string, fields: Fields = {}): string {
  return JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as Fields) });
}

function write(level: Level, event: string, fields?: Fields) {
  const line = formatLine(level, event, fields);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: Fields) => {
    if (process.env.NODE_ENV !== "production") write("debug", event, fields);
  },
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
