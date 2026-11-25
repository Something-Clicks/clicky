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
        // Provider evaluation: real websites and real provider APIs only. Run explicitly: pnpm eval:providers.
        resolve: { alias: { ...alias, "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) } },
        test: { name: "eval", include: ["evals/**/*.eval.ts"], environment: "node", fileParallelism: false },
      },
      {
        resolve: { alias },
        test: { name: "db", include: ["tests/db/**/*.test.ts"], environment: "node", testTimeout: 30_000, fileParallelism: false },
      },
    ],
  },
});
