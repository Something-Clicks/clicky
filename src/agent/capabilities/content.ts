import { ConflictError, ForbiddenError, mockForbidden, NotFoundError, ValidationError } from '../core/errors';
import { hashContent, nowIso } from '../core/util';
import type { DeliverableType } from '../domain/enums';
import type { ClaimFlag, ContentBlock, DeliverableRow, DeliverableVersion, ProfileRow } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import { ProfileService } from '../profile/service';
import { checkBrandTerms, detectUnsupportedClaims } from '../security/claims';
import type { Ctx } from '../store/authz';
import { Authz, inSite, siteOf } from '../store/authz';
import { draftFeature, OPEN_GATE, type PlanGate } from '../plans';
import type { AuditLog } from '../store/audit';
import type { Db } from '../store/db';
import type { CardService } from './cards';
import { ContentSchema } from './contracts';
import { DELIVERABLE_SPECS, validateBlocks } from './deliverable-specs';

/** Everything the customer/site has actually said or shown: the only things content may assert as fact. */
export function factsCorpus(profile: ProfileRow, extra: string[] = []): string {
  const prof = Object.values(profile.fields).filter((f) => f.confirmed || f.provenance.source !== 'ai_inference').map((f) => [f.value].flat().join(' '));
  return [...prof, ...extra].join('\n');
}
const blockText = (b: ContentBlock) => [b.text, ...(b.items ?? [])].join('\n');
export function computeFlags(blocks: ContentBlock[], corpus: string, avoid: string[]): ClaimFlag[] {
  return blocks.flatMap((b) => [...detectUnsupportedClaims(blockText(b), corpus, b.key), ...checkBrandTerms(blockText(b), avoid, b.key)]);
}
const hashOf = (v: Pick<DeliverableVersion, 'title' | 'blocks'>) => hashContent({ t: v.title, b: v.blocks });

export interface GenerateInput {
  type: DeliverableType; brief?: string; cardId?: string; campaignId?: string; campaignTaskKey?: string;
  evidence?: unknown; pageUrl?: string; keywords?: { keyword: string; volume?: number; intent?: string }[];
  /** Additional trusted-by-customer text that may be used as facts (e.g. text supplied in the request). */
  suppliedFacts?: string[]; corpusExtra?: string[]; scanExcerpts?: { url: string; text: string }[];
}

export class DeliverableService {
  constructor(private readonly db: Db, private readonly authz: Authz, private readonly audit: AuditLog, private readonly llm: StructuredClient, private readonly cards: CardService, private readonly profiles: ProfileService, private readonly gate: PlanGate = OPEN_GATE) {}

