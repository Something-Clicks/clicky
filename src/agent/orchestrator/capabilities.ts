import { NeedsInputError, ValidationError } from '../core/errors';
import { daysBetween, nowIso } from '../core/util';
import type { CapabilityId, DeliverableType } from '../domain/enums';
import { DeliverableType as DeliverableTypeEnum } from '../domain/enums';
import type { Finding, WebsiteScan } from '../domain/models';
import { competitorFindings, gapFindings, localSeoFindings, modelFindings, ruleFindings } from '../capabilities/analysis';
import { understandBusiness } from '../capabilities/business-intelligence';
import { marketResearch, researchCompetitors } from '../capabilities/market-research';
import { analyzeLocalSeo, clusterKeywords, findContentGaps, importKeywordCsv } from '../capabilities/seo-intelligence';
import { ProfileService } from '../profile/service';
import { inSite, siteOf } from '../store/authz';
import { draftFeature } from '../plans';
import { scanWebsite } from '../website/crawler';
import { parseSafeUrl } from '../website/url-guard';
import { inferDeliverableType } from './classify';
import type { CapabilityDef, RunEnv } from './types';

/** Tolerates scans stored before URLs were normalised (bare domains). */
const sameHost = (a: string, b: string) => { try { return parseSafeUrl(a).hostname === parseSafeUrl(b).hostname; } catch { return false; } };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function ownScan(env: RunEnv): Promise<WebsiteScan | undefined> {
  if (env.state.scanId) return (await env.agent.db.scans.get(env.ctx.businessId, env.state.scanId))?.scan;
  return (await env.agent.db.scans.list(env.ctx.businessId, { label: 'own_site' }, { newestFirst: true })).find((s) => inSite(s, env.ctx))?.scan;
}
async function websiteUrl(env: RunEnv): Promise<string | undefined> {
  if (env.params.url) return env.params.url;
  const site = await env.agent.sites.get(env.ctx, siteOf(env.ctx)).catch(() => undefined);
  if (site?.url) return site.url;
  const p = await env.agent.profiles.getInternal(env.ctx.businessId);
  return ProfileService.text(p, 'website');
}
const objectivesOf = (p: Awaited<ReturnType<ProfileService['getInternal']>>) => ProfileService.list(p, 'marketing_objectives');

/** Workflows centred on the website must have one; others read it when available and carry on without it. */
const SITE_CENTRIC = ['website_audit', 'homepage_copy', 'seo_research', 'marketing_plan', 'business_profile'];
export const website_intelligence: CapabilityDef = {
  id: 'website_intelligence',
  async preflight({ agent, ctx, params, taskType }) {
    const url = params.url ?? (await agent.sites.get(ctx, siteOf(ctx)).catch(() => undefined))?.url ?? ProfileService.text(await agent.profiles.effective(ctx), 'website');
    if (!url) return SITE_CENTRIC.includes(taskType) ? ['What is your website address?'] : [];
    try { parseSafeUrl(url); } catch (e) { return [`The website address "${url}" is not valid: ${(e as Error).message}`]; }
    return [];
  },
  async run(env) {
    const url = await websiteUrl(env);
    if (!url) { env.limitations.push('No website is on file, so the website was not read.'); return 'No website on file; skipped.'; }
    const cached = !env.params.rescan && (await env.agent.db.scans.list(env.ctx.businessId, { label: 'own_site' }, { newestFirst: true })).find((s) => inSite(s, env.ctx));
    if (cached && cached.scan.pages.length && daysBetween(cached.scan.scannedAt, nowIso()) < 1 && sameHost(cached.scan.startUrl, url)) {
      env.state.scanId = cached.id; env.limitations.push(...cached.scan.limitations);
      return `Reused the website scan from ${cached.scan.scannedAt.slice(0, 16)} (less than a day old): ${cached.scan.pages.length} page(s).`;
    }
    const scan = await scanWebsite(url, { ...env.agent.crawl, maxPages: env.params.maxPages ?? env.agent.crawl.maxPages });
    env.limitations.push(...scan.limitations);
    if (!scan.pages.length && !SITE_CENTRIC.includes(env.exec.taskType)) {
      env.limitations.push(`The website could not be read (${scan.failures[0]?.message ?? 'unknown error'}); continued with the information already in your profile.`);
      return 'Website could not be read; continued without it.';
    }
    if (!scan.pages.length) {
      const why = scan.failures[0]?.message ?? 'unknown error';
      throw Object.assign(new ValidationError(`The website could not be read (${scan.failures[0]?.code ?? 'error'}: ${why}). Nothing was assumed about its content.`, 'website_unreachable'), {});
    }
    const row = await env.agent.db.scans.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), scan, label: 'own_site' });
    env.state.scanId = row.id; env.state.scanFresh = true;
    await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'website', title: `Website scan: ${scan.finalUrl}`, data: { scanId: row.id, pages: scan.pages.map((p) => ({ url: p.finalUrl, type: p.type, title: p.title })), failures: scan.failures, completeness: scan.completeness }, evidence: 'verified', source: scan.finalUrl ?? url, collectedAt: scan.scannedAt });
    const u = new URL(scan.finalUrl ?? url);
    await env.agent.profiles.applyUpdates(env.ctx, [{ key: 'website', value: u.origin, provenance: { source: 'website', evidence: 'verified', sourceRef: u.origin } }, { key: 'domain', value: u.hostname.replace(/^www\./, ''), provenance: { source: 'website', evidence: 'verified' } }], { type: 'agent', id: 'agent' });
    return `Read ${scan.pages.length} page(s)${scan.failures.length ? `, ${scan.failures.length} failure(s)` : ''}; scan is ${scan.completeness}.`;
  },
};

