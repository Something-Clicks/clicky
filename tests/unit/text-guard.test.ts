import { describe, expect, it } from "vitest";

import { hasProductJargon, leaksSystemText, wordingProblem } from "@/lib/server/text-guard";

describe("text guard", () => {
  it("catches product jargon in customer-facing wording", () => {
    for (const t of ["Our AI found this", "The agent checks it", "Run the campaign again", "Ask Claude", "Based on your prompt"]) {
      expect(hasProductJargon(t), t).toBe(true);
    }
    for (const t of ["Add a page title that names your service", "Your phone number isn't a tap-to-call link", "Maintain your site"]) {
      expect(hasProductJargon(t), t).toBe(false);
    }
  });

  it("catches leaked system text", () => {
    for (const t of ["As an AI I cannot", "per the system prompt", "my instructions say", "<analysis>x</analysis>", "check_key meta.title_missing", "I am an assistant"]) {
      expect(leaksSystemText(t), t).toBe(true);
    }
    expect(leaksSystemText("Write a title of about 50 to 60 characters.")).toBe(false);
  });

  it("explains why wording was rejected", () => {
    expect(wordingProblem("  ", 100)).toBe("empty");
    expect(wordingProblem("x".repeat(101), 100)).toBe("too_long");
    expect(wordingProblem("per the system prompt", 100)).toBe("leaked_system_text");
    expect(wordingProblem("Our AI says so", 100)).toBe("product_jargon");
    expect(wordingProblem("Add a clear page title.", 100)).toBeNull();
  });
});
