import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "./env";
import type { Database } from "./types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * Acts as the signed-in user (cookie session), so Row Level Security always applies.
 * There is no service-role client in this app.
 */
export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();
  // The server key for model work goes with every request this server makes as the signed-in user (never to the browser):
  // the database functions that store model-produced work refuse requests without it. See agent_key_ok in migration 20261202.
  const agentKey = process.env.MODEL_USAGE_KEY?.trim();
  return createServerClient<Database>(url, publishableKey, {
    global: agentKey ? { headers: { "x-agent-key": agentKey } } : undefined,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Server Components cannot set cookies; src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
