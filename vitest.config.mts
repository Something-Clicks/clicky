import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { ...alias, "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) } },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        // Real websites, deterministic agent only, no model or key. Run explicitly: SITECHECK_URLS=... pnpm sitecheck.
        resolve: { alias: { ...alias, "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) } },
        test: { name: "sitecheck", include: ["evals/sitecheck/**/*.eval.ts"], environment: "node", fileParallelism: false },
      },
      {
        // Our model server, no database, no customer data. Run explicitly: pnpm modelcheck (see evals/model/modelcheck.eval.ts).
        resolve: { alias: { ...alias, "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) } },
        test: { name: "modelcheck", include: ["evals/model/**/*.eval.ts"], environment: "node", fileParallelism: false },
      },
      {
        resolve: { alias: { ...alias, "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) } },
        test: { name: "db", include: ["tests/db/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false },
      },
    ],
  },
});