export const business_intelligence: CapabilityDef = {
  id: 'business_intelligence',
  async preflight({ agent, ctx, params, taskType }) {
    const p = await agent.profiles.effective(ctx);
    const hasSite = !!(params.url ?? ProfileService.text(p, 'website'));
    const facts = Object.keys(p.fields).filter((k) => !['name', 'website', 'domain'].includes(k)).length;
    if (!hasSite && facts < 3 && !params.notes && ['content_request', 'campaign', 'competitor_research'].includes(taskType))
      return ['Tell me about your business: what you sell or offer, who your customers are, and where you work. (Or add your website address.)'];
    return [];
  },
  async run(env) {
    // Business understanding draws on the website: read it here when this workflow didn't (e.g. competitor research, campaigns, content).
    let scan = await ownScan(env);
    if (!scan && (await websiteUrl(env))) { await website_intelligence.run(env); scan = await ownScan(env); }
    const p = await env.agent.profiles.effective(env.ctx);
    const supplied: Record<string, unknown> = {};
    const updates: Parameters<ProfileService['applyUpdates']>[1] = [];
    if (env.params.zip) updates.push({ key: 'zip_codes', value: [env.params.zip], provenance: { source: 'customer_supplied', evidence: 'verified', sourceRef: 'intake form' } });
    if (env.params.notes) { supplied.notes = env.params.notes; }
    if (!scan && !env.params.notes && Object.keys(p.fields).length <= 3) throw new NeedsInputError(['No website content or description is available. Tell me about your business.']);
    if (updates.length) await env.agent.profiles.applyUpdates(env.ctx, updates, { type: 'user', id: env.ctx.userId });
    const fresh = await env.agent.profiles.effective(env.ctx);
    const res = await understandBusiness(env.agent.llm, { scan, supplied, existing: ProfileService.summarize(fresh) }, env.usage);
    env.mock.value ||= res.mock; env.models.add(res.model);
    const out = await env.agent.profiles.applyUpdates(env.ctx, res.updates, { type: 'agent', id: 'agent' });
    env.state.profileApplied = out.applied; env.state.profileConflicts = out.conflicts; env.state.downgraded = res.downgraded;
    env.questions.push(...res.openQuestions);
    const comp = await env.agent.profiles.completeness(env.ctx.businessId, env.ctx.siteId);
    return `Updated ${out.applied.length} profile field(s)${out.conflicts.length ? `, ${out.conflicts.length} conflict(s) need your confirmation` : ''}${res.downgraded.length ? `; ${res.downgraded.length} claim(s) downgraded to "inferred" because no matching quote was found` : ''}. ${comp.missingCore.length} core field(s) still unknown.`;
  },
};

