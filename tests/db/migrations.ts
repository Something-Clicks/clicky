import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type pg from "pg";

const root = join(__dirname, "..", "..", "supabase");

/** Migrations with a rollback file, in order. */
const reversible = () =>
  readdirSync(join(root, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => f.replace(/\.sql$/, ""))
    .filter((m) => readdirSync(join(root, "rollback")).includes(`${m}_down.sql`));

/** Rolls back every migration from `from` onward, newest first (the only safe order). */
export async function rollbackFrom(admin: pg.Client, from: string) {
  for (const m of reversible().filter((x) => x >= from).reverse()) {
    await admin.query(readFileSync(join(root, "rollback", `${m}_down.sql`), "utf8"));
  }
}

/** Re-applies every migration from `from` onward, in order. */
export async function reapplyFrom(admin: pg.Client, from: string) {
  for (const m of reversible().filter((x) => x >= from)) {
    await admin.query(readFileSync(join(root, "migrations", `${m}.sql`), "utf8"));
  }
}
