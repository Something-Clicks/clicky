import { hashContent, normalizeText } from './core/util';
import type { Finding, SiteRow, WebsiteScan } from './domain/models';
import type { CardService } from './capabilities/cards';
import { OPEN_GATE, type PlanGate } from './plans';
import { ProfileService } from './profile/service';
import { FIELD_BY_KEY } from './profile/fields';
import type { AuditLog } from './store/audit';
import type { Ctx } from './store/authz';
import { Authz, inSite } from './store/authz';
import type { Db } from './store/db';
import type { SiteService } from './sites';
import { ValidationError } from './core/errors';

const digits = (s: string) => s.replace(/\D/g, '');
const excerpt = (text: string, term: string) => { const i = text.toLowerCase().indexOf(term.toLowerCase()); return i < 0 ? '' : text.slice(Math.max(0, i - 40), i + term.length + 40).trim(); };
const F = (site: SiteRow, key: string, f: Omit<Finding, 'key' | 'origin' | 'dependsOn' | 'ruleId' | 'category' | 'title'> & { title: string }): Finding =>
  ({ origin: 'rule', ruleId: key, dependsOn: [], category: 'marketing_consistency', key: `brand_${key}_${hashContent(site.id).slice(0, 6)}`, ...f, title: `${site.name}: ${f.title}` });

export interface BrandReport {
  generatedAt: string;
  sites: { siteId: string; name: string; url: string; scanned: boolean; findings: Finding[]; voice?: { we: number; you: number } }[];
  shared: { key: string; label: string; value: string | string[] }[];
  overrides: { siteId: string; name: string; fields: { key: string; label: string; value: string | string[] }[] }[];
  limitations: string[];
}