export const seo_intelligence: CapabilityDef = {
  id: 'seo_intelligence', optional: (t) => t !== 'seo_research',
  async run(env) {
    const scan = await ownScan(env); if (!scan) return 'No website scan available; SEO checks skipped.';
    const profile = await env.agent.profiles.effective(env.ctx);
    const findings: Finding[] = []; const notes: string[] = [];
    const local = analyzeLocalSeo(scan, ProfileService.list(profile, 'service_areas').filter((a) => !a.startsWith('ZIP ')));
    findings.push(...localSeoFindings(local, scan));
    const rid: string[] = env.state.researchIds ?? [];
    rid.push((await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'local_seo', title: 'Local SEO checks', data: local, evidence: 'verified', source: scan.finalUrl ?? scan.startUrl, collectedAt: nowIso() })).id);
    if (env.params.keywordCsv && !(await env.agent.gate.has(env.ctx, 'research_advanced'))) { env.limitations.push('Keyword and content-gap analysis is part of Marketing Studio; it was skipped.'); }
    else if (env.params.keywordCsv) {
      const imp = importKeywordCsv(env.params.keywordCsv, env.params.keywordSource ?? 'semrush_manual_import', ProfileService.list(profile, 'service_areas').map((a) => a.split(',')[0]!.trim()));
      if (imp.warnings.length) env.limitations.push(...imp.warnings);
      if (imp.rows.length) {
        const gaps = findContentGaps(imp.rows, scan); const clusters = clusterKeywords(imp.rows);
        rid.push((await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'keyword', title: `Keyword research (${imp.rows.length} keywords, ${imp.source})`, data: { rows: imp.rows.slice(0, 500), clusters: clusters.slice(0, 30), skipped: imp.skipped, measured: true }, evidence: 'verified', source: imp.source, collectedAt: nowIso() })).id);
        rid.push((await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'content_gap', title: `Content gaps (${gaps.length})`, data: { gaps: gaps.slice(0, 100) }, evidence: 'verified', source: imp.source, collectedAt: nowIso() })).id);
        findings.push(...gapFindings(gaps, imp.source)); notes.push(`${imp.rows.length} keywords imported, ${gaps.length} content gap(s)`);
      }
    } else env.limitations.push('No keyword data was supplied (e.g. a Semrush export), so search volumes, rankings and keyword gaps were not analysed.');
    env.state.researchIds = rid; env.state.seoFindings = findings;
    return `${local.checks.filter((c) => c.status === 'fail').length} local SEO issue(s)${notes.length ? '; ' + notes.join('; ') : ''}.`;
  },
};

