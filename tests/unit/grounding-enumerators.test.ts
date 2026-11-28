/**
 * Found by a real model run (Groq, gpt-oss-120b): our own checks refused good drafts because list numbering looked like an invented
 * figure and a markdown heading "### 1." looked like a "#1 ranking" promise. Real figures and real promises must still be caught.
 */
import { describe, expect, it } from "vitest";

import { claimProblemIn, promisePhrases, unsupportedNumbers } from "@/lib/server/agent/grounding";

const SOURCE = "Sunrise Plumbing in Provo since 2009. Call (801) 555-0123.";

describe("list numbering is not a figure", () => {
  it("ignores numbered steps, outlines and headings", () => {
    expect(unsupportedNumbers("How it works: 1) Call us. 2) We assess your pipes. 3) You get a plan.", SOURCE)).toEqual([]);
    expect(unsupportedNumbers("1. Headline\n2. Intro\n10. Contact", SOURCE)).toEqual([]);
    expect(unsupportedNumbers("### 1. Know your customer\nText\n### 2. Pick a channel", SOURCE)).toEqual([]);
  });
  it("still catches a real invented figure, in any of those layouts", () => {
    expect(unsupportedNumbers("1) Call us. We have served 500 customers.", SOURCE)).toEqual(["500"]);
    expect(unsupportedNumbers("1. Intro\n2. We save you 40% on repairs", SOURCE)).toEqual(["40"]);
    expect(unsupportedNumbers("Over 500 happy customers", SOURCE)).toEqual(["500"]);
    expect(unsupportedNumbers("Since 2009 and 2011", SOURCE)).toEqual(["2011"]);
  });
  it("ignores 'Step 1', 'Tip 2' style labels, but not a figure next to them", () => {
    expect(unsupportedNumbers("Step 1: Call us. Step 2: We assess. Tip 3: ask early.", SOURCE)).toEqual([]);
    expect(unsupportedNumbers("Step 1: Call us, we reply within 24 hours.", SOURCE)).toEqual(["24"]);
  });
  it("keeps accepting figures that are in the source, and ignores bracketed placeholders", () => {
    expect(unsupportedNumbers("Since 2009, call (801) 555-0123 [your 24/7 line]", SOURCE)).toEqual([]);
  });
});

describe("a heading number is not a '#1' promise, a real one still is", () => {
  it("does not flag markdown headings or numbered lists", () => {
    expect(claimProblemIn("### 1. Identify your ideal customer")).toBeNull();
    expect(claimProblemIn("## 1) Start here")).toBeNull();
    expect(promisePhrases("### 1. Tips\n#### 2. More")).toEqual([]);
  });
  it("still flags #1 claims however they are written", () => {
    expect(claimProblemIn("We are #1 in Provo")).toBe("promise");
    expect(claimProblemIn("Rated # 1 by customers")).toBe("promise");
    expect(claimProblemIn("Rank #1 on Google")).toBe("promise");
    expect(claimProblemIn("We guarantee results")).toBe("promise");
  });
});
