import type { EvidenceClass } from "./evidence";

/**
 * Research Library import (specification §4.3): keyword research the owner supplies. Semrush is used through the owner's
 * existing manual workflow (they export a CSV and paste or upload it here); no Semrush API is connected. Google Search
 * Console "Queries" exports are accepted the same way. A plain list of keywords the owner cares about is also accepted.
 *
 * The file is untrusted input: it is parsed as data only, every value is length-capped and stripped of control characters,
 * numbers are parsed strictly, and unknown columns are ignored.
 *
 * Evidence classes, so measured search data is never confused with estimates:
 *   Semrush         -> estimated. Volume, difficulty and cost per click are Semrush's own modelled estimates; the
 *                      position is what Semrush's crawler recorded on the export date. The basis says so.
 *   Search Console  -> verified. Clicks, impressions and position are Google's measurements for this site.
 *   owner list      -> verified that the owner named the term; it carries no figures at all.
 */
export type ResearchSource = "semrush_export" | "search_console_export" | "owner";
export const RESEARCH_SOURCES: Record<ResearchSource, string> = {
  semrush_export: "Semrush export",
  search_console_export: "Google Search Console export",
  owner: "Your own list",
};
export const isResearchSource = (v: unknown): v is ResearchSource => typeof v === "string" && Object.hasOwn(RESEARCH_SOURCES, v);

export interface ResearchRow {
  term: string;
  metrics: Record<string, number | string>;
  evidence_class: EvidenceClass;
  basis: string | null;
}

export interface ParsedResearch {
  rows: ResearchRow[];
  /** Lines that could not be used, with why (shown to the owner). */
  skipped: { line: number; reason: string }[];
  /** The source the columns look like, when it differs from the one chosen. */
  detected: ResearchSource | null;
}

export const MAX_RESEARCH_ROWS = 500;
export const MAX_RESEARCH_CHARS = 300_000;

const clean = (v: string, max: number) => v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** RFC 4180-style CSV (quotes, escaped quotes, commas, tabs or semicolons as the separator). */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", "\t", ";"].map((s) => ({ s, n: first.split(s).length })).sort((a, b) => b.n - a.n)[0]!.s;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** "1,200" → 1200; "12.5%" → 12.5; "$1.20" → 1.2; anything else → null. */
export function parseNumber(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim().replace(/[,$%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : null;
}

const HEADERS: Record<string, RegExp> = {
  term: /^(keyword|keywords|query|top queries|search query|term)$/,
  position: /^(position|pos\.?|average position|avg\.? position)$/,
  volume: /^(search volume|volume)$/,
  difficulty: /^(keyword difficulty|kd|kd ?%)$/,
  cpc: /^(cpc|cpc \(usd\))$/,
  url: /^(url|landing page)$/,
  intent: /^(intent|intents|keyword intents)$/,
  clicks: /^(clicks)$/,
  impressions: /^(impressions)$/,
};

function detect(cols: Record<string, number>): ResearchSource | null {
  if (cols.impressions !== undefined || cols.clicks !== undefined) return "search_console_export";
  if (cols.volume !== undefined || cols.difficulty !== undefined) return "semrush_export";
  return null;
}

export function parseResearch(text: string, source: ResearchSource, measuredOn: string): ParsedResearch {
  const skipped: ParsedResearch["skipped"] = [];
  if (text.length > MAX_RESEARCH_CHARS) return { rows: [], skipped: [{ line: 0, reason: "The file is too large. Split it into smaller parts." }], detected: null };
  const table = parseCsv(text);
  if (!table.length) return { rows: [], skipped: [], detected: null };

  const header = table[0]!.map((h) => clean(h, 60).toLowerCase());
  const cols: Record<string, number> = {};
  header.forEach((h, i) => {
    for (const [key, re] of Object.entries(HEADERS)) if (cols[key] === undefined && re.test(h)) cols[key] = i;
  });
  // A plain list without a header: every line is one keyword.
  const hasHeader = cols.term !== undefined;
  const body = hasHeader ? table.slice(1) : table;
  const termCol = hasHeader ? cols.term! : 0;
  const detected = hasHeader ? detect(cols) : null;

  const semrushBasis = `Search volume, difficulty and cost per click are Semrush's own estimates; the position is what Semrush recorded on ${measuredOn}. From an export you supplied.`;
  const seen = new Set<string>();
  const rows: ResearchRow[] = [];
  body.forEach((cells, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const term = clean(cells[termCol] ?? "", 200);
    if (!term) { skipped.push({ line, reason: "No keyword on this line." }); return; }
    const key = term.toLowerCase();
    if (seen.has(key)) { skipped.push({ line, reason: "Repeated keyword." }); return; }
    if (rows.length >= MAX_RESEARCH_ROWS) { skipped.push({ line, reason: `Only the first ${MAX_RESEARCH_ROWS} keywords are imported at a time.` }); return; }
    seen.add(key);
    const metrics: Record<string, number | string> = {};
    if (source !== "owner") {
      for (const k of ["position", "volume", "difficulty", "cpc", "clicks", "impressions"] as const) {
        const n = cols[k] !== undefined ? parseNumber(cells[cols[k]!]) : null;
        if (n !== null && n >= 0) metrics[k] = n;
      }
      if (cols.url !== undefined) {
        const u = clean(cells[cols.url] ?? "", 300);
        if (/^https?:\/\//i.test(u)) metrics.url = u;
      }
      if (cols.intent !== undefined) {
        const t = clean(cells[cols.intent] ?? "", 60).toLowerCase();
        if (t) metrics.intent = t;
      }
    }
    rows.push(
      source === "semrush_export"
        ? { term, metrics, evidence_class: "estimated", basis: semrushBasis }
        : { term, metrics, evidence_class: "verified", basis: null },
    );
  });
  return { rows, skipped, detected: detected && detected !== source ? detected : null };
}

/**
 * Plain-language intent of a search term: Semrush's label when supplied, otherwise read from words in the term itself.
 * The second is an inference from wording (show it as such), never a measurement.
 */
export function searchIntent(term: string, supplied?: string): "commercial" | "informational" | "navigational" | "local" | "unknown" {
  const s = (supplied ?? "").toLowerCase();
  if (/commercial|transactional/.test(s)) return "commercial";
  if (/informational/.test(s)) return "informational";
  if (/navigational/.test(s)) return "navigational";
  const t = term.toLowerCase();
  if (/\b(near me|nearby|local)\b/.test(t) || /\bin [a-z]{3,}/.test(t)) return "local";
  if (/\b(how|what|why|when|guide|tips|ideas|vs|cost of)\b/.test(t)) return "informational";
  if (/\b(buy|price|prices|quote|hire|best|service|services|company|repair|install|installation)\b/.test(t)) return "commercial";
  return "unknown";
}