export const market_research: CapabilityDef = {
  id: 'market_research', optional: (t) => t !== 'competitor_research',
  async preflight({ agent, params, taskType }) { return taskType === 'competitor_research' && !params.competitorUrls?.length && agent.discovery.name === 'none' ? ['Which competitors should I look at? Paste up to 5 competitor website addresses.'] : []; },
  async run(env) {
    await env.agent.gate.require(env.ctx, 'research_advanced');
    const p = await env.agent.profiles.effective(env.ctx); const sum = ProfileService.summarize(p, ['business']);
    const business = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v.value])); const rid: string[] = env.state.researchIds ?? []; const notes: string[] = [];
    // Competitors the customer named are used as given. Otherwise the agent finds candidates itself from public sources (labelled, never silently trusted).
    let compUrls = env.params.competitorUrls; let discovered: { via: string[]; names: string[] } | undefined;
    if (!compUrls?.length && env.agent.discovery.name !== 'none') {
      const first = (v: unknown) => String(Array.isArray(v) ? (v[0] ?? '') : (v ?? '')).trim();
      const industry = first(business.industry); const area = first(business.service_areas) || first(business.service_area) || first(business.location);
      if (!industry || !area) env.limitations.push('Competitors could not be discovered automatically because the business type or service area is not known yet.');
      else {
        const d = await env.agent.discovery.competitors({ industry, place: area, ownUrl: await websiteUrl(env), limit: 5 });
        if (d.candidates.length) { compUrls = d.candidates.map((c) => c.website!); discovered = { via: d.sources, names: d.candidates.map((c) => c.name) };
          env.limitations.push(`Competitors were discovered automatically (${d.sources.join(', ')}) as ${industry} businesses near ${area}, and have not been confirmed by you: ${d.candidates.map((c) => `${c.name} (${c.website})`).join('; ')}.`); }
        else env.limitations.push(`No competitors were found automatically for ${industry} near ${area}${d.errors.length ? ` (${d.errors.join('; ')})` : ''}; none are guessed.`);
      }
    }
    if (compUrls?.length) {
      const r = await researchCompetitors(env.agent.llm, { business, ownScan: await ownScan(env), competitors: compUrls.map((url) => ({ url })), crawl: env.agent.crawl }, env.usage);
      env.mock.value ||= r.mock; if (r.model !== 'none') env.models.add(r.model);
      const ids: string[] = [];
      for (const s of r.scans) ids.push((await env.agent.db.scans.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), scan: s.scan, label: 'competitor', subject: s.subject })).id);
      env.state.competitorScanIds = ids;
      if (r.comparison.competitors.length) {
        rid.push((await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'competitor', title: `Competitor comparison (${r.comparison.competitors.length}${discovered ? ', discovered automatically' : ''})`, data: discovered ? { ...r.comparison, discovered } : r.comparison, evidence: 'inferred', source: r.scans.map((s) => s.subject).join(', '), collectedAt: nowIso() })).id);
        env.state.competitorFindings = competitorFindings(r.comparison); notes.push(`${r.comparison.competitors.length} competitor(s) compared`);
      }
      for (const s of r.skipped) env.limitations.push(`Competitor ${s.url} could not be read: ${s.reason}`);
      if (!r.comparison.competitors.length && env.exec.taskType === 'competitor_research') throw new ValidationError('None of the competitor websites could be read, so no comparison was made. ' + r.skipped.map((s) => `${s.url}: ${s.reason}`).join('; '), 'competitors_unreadable');
    } else if (!env.limitations.some((l) => /competitor/i.test(l))) env.limitations.push('No competitors were supplied or discovered, so no competitor comparison was made; competitors are never guessed.');
    const lib = (await env.agent.db.research.list(env.ctx.businessId, undefined, { newestFirst: true })).filter((r) => inSite(r, env.ctx)).slice(0, 20).map((r) => ({ id: r.id, kind: r.kind, title: r.title, data: r.data, evidence: r.evidence, collectedAt: r.collectedAt }));
    const m = await marketResearch(env.agent.llm, { business, library: lib, source: env.agent.researchSource, notes: env.params.notes }, env.usage);
    env.mock.value ||= m.mock; env.models.add(m.model);
    rid.push((await env.agent.db.research.insert({ businessId: env.ctx.businessId, siteId: siteOf(env.ctx), kind: 'market', title: 'Market research notes', data: { findings: m.findings, researchQuestions: m.researchQuestions, externalSource: m.externalSource, sourcesUsed: m.sourcesUsed }, evidence: m.sourcesUsed ? 'verified' : 'inferred', source: m.externalSource, collectedAt: m.collectedAt })).id);
    if (!m.sourcesUsed) env.limitations.push(m.sourceErrors?.length ? `The market-research source (${m.externalSource}) could not be reached (${m.sourceErrors.join('; ')}); market findings are hypotheses, not measured data.` : 'No external market-research source returned results; market findings are hypotheses, not measured data.');
    env.questions.push(...m.researchQuestions.slice(0, 3));
    env.state.researchIds = rid;
    return notes.concat(`${m.findings.length} market note(s)`).join('; ') + '.';
  },
};

