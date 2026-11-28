/**
 * Model features in the customer application can only be enabled through the provider registry
 * (src/lib/server/agent/provider.ts), never by an API key sitting in the environment.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discoveryAvailable, FEATURES } from "@/config/features";
import { getModelProvider, registeredProviders } from "@/lib/server/agent/provider";

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "MARKETING_MODEL_PROVIDER", "VERCEL_ENV", "FEATURE_DRAFTS", "FEATURE_BUSINESS_PROFILE", "FEATURE_MODEL_FINDINGS", "FEATURE_STRATEGY", "DISCOVERY_IN_PRODUCTION"];

afterEach(() => KEYS.forEach((k) => delete process.env[k]));

describe("model features stay off without an approved provider", () => {
  it("provider API keys in the environment enable nothing", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-not-real";
    process.env.OPENAI_API_KEY = "sk-test-not-real";
    process.env.GEMINI_API_KEY = "test-not-real";
    process.env.MARKETING_MODEL_PROVIDER = "anthropic";
    expect(registeredProviders()).toEqual(["groq", "self-hosted"]);
    expect(getModelProvider()).toBeNull();
  });

  it("in Production no model runs and the model features stay off whatever the variables say; only the model-free screens are released", () => {
    Object.assign(process.env, {
      VERCEL_ENV: "production", MARKETING_MODEL_PROVIDER: "self-hosted", ANTHROPIC_API_KEY: "sk-test-not-real",
      FEATURE_DRAFTS: "1", FEATURE_MODEL_FINDINGS: "1",
    });
    expect(getModelProvider()).toBeNull();
    expect([FEATURES.drafts, FEATURES.modelFindings]).toEqual([false, false]);
    // Released to customers (owner decision, Nov 28 2026), with no variable needed.
    expect([FEATURES.agent, FEATURES.campaigns, FEATURES.businessProfile, FEATURES.strategy]).toEqual([true, true, true, true]);
    // A kill switch: FEATURE_<NAME>=0 turns a released screen back off.
    process.env.FEATURE_STRATEGY = "0";
    expect(FEATURES.strategy).toBe(false);
    delete process.env.FEATURE_STRATEGY;
    // Discovery sends a place and a service phrase to third parties, so it waits for the Privacy Policy wording.
    expect(discoveryAvailable()).toBe(false);
    process.env.DISCOVERY_IN_PRODUCTION = "1";
    expect(discoveryAvailable()).toBe(true);
    delete process.env.DISCOVERY_IN_PRODUCTION;
  });

  it("outside Production, features stay off unless switched on one by one", () => {
    expect([FEATURES.drafts, FEATURES.businessProfile, FEATURES.modelFindings]).toEqual([false, false, false]);
    process.env.FEATURE_BUSINESS_PROFILE = "1";
    expect([FEATURES.drafts, FEATURES.businessProfile, FEATURES.modelFindings]).toEqual([false, true, false]);
  });

  it("no application code imports a hosted AI provider's SDK or names its key variable", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, "..", "..", "src"));
    const offenders = files.filter((f) => /@anthropic-ai|from "openai"|@google\/genai|ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    expect(JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")).dependencies).not.toHaveProperty("@anthropic-ai/sdk");
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
