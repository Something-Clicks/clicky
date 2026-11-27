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
/**
 * A client acting AS the signed-in customer: publishable key plus that user's access token, so every query is subject to RLS.
 * There is deliberately no service-role client in this application.
 */
export async function customerClient(): Promise<{ client: SupabaseClient; userId: string; email?: string } | null> {
  const uc = await userClient();
  const { data: u } = await uc.auth.getUser(); // verified with the Auth server
  if (!u.user) return null;
  const { data: sess } = await uc.auth.getSession(); const token = sess.session?.access_token; if (!token) return null;
  const client = createClient(env.supabaseUrl!, env.supabaseAnonKey!, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  return { client, userId: u.user.id, email: u.user.email ?? undefined };
}
