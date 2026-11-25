/**
 * Evaluation settings, from environment variables only. Nothing has a made-up default:
 * a provider without a key, a model or prices is reported as "not run" with the missing names.
 */
import { readFileSync } from "node:fs";

import type { ProviderConfig, ProviderId } from "./adapters";
import type { SiteInput } from "./material";

export const PROVIDERS: ProviderId[] = ["openai", "anthropic", "gemini"];

const KEY_VAR: Record<ProviderId, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };

export function providerConfig(id: ProviderId, env: Record<string, string | undefined> = process.env): { ok: true; cfg: ProviderConfig } | { ok: false; missing: string[] } {
  const P = id.toUpperCase();
  const need = { key: KEY_VAR[id], model: `EVAL_${P}_MODEL`, input: `EVAL_${P}_INPUT_PER_MTOK`, output: `EVAL_${P}_OUTPUT_PER_MTOK` };
  const missing = Object.values(need).filter((v) => !env[v]?.trim());
  const inputPerMTok = Number(env[need.input]);
  const outputPerMTok = Number(env[need.output]);
  if (env[need.input] && !(inputPerMTok >= 0)) missing.push(`${need.input} (not a number)`);
  if (env[need.output] && !(outputPerMTok >= 0)) missing.push(`${need.output} (not a number)`);
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    cfg: { id, apiKey: env[need.key]!, model: env[need.model]!.trim(), effort: env[`EVAL_${P}_EFFORT`]?.trim() || null, inputPerMTok, outputPerMTok },
  };
}

export function loadSites(env = process.env): SiteInput[] {
  const file = env.EVAL_SITES_FILE ?? "evals/providers/sites.json";
  const sites = JSON.parse(readFileSync(file, "utf8")) as SiteInput[];
  if (!Array.isArray(sites) || sites.length < 3 || sites.length > 5) throw new Error(`${file} must list 3 to 5 sites (see sites.example.json).`);
  for (const s of sites) {
    if (!/^https?:\/\//.test(s.url) || !s.business_name) throw new Error(`Each site needs a url (http/https) and a business_name: ${JSON.stringify(s)}`);
  }
  return sites;
}

export const runsPerSite = (env = process.env) => Math.max(1, Math.min(5, Number(env.EVAL_RUNS ?? 2) || 2));
export const outDir = (env = process.env) => env.EVAL_OUT ?? "eval-results";
