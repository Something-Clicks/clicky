/** Small RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). Input is untrusted. */
export function parseCsv(text: string, maxRows = 20_000): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) { if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === '\t' || c === ';') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; if (rows.length > maxRows) break; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((x) => x.trim())) rows.push(row); }
  return rows;
}
export function csvToObjects(text: string): Record<string, string>[] {
  const [head, ...rest] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
export const toNumber = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined; const t = s.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (!t || t === '-' || /^n\/?a$/i.test(t)) return undefined;
  const mult = /k$/i.test(t) ? 1e3 : /m$/i.test(t) ? 1e6 : 1; const n = Number(t.replace(/[km]$/i, ''));
  return Number.isFinite(n) ? n * mult : undefined;
};