export const marketing_analysis: CapabilityDef = {
  id: 'marketing_analysis',
  async run(env) {
    const profile = await env.agent.profiles.effective(env.ctx); const scan = await ownScan(env);
    let findings: Finding[] = [];
    if (scan) findings.push(...ruleFindings(scan, profile));
    findings.push(...(env.state.seoFindings ?? []), ...(env.state.competitorFindings ?? []));
    if (env.state.reportId) {
      const rep = await env.agent.db.reports.get(env.ctx.businessId, env.state.reportId);
      const recs = (rep?.data as { recommendations?: { recommendations: { title: string; rationale: string; metricRefs: string[]; confidence: 'high' | 'medium' | 'low'; action: string; deliverableType?: DeliverableType }[] } } | undefined)?.recommendations?.recommendations ?? [];
      findings.push(...recs.map((r, i): Finding => ({ key: `perf_${i}_${r.metricRefs[0]}`, category: 'customer_acquisition', origin: 'model', dependsOn: [], title: r.title, observed: r.rationale, where: [], evidence: r.metricRefs.map((m) => ({ kind: 'metric' as const, source: 'performance report', text: m })), whyItMatters: 'Results show whether marketing is working.', affected: 'The business', consequence: 'Without acting on results, effort may be misdirected.', confidence: r.confidence, impact: 'medium', evidenceClass: 'verified', missingInfo: [], recommendation: r.action, effort: 'low', deliverableType: r.deliverableType })));
      findings.push(...await env.agent.performance.followUpFindings(env.ctx));
    }
    if (env.exec.taskType === 'homepage_copy' && !findings.some((f) => f.deliverableType === 'headline_set')) {
      const h = scan?.pages[0];
      findings.push({ key: 'homepage_copy_request', category: 'messaging', origin: 'rule', ruleId: 'request', dependsOn: [], title: 'Rewrite the homepage headline and opening message', observed: h ? `Current homepage headline: "${h.h1[0] ?? h.title ?? '(none found)'}".` : 'Requested by the owner.', where: h ? [h.finalUrl] : [], evidence: h ? [{ kind: 'quote', source: h.finalUrl, text: h.h1[0] ?? h.title ?? 'no headline' }] : [{ kind: 'observation', source: 'request', text: 'Requested by the owner' }], whyItMatters: 'The headline is the first thing visitors read.', affected: 'First-time visitors', consequence: 'A weak first message loses interested visitors.', confidence: 'medium', impact: 'high', evidenceClass: 'verified', missingInfo: [], recommendation: 'Lead with the main service, who it is for, and the benefit.', effort: 'low', deliverableType: 'headline_set' });
    }
    const m = await modelFindings(env.agent.llm, { profile, scan, rules: findings, extraSupplied: JSON.stringify(env.params.notes ?? ''), comparison: undefined }, env.usage).catch((e) => { env.limitations.push(`Model-based messaging analysis was skipped: ${(e as Error).message}`); return { findings: [] as Finding[], dropped: 0, mock: false }; });
    env.mock.value ||= m.mock; findings.push(...m.findings);
    if (m.dropped) env.limitations.push(`${m.dropped} model finding(s) were discarded because their evidence could not be matched to retrieved text.`);
    // Progress tracking: on a FRESH, clean scan, previously reported rule-based issues that are no longer detected are marked resolved.
    let resolved = 0;
    if (env.state.scanFresh && scan && scan.pages.length && !scan.failures.length) { resolved = (await env.agent.cards.reconcile(env.ctx, findings.filter((f) => f.origin === 'rule'), { type: 'agent', id: 'agent' })).length; env.state.resolvedCount = resolved; }
    const seen = new Set<string>(); findings = findings.filter((f) => (seen.has(f.key) ? false : (seen.add(f.key), true)));
    if (!findings.length) return `No evidence-backed problems were found in the information available.${resolved ? ` ${resolved} earlier issue(s) are now resolved.` : ''}`;
    const cards = await env.agent.cards.createFromFindings(env.ctx, findings, { executionId: env.exec.id, objectives: objectivesOf(profile), actor: { type: 'agent', id: 'agent' } });
    env.state.cardIds = [...(env.state.cardIds ?? []), ...cards.map((c) => c.id)]; env.state.findingCount = findings.length;
    const matched = await env.agent.cards.matchExisting(env.ctx, findings);
    const eligible = matched.filter((c) => c.card.deliverableType && !['rejected', 'dismissed'].includes(c.card.status)).sort((a, b) => a.card.priority.rank - b.card.priority.rank);
    const pool = env.exec.taskType === 'homepage_copy' ? eligible.filter((c) => c.card.deliverableType === 'headline_set') : eligible;
    const limit = env.exec.taskType === 'homepage_copy' ? 1 : 2;
    env.state.focusCardIds = pool.filter((c) => !c.card.deliverableId).slice(0, limit).map((c) => c.id);
    env.state.existingDeliverableIds = pool.filter((c) => c.card.deliverableId).slice(0, limit).map((c) => c.card.deliverableId!);
    return `${findings.length} finding(s) → ${cards.length} new Action Card(s)${findings.length - cards.length ? ` (${findings.length - cards.length} already on your board)` : ''}${resolved ? `; ${resolved} earlier issue(s) no longer detected and marked resolved` : ''}.`;
  },
};

