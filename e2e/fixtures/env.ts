import { execFileSync } from "node:child_process";

/** Shared settings for the end-to-end suite. Everything here points at a LOCAL stack: never Production, never real customers. */
export const PASSWORD = "E2e-Passw0rd!7";
/** Connection string of the throwaway local database (tests/e2e/stack/local-up.sh creates it). */
export const DB = process.env.E2E_DB ?? "postgres://postgres:postgres@localhost:5432/sc_e2e";
/** The public website the "business" under test points at (a real site, read the way a customer's would be). */
export const SITE = process.env.E2E_SITE ?? "nodejs.org";
/** Public sites the Compare tests read. */
export const COMPARE_SITES = (process.env.E2E_COMPARE ?? "pypi.org,huggingface.co").split(",");
/** Words that must never reach a customer's screen. */
export const INTERNALS = /ENOTFOUND|ECONN|fetch failed|stack trace|TypeError|supabase|postgres|rpc\b|undefined|\[object|NaN/i;

/** Runs SQL on the local test database. Refuses anything that does not look like a local throwaway database. */
export function sql(query: string): string {
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\/sc_e2e/.test(DB)) throw new Error("E2E database must be the local sc_e2e database");
  return execFileSync("psql", [DB, "-Atc", query], { encoding: "utf8" }).trim();
}

export const uniqueEmail = (prefix: string) => `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}@local.test`;
