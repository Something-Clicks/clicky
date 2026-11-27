import { normalizeText } from '../core/util';
import type { EvidenceClass } from '../domain/enums';
import type { WebsiteScan } from '../domain/models';
import type { StructuredClient } from '../providers/structured';
import type { Usage } from '../providers/usage';
import { FIELD_BY_KEY, PROFILE_KEYS } from '../profile/fields';
import type { FieldUpdate } from '../profile/service';
import { BusinessUnderstandingSchema, type BusinessUnderstanding } from './contracts';

export const pageCorpus = (scan: WebsiteScan): string => scan.pages.map((p) => [p.title, p.metaDescription, ...p.h1, ...p.h2, ...p.h3, p.text].filter(Boolean).join(' \n ')).join('\n\n');

export function pagesForPrompt(scan: WebsiteScan, maxChars = 3500) {
  return scan.pages.filter((p) => p.ok).map((p) => ({
    url: p.finalUrl, type: p.type, title: p.title, metaDescription: p.metaDescription, h1: p.h1, h2: p.h2.slice(0, 12),
    ctas: p.ctas, phones: p.phones, text: p.text.slice(0, maxChars),
  }));
}

/**
 * A "verified" claim must carry a quote that literally appears in the retrieved pages (or the
 * customer-supplied text). Otherwise it is downgraded to "inferred": the model cannot launder a guess as fact.
 */
export function groundUnderstanding(out: BusinessUnderstanding, scan: WebsiteScan | undefined, suppliedText = ''): {
  updates: FieldUpdate[]; openQuestions: string[]; downgraded: string[];
} {
  const corpus = normalizeText((scan ? pageCorpus(scan) : '') + ' ' + suppliedText);
  const updates: FieldUpdate[] = []; const downgraded: string[] = []; const open = [...out.openQuestions];
  for (const f of out.fields) {
    if (f.evidence === 'unknown') { open.push(`What is your ${f.key.replace(/_/g, ' ')}?`); continue; }
    let ev: EvidenceClass = f.evidence;
    if (ev === 'verified') {
      const q = f.quote ? normalizeText(f.quote) : '';
      if (!q || q.length < 8 || !corpus.includes(q)) { ev = 'inferred'; downgraded.push(f.key); }
    }
    // Small models often return a list where the profile expects text (or the reverse). Fit the SHAPE to the field; the words are the model's own.
    const kind = FIELD_BY_KEY.get(f.key)?.kind; let value = f.value;
    if (kind === 'text' && Array.isArray(value)) value = value.filter(Boolean).join('; ');
    if (kind === 'list' && !Array.isArray(value)) value = String(value).split(/\s*[;\n]\s*/).filter(Boolean);
    updates.push({
      key: f.key, value,
      provenance: {
        source: ev === 'verified' ? 'website' : 'ai_inference', evidence: ev,
        sourceRef: f.sourceUrl ?? scan?.finalUrl ?? scan?.startUrl,
      },
    });
  }
  return { updates, openQuestions: [...new Set(open)], downgraded };
}

export async function understandBusiness(
  client: StructuredClient,
  input: { scan?: WebsiteScan; supplied?: Record<string, unknown>; existing: Record<string, unknown> },
  usage: { current: Usage },
) {
  const untrusted = (input.scan?.pages ?? []).filter((p) => p.ok).map((p) => ({ id: p.finalUrl, source: p.finalUrl, text: p.text.slice(0, 6000) }));
  const res = await client.generate({
    task: 'business_understanding', usage, schema: BusinessUnderstandingSchema, untrusted,
    instructions: `Build the business profile from the retrieved website pages and customer-supplied facts. Allowed field keys: ${PROFILE_KEYS.join(', ')}.
For each field: evidence "verified" ONLY with an exact quote copied from the pages; "inferred" for reasonable interpretation (no quote needed); omit fields you cannot support. Do not describe customer research you do not have: customer needs/motivations/objections not stated on the site are at most "inferred" and will be labelled as AI assumptions. List openQuestions the customer must answer.`,
    input: { pages: input.scan ? pagesForPrompt(input.scan) : [], supplied: input.supplied ?? {}, existingProfile: input.existing },
  });
  const grounded = groundUnderstanding(res.data, input.scan, JSON.stringify(input.supplied ?? {}));
  return { ...grounded, model: res.model, mock: res.mock };
}