export const marketing_strategy: CapabilityDef = {
  id: 'marketing_strategy',
  async run(env) {
    if (env.exec.taskType === 'performance_review' && !(await env.agent.strategies.latest(env.ctx))) return 'No existing strategy to adjust; skipped.';
    const s = await env.agent.strategies.generate(env.ctx, env.usage, { executionId: env.exec.id, focus: env.exec.taskType === 'performance_review' ? 'Adjust the existing strategy using the latest performance report and follow-up findings.' : undefined });
    env.state.strategyId = s.id; return `Strategy drafted: ${s.data.objectives.length} objective(s), ${s.data.channels.length} channel(s), ${s.data.prioritizedActions.length} prioritised action(s).`;
  },
};

export const campaign_planning: CapabilityDef = {
  id: 'campaign_planning',
  async preflight({ params, request }) { return params.goal || request.length > 15 ? [] : ['What should the campaign achieve, and which service or offer is it for?']; },
  async run(env) {
    const c = await env.agent.campaigns.plan(env.ctx, { goal: env.params.goal ?? env.exec.request, offer: env.params.offer }, env.usage);
    env.state.campaignId = c.id; return `Campaign "${c.name}" planned with ${c.tasks.length} task(s); ${c.tasks.filter((t) => t.status === 'ready').length} ready now.`;
  },
};

export const content_creation: CapabilityDef = {
  id: 'content_creation',
  async preflight({ params, request, taskType }) {
    if (taskType !== 'content_request') return [];
    const t = params.deliverableType ?? inferDeliverableType(request);
    return t && DeliverableTypeEnum.safeParse(t).success ? [] : ['What would you like me to create? For example: homepage headline, service page, blog article, email, social posts, FAQ, or SEO title and description.'];
  },
  async run(env) {
    if (env.params.noDrafts) return 'Drafts were not requested for this review.';
    if (!(await env.agent.gate.has(env.ctx, 'drafts_basic'))) { env.limitations.push('Marketing drafts are not part of your plan, so none were prepared. Your findings and next steps are above.'); return 'Drafts not included in this plan; skipped.'; }
    let quota = await env.agent.gate.draftsRemaining(env.ctx); if (quota < 1) { env.limitations.push('You have used all the drafts included in this billing period, so none were prepared.'); return 'Draft limit reached; skipped.'; }
    const ids: string[] = []; const failures: string[] = []; const profile = await env.agent.profiles.effective(env.ctx); const scan = await ownScan(env);
    const excerpts = (scan?.pages ?? []).filter((p) => p.ok).slice(0, 5).map((p) => ({ url: p.finalUrl, text: [p.title, p.metaDescription, ...p.h1, ...p.h2, p.text.slice(0, 1500)].filter(Boolean).join('\n') }));
    const kwRows = ((await env.agent.db.research.list(env.ctx.businessId, { kind: 'keyword' }, { newestFirst: true })).find((r) => inSite(r, env.ctx))?.data as { rows?: { keyword: string; volume?: number; intent?: string }[] } | undefined)?.rows?.slice(0, 15);
    const gen = async (type: DeliverableType, extra: { cardId?: string; brief?: string; evidence?: unknown; pageUrl?: string }) => {
      if (quota < 1) return;
      if (!(await env.agent.gate.has(env.ctx, draftFeature(type)))) { env.limitations.push(`A ${type.replace(/_/g, ' ')} draft needs Marketing Studio, so it was not prepared.`); return; }
      quota--;
      let d;
      try { d = await env.agent.deliverables.generate(env.ctx, { type, scanExcerpts: excerpts, keywords: kwRows, suppliedFacts: [env.params.notes ?? '', env.exec.request, ...(env.params.zip ? [`ZIP ${env.params.zip}`] : [])], ...extra }, env.usage); }
      catch (e) {
        // One draft the model cannot produce reliably must not discard the others. The failure is reported, never papered over with a template.
        if ((e as { code?: string }).code !== 'invalid_model_output') throw e;
        quota++; failures.push(`${type.replace(/_/g, ' ')}: ${(e as Error).message}`); env.limitations.push(`A ${type.replace(/_/g, ' ')} draft could not be prepared: the model's output did not pass validation (${(e as Error).message.slice(0, 160)}). Use Retry to try again.`); return;
      }
      ids.push(d.id);
      const v = d.versions[0]!; env.mock.value ||= /MOCK/.test(v.note ?? '');
    };
    if (env.exec.taskType === 'content_request') {
      const t = (env.params.deliverableType ?? inferDeliverableType(env.exec.request)) as DeliverableType;
      await gen(t, { brief: env.exec.request });
    } else if (env.exec.taskType === 'campaign') {
      const c = env.state.campaignId ? await env.agent.campaigns.get(env.ctx, env.state.campaignId) : undefined;
      const ready = c?.tasks.filter((t) => t.status === 'ready' && t.deliverableType) ?? [];
      for (const t of ready.slice(0, 2)) ids.push((await env.agent.campaigns.prepareTask(env.ctx, c!.id, t.key, env.usage)).id);
      if (!ready.length && c) { const waiting = c.tasks.filter((t) => t.status === 'ready').map((t) => t.title); return `No deliverables could be prepared yet; waiting on: ${waiting.join(', ') || 'dependencies'}. Complete those tasks to unlock the landing page and content.`; }
    } else {
      for (const cid of env.state.focusCardIds ?? []) {
        const card = await env.agent.cards.get(env.ctx, cid);
        const home = scan?.pages[0];
        await gen(card.card.deliverableType!, { cardId: cid, brief: `${card.card.title}. ${card.card.recommendation}`, evidence: { finding: card.card.finding, evidence: card.card.evidence, currentHeadline: home?.h1[0] ?? home?.title, ctas: home?.ctas }, pageUrl: home?.finalUrl });
      }
    }
    env.state.deliverableIds = [...(env.state.deliverableIds ?? []), ...ids]; env.state.draftsCreated = ids.length;
    void profile;
    const existing = (env.state.existingDeliverableIds as string[] | undefined) ?? [];
    if (!ids.length && existing.length) { env.state.deliverableIds = [...(env.state.deliverableIds ?? []), ...existing]; return `${existing.length} draft(s) for these findings already exist; linked below instead of writing duplicates.`; }
    if (!ids.length && failures.length && !existing.length) throw new ValidationError(`No draft could be prepared: ${failures.join(' | ')}`, 'invalid_model_output');
    return ids.length ? `${ids.length} editable deliverable(s) prepared for your review${failures.length ? `; ${failures.length} could not be prepared (see limitations)` : ''}.` : 'No deliverable was needed for this request.';
  },
};

