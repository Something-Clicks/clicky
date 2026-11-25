/**
 * Model features in the customer application can only be enabled through the provider registry
 * (src/lib/server/agent/provider.ts), never by an API key sitting in the environment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FEATURES } from "@/config/features";
import { getModelProvider, registeredProviders } from "@/lib/server/agent/provider";
import { getClient, isAiConfigured } from "@/lib/server/ai";

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MARKETING_MODEL_PROVIDER", "VERCEL_ENV", "FEATURE_DRAFTS", "FEATURE_BUSINESS_PROFILE", "FEATURE_MODEL_FINDINGS"];

afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("model features stay off without an approved provider", () => {
  it("provider API keys in the environment enable nothing", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    process.env.GEMINI_API_KEY = "test-not-real";
    process.env.MARKETING_MODEL_PROVIDER = "anthropic";
    expect(registeredProviders()).toEqual(["anthropic-dev"]);
    expect(getModelProvider()).toBeNull();
    expect(isAiConfigured()).toBe(false);
    expect(() => getClient()).toThrow(/No model provider is enabled/);
  });

  it("in Production nothing turns on, whatever the variables say", () => {
    Object.assign(process.env, {
      VERCEL_ENV: "production", MARKETING_MODEL_PROVIDER: "anthropic-dev", ANTHROPIC_API_KEY: "sk-test-not-real",
      FEATURE_DRAFTS: "1", FEATURE_BUSINESS_PROFILE: "1", FEATURE_MODEL_FINDINGS: "1",
    });
    expect(getModelProvider()).toBeNull();
    expect([FEATURES.drafts, FEATURES.businessProfile, FEATURES.modelFindings]).toEqual([false, false, false]);
  });

  it("outside Production, features stay off unless switched on one by one", () => {
    expect([FEATURES.drafts, FEATURES.businessProfile, FEATURES.modelFindings]).toEqual([false, false, false]);
    process.env.FEATURE_BUSINESS_PROFILE = "1";
    expect([FEATURES.drafts, FEATURES.businessProfile, FEATURES.modelFindings]).toEqual([false, true, false]);
  });

  it("the old wording code stays off even with a provider enabled", () => {
    Object.assign(process.env, { MARKETING_MODEL_PROVIDER: "anthropic-dev", ANTHROPIC_API_KEY: "sk-test-not-real" });
    expect(getModelProvider()?.id).toBe("anthropic-dev");
    expect(isAiConfigured()).toBe(false);
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
