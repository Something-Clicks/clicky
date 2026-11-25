/**
 * Model features in the customer application can only be enabled through the provider registry
 * (src/lib/server/agent/provider.ts), never by an API key sitting in the environment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { registeredProviders } from "@/lib/server/agent/provider";
import { getClient, isAiConfigured } from "@/lib/server/ai";

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MARKETING_MODEL_PROVIDER"];

afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("model features stay off without an approved provider", () => {
  it("provider API keys in the environment enable nothing", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    process.env.GEMINI_API_KEY = "test-not-real";
    process.env.MARKETING_MODEL_PROVIDER = "anthropic";
    expect(registeredProviders()).toEqual([]);
    expect(isAiConfigured()).toBe(false);
    expect(() => getClient()).toThrow(/No model provider is enabled/);
  });

  it("application code never reads evaluation settings", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, "..", "..", "src"));
    const offenders = files.filter((f) => /EVAL_|evals\/providers/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
