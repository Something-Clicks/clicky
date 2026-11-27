import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { env } from '../env';

/** Cookie-bound client for the signed-in user (Supabase Auth). Used only to identify the user. */
export async function userClient() {
  const jar = await cookies();
  return createServerClient(env.supabaseUrl!, env.supabaseAnonKey!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* called from a Server Component: proxy.ts refreshes the session */ } },
    },
  });
}
let admin: SupabaseClient | undefined;
/** Service-role client. SERVER ONLY. The agent enforces roles itself; RLS protects every direct client path. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl!, env.supabaseServiceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