/** Brand consistency across websites and locations (Marketing Suite). Deterministic checks over saved scans, no model involved. */
export class BrandService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly gate: PlanGate = OPEN_GATE, private readonly sites: SiteService, private readonly profiles: ProfileService, private readonly cards: CardService) {}

  private async latestScan(ctx: Ctx, siteId: string): Promise<WebsiteScan | undefined> {
    return (await this.db.scans.list(ctx.businessId, { label: 'own_site' }, { newestFirst: true })).find((s) => inSite(s, { ...ctx, siteId }))?.scan;
  }

  async report(ctx: Ctx): Promise<BrandReport> {
    await this.authz.require(ctx, 'view'); await this.gate.require(ctx, 'brand_management');
    const base = await this.profiles.getInternal(ctx.businessId); const sites = await this.sites.list(ctx);
    const avoid = ProfileService.confirmedList(base, 'avoid_terms'); const keyMsgs = [base.fields.key_messages?.value ?? []].flat(); const bizName = [base.fields.name?.value ?? ''].flat().join(' ');
    const limitations: string[] = []; const out: BrandReport['sites'] = [];
    for (const site of sites) {
      const scan = await this.latestScan(ctx, site.id); const findings: Finding[] = [];
      if (!scan?.pages.length) { out.push({ siteId: site.id, name: site.name, url: site.url, scanned: false, findings }); limitations.push(`${site.name} has not been reviewed yet, so its brand could not be checked. Run a website review for it first.`); continue; }
      const pages = scan.pages.filter((p) => p.ok); const home = pages[0]!; const text = pages.map((p) => p.text).join(' \n ');
      for (const term of avoid) { const hit = pages.find((p) => p.text.toLowerCase().includes(term.toLowerCase())); if (hit) findings.push(F(site, `avoid_${hashContent(term).slice(0, 6)}`, { title: `Uses a word the brand avoids ("${term}")`, observed: `The page text contains "${term}", which the brand guidelines say to avoid.`, where: [hit.finalUrl], evidence: [{ kind: 'quote', source: hit.finalUrl, text: excerpt(hit.text, term) }], whyItMatters: 'Consistent wording builds recognition across every website.', affected: 'Visitors and the brand', consequence: 'Mixed messages between websites.', confidence: 'high', impact: 'medium', evidenceClass: 'verified', missingInfo: [], recommendation: `Replace "${term}" with the preferred wording.`, effort: 'low', deliverableType: 'page_copy' })); }
      if (bizName && home.title && !normalizeText(home.title).includes(normalizeText(bizName).split(' ')[0]!)) findings.push(F(site, 'name_in_title', { title: 'Business name missing from the homepage title', observed: `Homepage title "${home.title}" does not include "${bizName}".`, where: [home.finalUrl], evidence: [{ kind: 'quote', source: home.finalUrl, text: home.title }], whyItMatters: 'The same name on every site helps customers recognise the business.', affected: 'Customers', consequence: 'Weaker brand recall.', confidence: 'medium', impact: 'low', evidenceClass: 'verified', missingInfo: [], recommendation: 'Include the business name in the homepage title.', effort: 'low', deliverableType: 'seo_meta' }));
      if (keyMsgs.length && !keyMsgs.some((m) => normalizeText(text).includes(normalizeText(m)))) findings.push(F(site, 'key_messages', { title: 'None of the shared key messages appear', observed: `None of your ${keyMsgs.length} shared key message(s) were found in the pages we read.`, where: [home.finalUrl], evidence: [{ kind: 'missing', source: home.finalUrl, text: `Searched ${pages.length} page(s) for: ${keyMsgs.slice(0, 3).join(' | ')}` }], whyItMatters: 'Key messages keep every site saying the same thing.', affected: 'Customers comparing your sites', consequence: 'Inconsistent positioning.', confidence: 'medium', impact: 'medium', evidenceClass: 'inferred', missingInfo: ['Messages may be worded differently; this checks for the exact phrasing.'], recommendation: 'Work at least one key message into the homepage.', effort: 'low', deliverableType: 'headline_set' }));
      const allDigits = digits(text) + pages.flatMap((p) => p.phones.map(digits)).join('');
      for (const loc of site.locations) {
        if (loc.phone && !allDigits.includes(digits(loc.phone).slice(-10))) findings.push(F(site, `phone_${hashContent(loc.id).slice(0, 6)}`, { title: `Phone number for ${loc.name} not found on the site`, observed: `The phone number recorded for ${loc.name} (${loc.phone}) does not appear on the pages we read.`, where: [home.finalUrl], evidence: [{ kind: 'missing', source: home.finalUrl, text: `Looked for ${loc.phone} in ${pages.length} page(s).` }], whyItMatters: 'Customers need the same contact details everywhere.', affected: 'Customers of this location', consequence: 'Lost calls or mistrust.', confidence: 'medium', impact: 'high', evidenceClass: 'verified', missingInfo: ['The number may be in an image or on an unscanned page.'], recommendation: `Show ${loc.phone} on the ${loc.name} page and in the footer.`, effort: 'low', deliverableType: 'local_landing_page' }));
        const place = loc.city ?? loc.serviceAreas[0]; if (place && !text.toLowerCase().includes(place.toLowerCase())) findings.push(F(site, `place_${hashContent(loc.id).slice(0, 6)}`, { title: `${loc.name} is not mentioned on the site`, observed: `"${place}" does not appear in the pages we read.`, where: [home.finalUrl], evidence: [{ kind: 'missing', source: home.finalUrl, text: `Searched for "${place}".` }], whyItMatters: 'Each location needs a visible place on the website.', affected: 'Local customers', consequence: 'Weaker local visibility.', confidence: 'medium', impact: 'medium', evidenceClass: 'verified', missingInfo: [], recommendation: `Add a page or section for ${loc.name}.`, effort: 'medium', deliverableType: 'local_landing_page' }));
      }
      const we = (text.match(/\b(we|our|us)\b/gi) ?? []).length; const you = (text.match(/\b(you|your)\b/gi) ?? []).length;
      out.push({ siteId: site.id, name: site.name, url: site.url, scanned: true, findings, voice: { we, you } });
    }
    // Voice divergence: one site speaks about "you", another about "we".
    const voiced = out.filter((s) => s.voice && s.voice.we + s.voice.you >= 8);
    if (voiced.length >= 2) {
      const ratio = (s: (typeof out)[number]) => s.voice!.you / Math.max(1, s.voice!.you + s.voice!.we); const hi = voiced.reduce((a, b) => (ratio(a) >= ratio(b) ? a : b)); const lo = voiced.reduce((a, b) => (ratio(a) <= ratio(b) ? a : b));
      if (ratio(hi) - ratio(lo) > 0.35) { const site = sites.find((x) => x.id === lo.siteId)!; lo.findings.push(F(site, 'voice', { title: 'Writing style differs from your other site', observed: `${lo.name} mostly talks about "we/our" (${lo.voice!.we} vs ${lo.voice!.you} "you/your"), while ${hi.name} speaks to "you" (${hi.voice!.you} vs ${hi.voice!.we}).`, where: [lo.url], evidence: [{ kind: 'metric', source: lo.url, text: `${lo.name}: we/our ${lo.voice!.we}, you/your ${lo.voice!.you}; ${hi.name}: we/our ${hi.voice!.we}, you/your ${hi.voice!.you} (counted in retrieved text)` }], whyItMatters: 'A consistent voice makes separate sites feel like one brand.', affected: 'Customers who visit both sites', consequence: 'Mixed brand personality.', confidence: 'medium', impact: 'medium', evidenceClass: 'verified', missingInfo: ['Counts describe wording, not performance.'], recommendation: `Bring ${lo.name}'s copy in line with your brand voice.`, effort: 'medium', deliverableType: 'page_copy' })); }
    }
    const field = (row: { fields: Record<string, { value: string | string[] }> }) => Object.entries(row.fields).filter(([k]) => FIELD_BY_KEY.get(k)?.category === 'brand').map(([k, f]) => ({ key: k, label: FIELD_BY_KEY.get(k)!.label, value: f.value }));
    const overrides: BrandReport['overrides'] = [];
    for (const s of sites.filter((x) => !x.isPrimary)) { const row = await this.db.profiles.get(ctx.businessId, s.id); const f = row ? field(row) : []; if (f.length) overrides.push({ siteId: s.id, name: s.name, fields: f }); }
    return { generatedAt: new Date().toISOString(), sites: out, shared: field(base), overrides, limitations };
  }

  /** Turn the report's issues into Action Cards on the right site (deduplicated). */
  async createCards(ctx: Ctx): Promise<number> {
    await this.authz.require(ctx, 'run_agent'); const rep = await this.report(ctx); let n = 0;
    for (const s of rep.sites) if (s.findings.length) n += (await this.cards.createFromFindings({ ...ctx, siteId: s.siteId }, s.findings, { actor: { type: 'agent', id: 'brand-check' } })).length;
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'brand.checked', entityType: 'business', entityId: ctx.businessId, detail: { newCards: n } });
    return n;
  }

  /** Brand guidance for one site: shared fields at business level, optional per-site overrides. */
  async setBrand(ctx: Ctx, scope: 'shared' | string, updates: { key: string; value: string | string[] }[]) {
    await this.authz.require(ctx, 'edit_profile'); await this.gate.require(ctx, 'brand_management');
    for (const u of updates) if (FIELD_BY_KEY.get(u.key)?.category !== 'brand') throw new ValidationError(`"${u.key}" is not a brand field`);
    const c: Ctx = { ...ctx, siteId: scope === 'shared' ? ctx.businessId : scope };
    return this.profiles.applyUpdates(c, updates.map((u) => ({ ...u, provenance: { source: 'customer_confirmed' as const, evidence: 'verified' as const, sourceRef: scope === 'shared' ? 'shared brand' : 'site override' } })), { type: 'user', id: ctx.userId });
  }
}