  async generate(ctx: Ctx, input: GenerateInput, usage: { current: Usage }, actor: { type: 'agent' | 'user'; id: string } = { type: 'agent', id: 'agent' }): Promise<DeliverableRow> {
    await this.authz.require(ctx, 'run_agent');
    await this.gate.require(ctx, draftFeature(input.type));
    if ((await this.gate.draftsRemaining(ctx)) < 1) throw new ForbiddenError('You have used all the drafts included in this billing period.', 'usage_limit');
    const profile = await this.profiles.effective(ctx);
    const spec = DELIVERABLE_SPECS[input.type];
    const corpus = factsCorpus(profile, [...(input.corpusExtra ?? []), ...(input.suppliedFacts ?? []), ...(input.scanExcerpts ?? []).map((s) => s.text), JSON.stringify(input.keywords ?? [])]);
    const avoid = ProfileService.list(profile, 'avoid_terms');
    let flagsFinal: ClaimFlag[] = [];
    const res = await this.llm.generate({
      task: 'content_generation', usage, schema: ContentSchema,
      untrusted: (input.scanExcerpts ?? []).map((s) => ({ id: s.url, source: s.url, text: s.text.slice(0, 3000) })),
      instructions: `Write a complete, usable "${spec.label}" (${input.type}). ${spec.guidance}
Required blocks (use these exact keys): ${spec.required.join(', ')}${spec.maxLen ? `. Max lengths: ${JSON.stringify(spec.maxLen)}` : ''}.
Use the brand voice, tone, key messages and preferred terms; never use avoid_terms. State only facts present in the profile, evidence or supplied excerpts. Do NOT invent testimonials, awards, certifications, guarantees, statistics, prices, years in business, customer counts or rankings. Where a fact is needed but unknown, write around it and add it to needsCustomerInput. Keywords with volume are measured data only if listed in input.keywords.`,
      input: { type: input.type, brief: input.brief ?? '', profile: ProfileService.summarize(profile), evidence: input.evidence, pageUrl: input.pageUrl, keywords: input.keywords ?? [], suppliedFacts: input.suppliedFacts ?? [] },
      validate: (v) => {
        const shape = validateBlocks(input.type, v.blocks); if (shape) return shape;
        const flags = computeFlags(v.blocks, corpus, avoid);
        const hard = flags.filter((f) => f.severity === 'high' || f.type === 'brand_avoid_term');
        flagsFinal = flags.filter((f) => !hard.includes(f));
        return hard.length ? `Remove unsupported claims or avoided terms: ${hard.slice(0, 6).map((f) => `"${f.excerpt}" (${f.message})`).join('; ')}` : null;
      },
    });
    const t = nowIso();
    const v: DeliverableVersion = { n: 1, title: res.data.title, summary: res.data.summary, blocks: res.data.blocks, assumptions: res.data.assumptions, needsCustomerInput: res.data.needsCustomerInput, author: 'agent', note: res.mock ? 'Generated by MOCK provider (not a real model)' : `Generated by ${res.model}`, createdAt: t, contentHash: '', flags: flagsFinal, mock: res.mock };
    v.contentHash = hashOf(v);
    const row = await this.db.deliverables.insert({ businessId: ctx.businessId, siteId: siteOf(ctx), type: input.type, cardId: input.cardId, campaignId: input.campaignId, campaignTaskKey: input.campaignTaskKey, status: 'in_review', versions: [v], currentVersion: 1 });
    if (input.cardId) { await this.cards.attachDeliverable(ctx.businessId, input.cardId, row.id); await this.cards.setStatus(ctx.businessId, input.cardId, 'drafting', actor).catch(() => undefined); await this.cards.setStatus(ctx.businessId, input.cardId, 'ready_for_review', actor).catch(() => undefined); }
    await this.audit.record({ businessId: ctx.businessId, actorType: actor.type, actorId: actor.id, action: 'deliverable.created', entityType: 'deliverable', entityId: row.id, detail: { type: input.type, model: res.model, mock: res.mock, attempts: res.attempts } });
    return row;
  }

  async get(ctx: Ctx, id: string): Promise<DeliverableRow> { await this.authz.require(ctx, 'view'); return this.db.deliverables.require(ctx.businessId, id); }
  async list(ctx: Ctx): Promise<DeliverableRow[]> { await this.authz.require(ctx, 'view'); return (await this.db.deliverables.list(ctx.businessId, undefined, { newestFirst: true })).filter((d) => inSite(d, ctx)); }
  current(d: DeliverableRow): DeliverableVersion { return d.versions.find((v) => v.n === d.currentVersion)!; }

