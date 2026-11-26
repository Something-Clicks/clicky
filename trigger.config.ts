import { defineConfig } from "@trigger.dev/sdk";

/**
 * Trigger.dev: durable background execution for the Something Clicks Marketing Agent.
 *
 * Trigger.dev only runs work in the background (queues, retries, status, failure handling). Every decision stays in the
 * central TypeScript orchestrator (src/lib/server/agent/orchestrator.ts); tasks in src/trigger call it and nothing else.
 * No model provider is configured here: model calls, if any, go through the same provider-neutral interface and metering.
 */
export default defineConfig({
  project: "proj_zkgvxkwwahbxpdtqspfe",
  dirs: ["./src/trigger"],
  runtime: "node",
  logLevel: "info",
  // A website review takes about two minutes at worst (fetch + optional model steps inside its own ~105 s deadline);
  // 10 minutes leaves room for slow sites without letting a stuck run hold a worker for long.
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 2_000, maxTimeoutInMs: 30_000, randomize: true },
  },
  build: {
    // The agent modules import "server-only", which is an empty module under the react-server condition (as in Next's
    // server bundles) and throws otherwise.
    conditions: ["react-server"],
  },
});