export const performance_intelligence: CapabilityDef = {
  id: 'performance_intelligence',
  async preflight({ agent, ctx }) {
    const has = (await agent.db.metrics.list(ctx.businessId)).some((m) => inSite(m, ctx));
    return has ? [] : ['No performance data has been supplied yet. Upload a Google Search Console, Google Analytics or email-platform export on the Performance page, then ask again.'];
  },
  async run(env) {
    const metrics = (await env.agent.db.metrics.list(env.ctx.businessId)).filter((m) => inSite(m, env.ctx) && m.metric !== '__superseded__');
    const latestEnd = metrics.map((m) => m.periodEnd).sort().at(-1)!;
    const end = new Date(latestEnd + 'T00:00:00Z'); const curStart = env.params.periodCurrent?.start ?? ymd(addDays(end, -27));
    const periods = { current: env.params.periodCurrent ?? { start: curStart, end: latestEnd }, previous: env.params.periodPrevious ?? { start: ymd(addDays(new Date(curStart + 'T00:00:00Z'), -28)), end: ymd(addDays(new Date(curStart + 'T00:00:00Z'), -1)) } };
    const r = await env.agent.performance.report(env.ctx, periods, env.usage, { executionId: env.exec.id });
    env.state.reportId = r.id; const d = r.data as { dataQuality: string[]; metrics: unknown[]; mock?: boolean };
    env.mock.value ||= !!d.mock; env.limitations.push(...d.dataQuality);
    return `Compared ${periods.current.start}–${periods.current.end} with the previous period across ${d.metrics.length} metric(s).`;
  },
};

export const CAPABILITIES: Record<Exclude<CapabilityId, 'marketing_execution'>, CapabilityDef> = { website_intelligence, business_intelligence, seo_intelligence, market_research, marketing_analysis, marketing_strategy, campaign_planning, content_creation, performance_intelligence };