  /** Customer edit: always a NEW version; any prior approval is invalidated. */
  async edit(ctx: Ctx, id: string, edit: { title?: string; blocks: ContentBlock[]; note?: string }): Promise<DeliverableRow> {
    await this.authz.require(ctx, 'edit_content');
    const d = await this.db.deliverables.require(ctx.businessId, id);
    if (d.status === 'superseded') throw new ConflictError('This deliverable has been superseded', 'superseded');
    const shape = validateBlocks(d.type, edit.blocks); if (shape) throw new ValidationError(shape);
    const profile = await this.profiles.effective(ctx);
    const cur = this.current(d);
    const flags = computeFlags(edit.blocks, factsCorpus(profile), ProfileService.list(profile, 'avoid_terms')).map((f) => cur.flags.find((c) => c.excerpt === f.excerpt && c.acknowledgedBy) ?? f);
    const v: DeliverableVersion = { n: d.versions.length + 1, title: edit.title ?? cur.title, summary: cur.summary, blocks: edit.blocks, assumptions: cur.assumptions, needsCustomerInput: cur.needsCustomerInput, author: ctx.userId, note: edit.note, createdAt: nowIso(), contentHash: '', flags };
    v.contentHash = hashOf(v);
    const upd = await this.db.deliverables.update(ctx.businessId, id, { versions: [...d.versions, v], currentVersion: v.n, status: 'in_review', approval: undefined, rejection: undefined }, d.version);
    if (d.cardId && d.status === 'approved') await this.cards.setStatus(ctx.businessId, d.cardId, 'ready_for_review', { type: 'user', id: ctx.userId }, 'edited after approval').catch(() => undefined);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'deliverable.edited', entityType: 'deliverable', entityId: id, detail: { version: v.n, invalidatedApproval: d.status === 'approved' } });
    return upd;
  }

  async restore(ctx: Ctx, id: string, n: number): Promise<DeliverableRow> {
    const d = await this.get(ctx, id); const v = d.versions.find((x) => x.n === n); if (!v) throw new NotFoundError('version');
    return this.edit(ctx, id, { title: v.title, blocks: v.blocks, note: `Restored version ${n}` });
  }

  /** The customer takes responsibility for a flagged claim (e.g. "yes, we are licensed"). Recorded per user. */
  async acknowledgeFlags(ctx: Ctx, id: string, excerpts: string[]): Promise<DeliverableRow> {
    await this.authz.require(ctx, 'approve_content');
    const d = await this.db.deliverables.require(ctx.businessId, id); const cur = this.current(d);
    const flags = cur.flags.map((f) => (excerpts.includes(f.excerpt) ? { ...f, acknowledgedBy: ctx.userId } : f));
    const versions = d.versions.map((v) => (v.n === cur.n ? { ...v, flags } : v));
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'deliverable.flags_acknowledged', entityType: 'deliverable', entityId: id, detail: { excerpts } });
    return this.db.deliverables.update(ctx.businessId, id, { versions }, d.version);
  }

  async approve(ctx: Ctx, id: string, version: number): Promise<DeliverableRow> {
    await this.authz.require(ctx, 'approve_content');
    const d = await this.db.deliverables.require(ctx.businessId, id);
    if (version !== d.currentVersion) throw new ConflictError('Only the current version can be approved', 'stale_version');
    const cur = this.current(d);
    if (d.versions.some((v) => v.mock) && mockForbidden()) throw new ForbiddenError('This draft was produced by a development stand-in, not a real AI model, and cannot be approved or used.', 'mock_content');
    if (cur.contentHash !== hashOf(cur)) throw new ForbiddenError('Stored content does not match its hash', 'integrity_failure');
    const unresolved = cur.flags.filter((f) => f.severity === 'high' && !f.acknowledgedBy);
    if (unresolved.length) throw new ForbiddenError(`Resolve or acknowledge flagged claims first: ${unresolved.map((f) => `"${f.excerpt}"`).join(', ')}`, 'unresolved_flags');
    if (cur.needsCustomerInput.length && cur.author === 'agent') { /* allowed: customer may approve with gaps, but they are surfaced in the UI */ }
    const upd = await this.db.deliverables.update(ctx.businessId, id, { status: 'approved', approval: { version, contentHash: cur.contentHash, approvedBy: ctx.userId, approvedAt: nowIso() }, rejection: undefined }, d.version);
    if (d.cardId) await this.cards.setStatus(ctx.businessId, d.cardId, 'approved', { type: 'user', id: ctx.userId }).catch(() => undefined);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'deliverable.approved', entityType: 'deliverable', entityId: id, detail: { version, contentHash: cur.contentHash } });
    return upd;
  }

  async reject(ctx: Ctx, id: string, reason: string): Promise<DeliverableRow> {
    await this.authz.require(ctx, 'approve_content');
    const d = await this.db.deliverables.require(ctx.businessId, id);
    const upd = await this.db.deliverables.update(ctx.businessId, id, { status: 'rejected', approval: undefined, rejection: { by: ctx.userId, at: nowIso(), reason } }, d.version);
    if (d.cardId) await this.cards.setStatus(ctx.businessId, d.cardId, 'rejected', { type: 'user', id: ctx.userId }, reason).catch(() => undefined);
    await this.audit.record({ businessId: ctx.businessId, actorType: 'user', actorId: ctx.userId, action: 'deliverable.rejected', entityType: 'deliverable', entityId: id, detail: { reason } });
    return upd;
  }

  static render(d: DeliverableRow, format: 'markdown' | 'html' | 'text' = 'markdown'): string {
    const v = d.versions.find((x) => x.n === d.currentVersion)!;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    if (format === 'html') return `<article><h1>${esc(v.title)}</h1>${v.blocks.map((b) => `<section><h2>${esc(b.label)}</h2>${b.text ? `<p>${esc(b.text).replace(/\n+/g, '</p><p>')}</p>` : ''}${b.items?.length ? `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</section>`).join('')}</article>`;
    const h = (s: string) => (format === 'markdown' ? `## ${s}` : s.toUpperCase());
    return [format === 'markdown' ? `# ${v.title}` : v.title.toUpperCase(), ...v.blocks.map((b) => [h(b.label), b.text, ...(b.items ?? []).map((i) => `- ${i}`)].filter(Boolean).join('\n'))].join('\n\n');
  }
}
