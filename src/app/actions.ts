'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { AppError } from '@/agent/core/errors';
import type { DeliverableType, TaskType } from '@/agent/domain/enums';
import type { ContentBlock, ExecActionKind } from '@/agent/domain/models';
import { createBusiness } from '@/agent/profile/bootstrap';
import { FIELD_BY_KEY } from '@/agent/profile/fields';
import { ZERO_USAGE } from './zero';
import { devSignIn, getSessionUser, requireUser, requireWorkspace, SITE_COOKIE, signOut } from '@/server/auth';
import { cookies } from 'next/headers';
import { inSite } from '@/agent/store/authz';
import { createCheckout, createPortal } from '@/server/billing/stripe';
import { getContainer } from '@/server/container';
import { env, supabaseConfigured } from '@/server/env';
import { userClient } from '@/server/supabase/clients';

const isRedirect = (e: unknown) => typeof e === 'object' && !!e && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_REDIRECT');
/** Runs an action; known application errors go back to the page as a readable message (never a stack trace). */
async function guard<T>(back: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (isRedirect(e)) throw e;
    const msg = e instanceof AppError ? e.message : 'Something went wrong. Please try again.';
    if (!(e instanceof AppError)) console.error(e);
    redirect(`${back}${back.includes('?') ? '&' : '?'}e=${encodeURIComponent(msg)}`);
  }
}
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

// ---------- public intake + preview ----------
export async function startPreview(f: FormData) {
  await guard('/', async () => {
    const h = await headers(); const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? 'unknown';
    const { previews } = (await getContainer());
    const { token, id } = await previews.start({ url: s(f, 'url'), zip: s(f, 'zip'), ip });
    after(() => previews.run(id));
    redirect(`/preview/${token}`);
  });
}

