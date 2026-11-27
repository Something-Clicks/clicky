import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AppError } from '@/agent/core/errors';
import type { Ctx } from '@/agent/store/authz';
import { getContainer } from './container';
import { env, supabaseConfigured } from './env';
import { userClient } from './supabase/clients';

export interface SessionUser { id: string; email?: string }
const DEV_COOKIE = 'sc_dev_user';
const BIZ_COOKIE = 'sc_biz';
export const SITE_COOKIE = 'sc_site';

export async function getSessionUser(): Promise<SessionUser | null> {
  if (supabaseConfigured) {
    const { data } = await (await userClient()).auth.getUser(); // verified with the Auth server, not just the cookie
    return data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null;
  }
  if (env.devMode) {
    const v = (await cookies()).get(DEV_COOKIE)?.value; if (!v) return null;
    const [id, email] = v.split('|'); return id ? { id, email } : null;
  }
  return null;
}
export async function devSignIn(email: string): Promise<SessionUser> {
  if (!env.devMode || env.isProd) throw new Error('Dev sign-in is disabled');
  const jar = await cookies();
  const id = `dev-${Buffer.from(email.toLowerCase()).toString('hex').slice(0, 24)}`;
  jar.set(DEV_COOKIE, `${id}|${email}`, { httpOnly: true, sameSite: 'lax', path: '/' });
  return { id, email };
}
export async function signOut() {
  if (supabaseConfigured) await (await userClient()).auth.signOut();
  (await cookies()).delete(DEV_COOKIE); (await cookies()).delete(BIZ_COOKIE);
}
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser(); if (!u) redirect('/login'); return u;
}
/** The signed-in user's active workspace. Role checks happen again inside every agent service call. */
export async function getWorkspace(): Promise<{ user: SessionUser; ctx: Ctx; business: { id: string; name: string; website?: string }; site: { id: string; name: string; isPrimary: boolean } } | null> {
  const user = await getSessionUser(); if (!user) return null;
  const { db } = getContainer();
  const mine = await db.members.listAcross({ userId: user.id }); if (!mine.length) return null;
  const want = (await cookies()).get(BIZ_COOKIE)?.value;
  const m = mine.find((x) => x.businessId === want) ?? mine[0]!;
  const b = await db.businesses.get(m.businessId, m.businessId); if (!b) return null;
  const base: Ctx = { userId: user.id, businessId: b.id };
  const usable = await getContainer().agent.sites.usable(base); const wantSite = (await cookies()).get(SITE_COOKIE)?.value;
  const site = usable.find((s) => s.id === wantSite) ?? usable.find((s) => s.isPrimary) ?? usable[0]!;
  return { user, ctx: { ...base, siteId: site.id }, business: { id: b.id, name: b.name, website: b.website }, site: { id: site.id, name: site.name, isPrimary: site.isPrimary } };
}
export async function requireWorkspace() {
  const user = await requireUser(); const w = await getWorkspace();
  if (!w) redirect('/onboarding'); void user; return w;
}

/** Other tenants' ids, missing rows and forbidden reads all look identical to the requester: a plain 404. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound(); throw e; }
}
