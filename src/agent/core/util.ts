import { createHash, randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();

let nowFn: () => Date = () => new Date();
/** Injectable clock so freshness / scheduling logic is testable. */
export const setClock = (fn: (() => Date) | null): void => { nowFn = fn ?? (() => new Date()); };
export const now = (): Date => nowFn();
export const nowIso = (): string => nowFn().toISOString();
export const daysBetween = (a: string | Date, b: string | Date): number =>
  (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const stableStringify = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val);
export const hashContent = (v: unknown): string => sha256(stableStringify(v));

export const normalizeText = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
export const uniq = <T>(a: T[]): T[] => [...new Set(a)];
export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