// ---------- auth ----------
export async function signUp(f: FormData) {
  const preview = s(f, 'preview'); const back = `/signup${preview ? `?preview=${preview}` : ''}`;
  await guard(back, async () => {
    const email = s(f, 'email').toLowerCase(), password = String(f.get('password') ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError('bad_email', 'Enter a valid email address');
    if (password.length < 10) throw new AppError('weak_password', 'Use a password of at least 10 characters');
    if (supabaseConfigured) {
      const { data, error } = await (await userClient()).auth.signUp({ email, password, options: { emailRedirectTo: `${env.appUrl}/auth/callback${preview ? `?preview=${preview}` : ''}` } });
      if (error) throw new AppError('signup_failed', error.message);
      if (!data.session) redirect(`/login?m=${encodeURIComponent('Check your email to confirm your account, then sign in.')}${preview ? `&preview=${preview}` : ''}`);
    } else { await devSignIn(email); }
    const u = (await getSessionUser())!; if (preview) await (await getContainer()).previews.claim(preview, u).catch(() => undefined);
    redirect('/dashboard');
  });
}
export async function logIn(f: FormData) {
  const preview = s(f, 'preview'); const back = `/login${preview ? `?preview=${preview}` : ''}`;
  await guard(back, async () => {
    const email = s(f, 'email').toLowerCase();
    if (supabaseConfigured) { const { error } = await (await userClient()).auth.signInWithPassword({ email, password: String(f.get('password') ?? '') }); if (error) throw new AppError('login_failed', 'Email or password is incorrect'); }
    else await devSignIn(email);
    const u = (await getSessionUser())!; if (preview) await (await getContainer()).previews.claim(preview, u).catch(() => undefined);
    redirect('/dashboard');
  });
}
export async function logOut() { await signOut(); redirect('/'); }

// ---------- onboarding ----------
export async function createWorkspace(f: FormData) {
  await guard('/onboarding', async () => {
    const user = await requireUser(); const { db, agent } = (await getContainer());
    const ctx = await createBusiness(db, agent.audit, user.id, { name: s(f, 'name'), website: s(f, 'website') || undefined });
    const zip = s(f, 'zip'); if (zip && !/^\d{5}$/.test(zip)) throw new AppError('bad_zip', 'Enter a 5-digit ZIP code');
    const run = await agent.orchestrator.submit(ctx, { request: 'Review my website and tell me what to fix', taskType: 'website_audit', params: { zip: zip || undefined, url: s(f, 'website') || undefined } });
    redirect(`/runs/${run.id}`);
  });
}

// ---------- agent requests ----------
export async function submitRequest(f: FormData) {
  const back = s(f, 'back') || '/ask';
  await guard(back, async () => {
    const { ctx } = await requireWorkspace(); const { agent } = (await getContainer());
    const csv = f.get('keywordCsv'); const file = f.get('keywordFile');
    const keywordCsv = file instanceof File && file.size ? await file.text() : typeof csv === 'string' && csv.trim() ? csv : undefined;
    const comps = s(f, 'competitorUrls').split(/[\s,]+/).filter(Boolean);
    const run = await agent.orchestrator.submit(ctx, {
      request: s(f, 'request') || 'Help me with my marketing', taskType: (s(f, 'taskType') || undefined) as TaskType | undefined,
      params: { url: s(f, 'url') || undefined, competitorUrls: comps.length ? comps : undefined, keywordCsv, keywordSource: s(f, 'keywordSource') || undefined, deliverableType: s(f, 'deliverableType') || undefined, goal: s(f, 'goal') || undefined, offer: s(f, 'offer') || undefined, notes: s(f, 'notes') || undefined, rescan: f.get('rescan') === 'on' },
    });
    redirect(`/runs/${run.id}`);
  });
}
export async function retryRun(f: FormData) { const id = s(f, 'id'); await guard(`/runs/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.orchestrator.retry(ctx, id); redirect(`/runs/${id}`); }); }

// ---------- profile ----------
export async function saveProfile(f: FormData) {
  await guard('/profile', async () => {
    const { ctx } = await requireWorkspace(); const { agent } = (await getContainer()); const updates = [];
    const cur = await agent.profiles.get(ctx);
    for (const [k] of f.entries()) {
      if (!k.startsWith('f_')) continue; const key = k.slice(2); const def = FIELD_BY_KEY.get(key); if (!def) continue;
      const raw = String(f.get(k) ?? '').trim(); const old = cur.fields[key]?.value;
      const value = def.kind === 'list' ? raw.split('\n').map((x) => x.trim()).filter(Boolean) : raw;
      if (!raw || JSON.stringify(value) === JSON.stringify(old)) continue; // only fields the customer actually changed become confirmed
      updates.push({ key, value, provenance: { source: 'customer_confirmed' as const, evidence: 'verified' as const, sourceRef: 'edited by customer' } });
    }
    await agent.profiles.applyUpdates(ctx, updates, { type: 'user', id: ctx.userId });
    redirect(`/profile?m=${encodeURIComponent(updates.length ? `Saved ${updates.length} change(s) and marked them confirmed.` : 'Nothing changed.')}`);
  });
}
export async function confirmField(f: FormData) {
  await guard('/profile', async () => {
    const { ctx } = await requireWorkspace(); const key = s(f, 'key'); const pick = f.get('value');
    const def = FIELD_BY_KEY.get(key); const value = typeof pick === 'string' && pick ? (def?.kind === 'list' ? (JSON.parse(pick) as string[]) : (JSON.parse(pick) as string)) : undefined;
    await (await getContainer()).agent.profiles.confirm(ctx, key, value); redirect('/profile?m=Confirmed.');
  });
}

// ---------- cards ----------
export async function decideCard(f: FormData) {
  const id = s(f, 'id');
  await guard(`/board/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.cards.decide(ctx, id, s(f, 'action') as 'accept' | 'reject' | 'dismiss' | 'reopen', s(f, 'note') || undefined); redirect(`/board/${id}?m=Updated.`); });
}
export async function prepareDeliverable(f: FormData) {
  const id = s(f, 'id');
  await guard(`/board/${id}`, async () => {
    const { ctx } = await requireWorkspace(); const { agent, entitlements } = (await getContainer());
    const card = await agent.cards.get(ctx, id); if (!card.card.deliverableType) throw new AppError('no_type', 'This card has no deliverable to prepare');
    await entitlements.assertCanStart(ctx, 'content_request');
    const scan = (await agent.db.scans.list(ctx.businessId, { label: 'own_site' }, { newestFirst: true })).find((x) => inSite(x, ctx))?.scan;
    const excerpts = (scan?.pages ?? []).filter((p) => p.ok).slice(0, 5).map((p) => ({ url: p.finalUrl, text: [p.title, p.metaDescription, ...p.h1, ...p.h2, p.text.slice(0, 1500)].filter(Boolean).join('\n') }));
    const d = await agent.deliverables.generate(ctx, { type: card.card.deliverableType, cardId: id, brief: `${card.card.title}. ${card.card.recommendation}`, evidence: { finding: card.card.finding, evidence: card.card.evidence }, scanExcerpts: excerpts, suppliedFacts: [] }, { current: ZERO_USAGE() }, { type: 'user', id: ctx.userId } as never);
    await entitlements.recordDeliverable(ctx, d.id);
    redirect(`/deliverables/${d.id}`);
  });
}

