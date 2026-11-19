/**
 * Throwaway database for tenant-isolation tests.
 *
 * Creates a fresh database on a local Postgres (never the real project), loads
 * the Supabase stand-in in bootstrap.sql, applies every migration in order, and
 * lets tests run queries as a specific signed-in user exactly as PostgREST does:
 * `set role authenticated` plus the user's JWT claims.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const root = join(__dirname, "..", "..");

function connectionConfig(database: string): pg.ClientConfig {
  const host = process.env.PGHOST ?? "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host) && process.env.ALLOW_REMOTE_TEST_DB !== "1") {
    throw new Error(`Refusing to run database tests against non-local host ${host}.`);
  }
  return {
    host,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? "postgres",
    password: process.env.PGPASSWORD ?? "postgres",
    database,
  };
}

export interface TestDb {
  /** Superuser connection (setup only; bypasses RLS). */
  admin: pg.Client;
  createUser(fullName?: string): Promise<string>;
  /** Runs `fn` in a transaction as the given user (or anon), then commits. */
  as<T>(userId: string | null, fn: (c: pg.Client) => Promise<T>): Promise<T>;
  teardown(): Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const name = `sc_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const maintenance = new pg.Client(connectionConfig("postgres"));
  await maintenance.connect();
  await maintenance.query(`create database ${name}`);

  const admin = new pg.Client(connectionConfig(name));
  await admin.connect();
  await admin.query(readFileSync(join(__dirname, "bootstrap.sql"), "utf8"));
  const dir = join(root, "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await admin.query(readFileSync(join(dir, file), "utf8"));
  }

  const user = new pg.Client(connectionConfig(name));
  await user.connect();

  return {
    admin,
    async createUser(fullName) {
      const { rows } = await admin.query<{ id: string }>(
        "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
        [`${randomUUID()}@example.test`, JSON.stringify(fullName ? { full_name: fullName } : {})],
      );
      return rows[0]!.id;
    },
    async as(userId, fn) {
      await user.query("begin");
      try {
        if (userId) {
          await user.query("set local role authenticated");
          await user.query("select set_config('request.jwt.claims', $1, true)", [
            JSON.stringify({ sub: userId, role: "authenticated" }),
          ]);
        } else {
          await user.query("set local role anon");
        }
        const result = await fn(user);
        await user.query("commit");
        return result;
      } catch (error) {
        await user.query("rollback");
        throw error;
      }
    },
    async teardown() {
      await user.end();
      await admin.end();
      await maintenance.query(`drop database if exists ${name} with (force)`);
      await maintenance.end();
    },
  };
}
