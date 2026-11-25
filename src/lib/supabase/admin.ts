import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

/**
 * Service-role client for the scheduled worker ONLY (src/app/api/cron/**).
 * It bypasses RLS. The database lets it call exactly the worker functions it needs
 * (worker_due_organizations, start/complete/fail_analysis, notification functions).
 * Never use it to serve a customer's request.
 */
export function createWorkerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Worker is not configured: set SUPABASE_SECRET_KEY on the server.");
  const agentKey = process.env.MODEL_USAGE_KEY?.trim();
  return createClient<Database>(url, key, {
    global: agentKey ? { headers: { "x-agent-key": agentKey } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