// ---------- deliverables ----------
export async function saveVersion(f: FormData) {
  const id = s(f, 'id');
  await guard(`/deliverables/${id}`, async () => {
    const { ctx } = await requireWorkspace(); const { agent } = (await getContainer()); const d = await agent.deliverables.get(ctx, id); const cur = agent.deliverables.current(d);
    const blocks: ContentBlock[] = cur.blocks.map((b) => ({ ...b, text: b.items ? '' : s(f, `b_${b.key}`), ...(b.items ? { items: s(f, `b_${b.key}`).split('\n').map((x) => x.trim()).filter(Boolean) } : {}) }));
    await agent.deliverables.edit(ctx, id, { title: s(f, 'title') || cur.title, blocks, note: s(f, 'note') || undefined }); redirect(`/deliverables/${id}?m=Saved as a new version.`);
  });
}
export async function restoreVersion(f: FormData) { const id = s(f, 'id'); await guard(`/deliverables/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.deliverables.restore(ctx, id, Number(s(f, 'n'))); redirect(`/deliverables/${id}?m=Restored as a new version.`); }); }
export async function acknowledgeFlags(f: FormData) { const id = s(f, 'id'); await guard(`/deliverables/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.deliverables.acknowledgeFlags(ctx, id, f.getAll('flag').map(String)); redirect(`/deliverables/${id}?m=Recorded. You are confirming those statements are true for your business.`); }); }
export async function approveDeliverable(f: FormData) { const id = s(f, 'id'); await guard(`/deliverables/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.deliverables.approve(ctx, id, Number(s(f, 'version'))); redirect(`/deliverables/${id}?m=Approved. Nothing has been published or sent; choose what to do with it below.`); }); }
export async function rejectDeliverable(f: FormData) { const id = s(f, 'id'); await guard(`/deliverables/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.deliverables.reject(ctx, id, s(f, 'reason') || 'Rejected by customer'); redirect(`/deliverables/${id}?m=Rejected.`); }); }

// ---------- execution ----------
export async function requestExecution(f: FormData) {
  const id = s(f, 'id');
  await guard(`/deliverables/${id}`, async () => {
    const { ctx, user } = await requireWorkspace(); const target: Record<string, string> = {};
    if (s(f, 'url')) target.url = s(f, 'url'); if (s(f, 'date')) target.date = s(f, 'date'); if (s(f, 'action') === 'send_transactional_email' && user.email) target.to = user.email;
    await (await getContainer()).agent.execution.request(ctx, { deliverableId: id, action: s(f, 'action') as ExecActionKind, target }); redirect(`/deliverables/${id}?m=Request created. It does nothing until you authorize it.`);
  });
}
export async function authorizeAndRun(f: FormData) {
  const id = s(f, 'id'); const rid = s(f, 'rid');
  await guard(`/deliverables/${id}`, async () => {
    const { ctx, user } = await requireWorkspace(); const { agent } = (await getContainer());
    await agent.execution.authorize(ctx, rid, 'authorized in the app'); const r = await agent.execution.execute(ctx, rid, { actorEmail: user.email });
    redirect(`/deliverables/${id}?${r.status === 'failed' ? 'e' : 'm'}=${encodeURIComponent(r.status === 'failed' ? `Action failed: ${r.error?.message}` : `Done: ${r.result?.detail}`)}`);
  });
}
export async function cancelExecution(f: FormData) { const id = s(f, 'id'); await guard(`/deliverables/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.execution.cancel(ctx, s(f, 'rid')); redirect(`/deliverables/${id}?m=Cancelled.`); }); }

// ---------- strategy / campaigns ----------
export async function approveStrategy(f: FormData) { await guard('/strategy', async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.strategies.approve(ctx, s(f, 'id')); redirect('/strategy?m=Strategy approved.'); }); }
export async function prepareCampaignTask(f: FormData) {
  const id = s(f, 'id');
  await guard(`/campaigns/${id}`, async () => {
    const { ctx } = await requireWorkspace(); const { agent, entitlements } = (await getContainer()); await entitlements.assertCanStart(ctx, 'content_request');
    const d = await agent.campaigns.prepareTask(ctx, id, s(f, 'key'), { current: ZERO_USAGE() }); await entitlements.recordDeliverable(ctx, d.id); redirect(`/deliverables/${d.id}`);
  });
}
export async function markCampaignTask(f: FormData) { const id = s(f, 'id'); await guard(`/campaigns/${id}`, async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.campaigns.markTask(ctx, id, s(f, 'key'), s(f, 'status') as 'done' | 'skipped' | 'in_progress'); redirect(`/campaigns/${id}`); }); }

// ---------- performance ----------
export async function uploadMetrics(f: FormData) {
  await guard('/performance', async () => {
    const { ctx } = await requireWorkspace(); const file = f.get('file'); const csv = file instanceof File && file.size ? await file.text() : s(f, 'csv');
    const r = await (await getContainer()).agent.performance.ingestCsv(ctx, s(f, 'source') || 'csv_upload', csv, { periodStart: s(f, 'start'), periodEnd: s(f, 'end') });
    redirect(`/performance?m=${encodeURIComponent(`Imported ${r.imported} rows${r.rejected.length ? `; ${r.rejected.length} row(s) rejected` : ''}${r.ignoredColumns.length ? `; ignored columns: ${r.ignoredColumns.join(', ')}` : ''}.`)}`);
  });
}

// ---------- billing ----------
export async function startCheckout(f: FormData) {
  await guard('/billing', async () => { const { ctx, user } = await requireWorkspace(); redirect(await createCheckout((await getContainer()).db, { userId: user.id, businessId: ctx.businessId, email: user.email, product: s(f, 'product') as 'marketing_report' | 'marketing_assistant' | 'marketing_studio' | 'marketing_suite', interval: s(f, 'interval') === 'year' ? 'year' : 'month' })); });
}
export async function openPortal() { await guard('/billing', async () => { const { ctx, user } = await requireWorkspace(); redirect(await createPortal((await getContainer()).db, { userId: user.id, businessId: ctx.businessId })); }); }

// ---------- sites, locations, brand (Marketing Suite) ----------
export async function switchSite(f: FormData) {
  const back = s(f, 'back') || '/dashboard';
  await guard(back, async () => { const { ctx } = await requireWorkspace(); const ok = (await (await getContainer()).agent.sites.usable(ctx)).some((x) => x.id === s(f, 'siteId')); if (!ok) throw new AppError('forbidden', 'That website is not available on your plan'); (await cookies()).set(SITE_COOKIE, s(f, 'siteId'), { httpOnly: true, sameSite: 'lax', path: '/' }); redirect(back); });
}
export async function addSite(f: FormData) { await guard('/sites', async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.sites.add(ctx, { name: s(f, 'name'), url: s(f, 'url') }); redirect('/sites?m=Website added. Run a review to analyze it.'); }); }
export async function removeSite(f: FormData) { await guard('/sites', async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.sites.remove(ctx, s(f, 'siteId')); redirect('/sites?m=Website removed.'); }); }
export async function addLocation(f: FormData) {
  await guard('/sites', async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.sites.addLocation(ctx, s(f, 'siteId'), { name: s(f, 'name'), address: s(f, 'address') || undefined, city: s(f, 'city') || undefined, state: s(f, 'state') || undefined, zip: s(f, 'zip') || undefined, phone: s(f, 'phone') || undefined, serviceAreas: s(f, 'serviceAreas').split('\n').map((x) => x.trim()).filter(Boolean) }); redirect('/sites?m=Location added.'); });
}
export async function removeLocation(f: FormData) { await guard('/sites', async () => { const { ctx } = await requireWorkspace(); await (await getContainer()).agent.sites.removeLocation(ctx, s(f, 'siteId'), s(f, 'locationId')); redirect('/sites?m=Location removed.'); }); }
/** Review one site, or every site the plan lets the customer work in. */
export async function reviewSites(f: FormData) {
  await guard('/sites', async () => {
    const { ctx } = await requireWorkspace(); const { agent } = (await getContainer()); const usable = await agent.sites.usable(ctx);
    const targets = s(f, 'siteId') ? usable.filter((x) => x.id === s(f, 'siteId')) : usable; if (!targets.length) throw new AppError('forbidden', 'That website is not available on your plan');
    let last = '';
    for (const site of targets) last = (await agent.orchestrator.submit({ ...ctx, siteId: site.id }, { request: 'Review my website and tell me what to fix', taskType: 'website_audit', params: { url: site.url || undefined, rescan: true } })).id;
    redirect(targets.length === 1 ? `/runs/${last}` : `/sites?m=${encodeURIComponent(`Started ${targets.length} website reviews. Switch websites to see each result.`)}`);
  });
}
export async function runBrandCheck() { await guard('/brand', async () => { const { ctx } = await requireWorkspace(); const n = await (await getContainer()).agent.brand.createCards(ctx); redirect(`/brand?m=${encodeURIComponent(n ? `Brand check finished: ${n} new Action Card(s) added to the affected websites.` : 'Brand check finished: no new issues to add.')}`); }); }
export async function saveBrand(f: FormData) {
  await guard('/brand', async () => {
    const { ctx } = await requireWorkspace(); const scope = s(f, 'scope') || 'shared'; const updates = [];
    for (const [k] of f.entries()) { if (!k.startsWith('f_')) continue; const key = k.slice(2); const def = FIELD_BY_KEY.get(key); if (!def) continue; const raw = String(f.get(k) ?? '').trim(); if (!raw) continue; updates.push({ key, value: def.kind === 'list' ? raw.split('\n').map((x) => x.trim()).filter(Boolean) : raw }); }
    await (await getContainer()).agent.brand.setBrand(ctx, scope, updates); redirect(`/brand?m=Brand guidance saved.`);
  });
}
