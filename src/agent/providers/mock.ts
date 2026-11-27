import { ProviderError } from '../core/errors';
import { DELIVERABLE_SPECS } from '../capabilities/deliverable-specs';
import type { LLMProvider, ProviderRequest, ProviderResponse } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const arr = (x: Any): Any[] => (Array.isArray(x) ? x : []);
const first = (x: Any): string | undefined => (Array.isArray(x) ? x[0] : x) || undefined;
const sum = (a: Any[]) => a.reduce((n, x) => n + x, 0);
const words = (s: string) => (s.match(/\b\w+\b/g) ?? []).length;
const sentenceWith = (text: string, re: RegExp): string | undefined => text.split(/(?<=[.!?])\s+/).find((s) => re.test(s) && s.length > 20 && s.length < 220);

const INDUSTRIES: [RegExp, string][] = [
  [/plumb|drain|water heater/i, 'Plumbing services'], [/dent(al|ist)|orthodont/i, 'Dental care'], [/roof/i, 'Roofing'], [/hvac|heating|air condition/i, 'HVAC'],
  [/landscap|lawn/i, 'Landscaping'], [/law(yer)?|attorney|legal/i, 'Legal services'], [/restaurant|menu|catering/i, 'Food service'], [/clean(ing)?|maid|janitor/i, 'Cleaning services'],
  [/account(ing|ant)|bookkeep|tax prep/i, 'Accounting'], [/real estate|realtor|homes for sale/i, 'Real estate'], [/salon|barber|hair|spa\b/i, 'Personal care'], [/fitness|gym|yoga|trainer/i, 'Fitness'],
  [/marketing|seo|branding/i, 'Marketing services'], [/auto|car repair|mechanic|tire/i, 'Automotive services'], [/electric(al|ian)/i, 'Electrical services'], [/pet|veterinar|grooming/i, 'Pet care'],
];

/**
 * Deterministic development/test provider. It is NOT a model: it derives structured answers from the real
 * retrieved data it is given (never invents quotes), so the whole product can be exercised without a model
 * connection. Everything it produces is labelled MOCK in the UI and in stored records. It refuses to run in production.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock'; readonly isMock = true;
  constructor(private readonly opts: { failTimes?: number; badJsonTimes?: number } = {}) {}
  private calls = 0; private bad = 0;

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_IN_PRODUCTION !== 'yes') throw new ProviderError('The mock provider cannot run in production', false);
    if (this.calls++ < (this.opts.failTimes ?? 0)) throw new ProviderError('simulated transient failure');
    if (this.bad++ < (this.opts.badJsonTimes ?? 0)) return { text: '{"not":"valid for schema"', model: 'mock-1', usage: { inputTokens: 10, outputTokens: 5 } };
    const handler = H[req.task]; if (!handler) throw new ProviderError(`mock has no handler for ${req.task}`, false);
    const out = handler(req.input as Any, req);
    const text = JSON.stringify(out);
    return { text, model: 'mock-1', usage: { inputTokens: Math.ceil(JSON.stringify(req.input).length / 4), outputTokens: Math.ceil(text.length / 4) } };
  }
}

const H: Record<string, (i: Any, r: ProviderRequest) => unknown> = {
  classify_request: () => ({ taskType: 'content_request' }),

  business_understanding(i) {
    const pages: Any[] = arr(i.pages); const home = pages[0]; const fields: Any[] = []; const open: string[] = [];
    if (!home) return { fields, openQuestions: ['The website could not be read. Tell us about your business.'] };
    const all = pages.map((p) => `${p.title ?? ''} ${p.metaDescription ?? ''} ${arr(p.h1).join(' ')} ${arr(p.h2).join(' ')} ${p.text ?? ''}`).join(' ');
    const V = (key: string, value: string | string[], quote?: string, sourceUrl?: string) => fields.push({ key, value, evidence: quote ? 'verified' : 'inferred', quote, sourceUrl });
    const titleName = (home.title ?? '').split(/\s[|–—-]\s|:\s/).map((s: string) => s.trim()).filter(Boolean);
    const h1 = first(home.h1);
    if (h1) V('value_proposition', h1, h1, home.url);
    if (home.metaDescription) V('positioning', home.metaDescription, home.metaDescription, home.url);
    if (titleName.length > 1 && !i.existingProfile?.name) V('name', titleName[titleName.length > 1 ? titleName.length - 1 : 0], undefined, home.url);
    const svcPages = pages.filter((p) => ['services', 'products'].includes(p.type));
    const heads = (svcPages.length ? svcPages : [home]).flatMap((p) => arr(p.h2).map((h: string) => ({ h, url: p.url }))).filter((x) => x.h.length >= 4 && x.h.length <= 70 && !/contact|about|testimonial|review|faq|why choose|get in touch|our story/i.test(x.h));
    if (heads.length) V('products_services', [...new Set(heads.map((x) => x.h))].slice(0, 8), heads[0]!.h, heads[0]!.url);
    const area = all.match(/\b(?:serving|serves|service areas?:?|located in|based in)\s+((?:[A-Z][\w.'-]+(?:\s[A-Z][\w.'-]+)*)(?:,\s?[A-Z]{2})?)/);
    if (area) V('service_areas', [area[1]!], area[0], home.url);
    const ind = INDUSTRIES.find(([re]) => re.test(all)); if (ind) V('industry', ind[1]);
    const cust = /homeowner/i.test(all) ? 'Homeowners' : /small business/i.test(all) ? 'Small businesses' : /famil(y|ies)/i.test(all) ? 'Families' : /patients?/i.test(all) ? 'Patients' : undefined;
    if (cust) V('target_customers', [cust]);
    const homeH2 = arr(home.h2).filter((h: string) => h.length > 8 && h.length < 80).slice(0, 3); if (homeH2.length) V('key_messages', homeH2, homeH2[0], home.url);
    const we = (all.match(/\b(we|our|us)\b/gi) ?? []).length; const you = (all.match(/\b(you|your)\b/gi) ?? []).length;
    V('brand_voice', we > you * 1.5 ? 'Company-centred: talks mostly about "we/our"' : 'Customer-centred: addresses "you/your"');
    V('tone', /!/.test(all) ? 'Enthusiastic' : 'Professional and plain');
    const phone = arr(home.phones)[0]; void phone;
    for (const [k, q] of [['marketing_objectives', 'What is the main result you want from marketing?'], ['icps', 'Describe your ideal customer.'], ['pricing', 'How do you price your services?'], ['competitive_advantages', 'What makes you different from competitors?'], ['business_goals', 'What are your business goals this year?']] as const)
      if (!i.existingProfile?.[k]) open.push(q);
    return { fields, openQuestions: open };
  },

  marketing_analysis(i) {
    const pages: Any[] = arr(i.pages); const home = pages[0]; const findings: Any[] = []; if (!home) return { findings };
    const known = Object.values(i.profile?.products_services?.value ?? []).concat(arr(home.h2).slice(0, 6)) as string[];
    const svcWords = [...new Set(known.flatMap((s) => s.toLowerCase().split(/\W+/)).filter((w) => w.length > 4 && !['services', 'service', 'solutions', 'quality'].includes(w)))];
    const h1 = first(home.h1); const title = home.title as string | undefined;
    const headline = h1 ?? title;
    if (headline && svcWords.length && !svcWords.some((w) => headline.toLowerCase().includes(w)))
      findings.push({ category: 'messaging', title: 'Homepage headline does not name the main service', observed: `The homepage headline reads "${headline}" and does not mention any of the services listed further down the page (${known.slice(0, 3).join(', ')}).`, where: [home.url], evidence: [{ kind: 'quote', source: home.url, text: headline }], whyItMatters: 'Visitors decide within seconds whether a site is relevant; the headline is where they look first.', affected: 'First-time visitors', consequence: 'Visitors may not realise the business offers what they need.', confidence: 'medium', impact: 'high', evidenceClass: 'inferred', missingInfo: ['No visitor behaviour data was supplied, so the effect on bounce or enquiries is unknown.'], recommendation: `Rewrite the headline around the primary service${first(i.profile?.service_areas?.value) ? ' and area' : ''} and the customer benefit.`, effort: 'low', deliverableType: 'headline_set' });
    else if (headline && words(headline) < 3)
      findings.push({ category: 'messaging', title: 'Homepage headline is too short to explain the business', observed: `The headline "${headline}" is ${words(headline)} word(s).`, where: [home.url], evidence: [{ kind: 'quote', source: home.url, text: headline }], whyItMatters: 'A short, vague headline gives visitors nothing to evaluate.', affected: 'First-time visitors', consequence: 'Less clarity about what is offered.', confidence: 'medium', impact: 'high', evidenceClass: 'verified', missingInfo: [], recommendation: 'Replace with a headline that states what you do and for whom.', effort: 'low', deliverableType: 'headline_set' });
    const text = (home.text as string) || ''; const we = (text.match(/\b(we|our|us)\b/gi) ?? []).length; const you = (text.match(/\b(you|your)\b/gi) ?? []).length;
    if (words(text) > 80 && we > you * 2 && we >= 6)
      findings.push({ category: 'messaging', title: 'Homepage talks about the company more than the customer', observed: `The homepage text uses "we/our/us" ${we} times and "you/your" ${you} times.`, where: [home.url], evidence: [{ kind: 'metric', source: home.url, text: `we/our/us: ${we}; you/your: ${you} (counted in retrieved homepage text)` }], whyItMatters: 'Copy that centres customer problems tends to be easier to connect with.', affected: 'Prospective customers', consequence: 'Weaker connection with customer needs.', confidence: 'medium', impact: 'medium', evidenceClass: 'verified', missingInfo: ['Counts describe wording, not performance.'], recommendation: 'Rewrite key sections to lead with the customer problem and outcome.', effort: 'medium', deliverableType: 'page_copy' });
    const diff = /\b(only|unlike|family[- ]owned|since \d{4}|locally owned|specializ|unique|different)\b/i;
    if (words(text) > 60 && !diff.test(text) && !diff.test(home.metaDescription ?? ''))
      findings.push({ category: 'brand_positioning', title: 'Nothing on the homepage says why to choose this business over others', observed: 'No differentiating statement was found in the homepage text or description.', where: [home.url], evidence: [{ kind: 'missing', source: home.url, text: `Searched ${words(text)} words of homepage text for differentiators.` }], whyItMatters: 'Customers comparing options need a reason to choose.', affected: 'Prospective customers comparing providers', consequence: 'The business competes mainly on price or proximity.', confidence: 'low', impact: 'medium', evidenceClass: 'inferred', missingInfo: ['The owner may have strengths that are simply not on the site: ask the owner.'], recommendation: 'Ask the owner for their real differentiators and state them near the top of the homepage.', effort: 'low', deliverableType: 'headline_set' });
    return { findings: findings.slice(0, 5) };
  },

  market_research(i) {
    const src: Any[] = arr(i.sources); const ind = i.business?.industry?.value ?? i.business?.industry ?? 'this type of business'; const area = [i.business?.service_areas?.value ?? i.business?.service_areas].flat().filter(Boolean).join(', ');
    const findings = src.length ? src.slice(0, 4).map((s) => ({ claim: s.snippet.slice(0, 200), evidenceClass: 'verified', basis: `Source: ${s.title}`, sourceIds: [s.id] }))
      : [{ claim: `Customers searching for ${ind}${area ? ` in ${area}` : ''} likely use place-name modifiers.`, evidenceClass: 'inferred', basis: 'Hypothesis from general local-search behaviour. No external research source is connected and no market data was supplied.', sourceIds: [] },
         { claim: 'Market size, demand trends and seasonality for this business are unknown.', evidenceClass: 'unknown', basis: 'No market data supplied.', sourceIds: [] }];
    return { findings, researchQuestions: [`What are the top 5 competitors customers consider for ${ind}${area ? ` in ${area}` : ''}?`, 'Which months are busiest and slowest?', 'Where do your best customers come from today?'] };
  },

  competitor_comparison(i) {
    const comps = arr(i.competitors).map((c) => {
      const pages: Any[] = arr(c.pages); const home = pages[0] ?? {}; const text = pages.map((p) => p.text ?? '').join(' ');
      const price = [...text.matchAll(/[^.]{0,60}\$\s?\d[\d,]*(?:\.\d+)?[^.]{0,40}/g)].map((m) => m[0].trim()).slice(0, 3);
      return { url: c.url, name: (home.title ?? c.url).split(/\s[|–—-]\s/)[0], positioning: home.metaDescription ?? first(home.h1) ?? 'Not stated on retrieved pages', offers: pages.flatMap((p) => arr(p.h2)).filter((h: string) => h.length > 3 && h.length < 70).slice(0, 5), ctas: pages.flatMap((p) => arr(p.ctas)).slice(0, 5), pricingMentions: price,
        strengths: [price.length ? 'Publishes prices' : null, arr(home.ctas).length >= 2 ? 'Multiple clear calls to action' : null].filter(Boolean), weaknesses: [!price.length ? 'No pricing found on retrieved pages' : null, !arr(home.ctas).length ? 'No call to action found on homepage' : null].filter(Boolean) };
    });
    const own = arr(i.ownSite)[0]; const ownCtas = arr(own?.ctas).length; const opportunities: Any[] = []; const differences: Any[] = [];
    for (const c of comps) {
      if (c.pricingMentions.length) { differences.push({ point: `${c.name} shows pricing on its site; no price information was found on your retrieved pages.`, evidenceClass: own ? 'verified' : 'inferred', sources: [c.url] }); opportunities.push({ opportunity: 'Add clear pricing guidance (even starting-from ranges you choose to publish).', evidenceClass: own ? 'verified' : 'inferred', basis: `${c.name} publishes: "${c.pricingMentions[0]}"` }); }
      if (c.ctas.length > ownCtas) opportunities.push({ opportunity: `Strengthen calls to action: ${c.name} uses "${c.ctas[0]}".`, evidenceClass: 'verified', basis: `${c.name} has ${c.ctas.length} CTA(s) vs ${ownCtas} on your homepage.` });
      differences.push({ point: `${c.name} positions itself as: ${c.positioning}`, evidenceClass: 'verified', sources: [c.url] });
    }
    return { competitors: comps, differences, opportunities };
  },

  marketing_strategy(i) {
    const p = i.profile ?? {}; const v = (k: string) => [p[k]?.value].flat().filter(Boolean) as string[];
    const name = v('name')[0] ?? 'the business'; const svcs = v('products_services'); const areas = v('service_areas'); const cards: Any[] = arr(i.cards).sort((a, b) => a.priority.rank - b.priority.rank);
    const objs = v('marketing_objectives'); const assumptions: string[] = [];
    if (!objs.length) assumptions.push('No marketing objectives were supplied; the objective below is an assumption to confirm.');
    if (!v('target_customers').length) assumptions.push('Target customers are not confirmed; audiences below are provisional.');
    return {
      objectives: [{ objective: objs[0] ?? `Increase qualified enquiries to ${name} from the website`, basis: objs.length ? 'Supplied by the customer' : 'Assumption: most small businesses need more enquiries; confirm with the owner' }],
      positioning: [v('positioning')[0] ?? v('value_proposition')[0] ?? `${name}: position around ${svcs[0] ?? 'its core service'}${areas[0] ? ` in ${areas[0]}` : ''}`],
      audiences: (v('target_customers').length ? v('target_customers') : ['Local customers searching for ' + (svcs[0] ?? 'your services')]).map((t) => ({ name: t, description: `People who need ${svcs[0] ?? 'what ' + name + ' offers'}${areas[0] ? ` in ${areas[0]}` : ''}.`, evidenceClass: p.target_customers?.status === 'confirmed' ? 'verified' : 'inferred' })),
      messaging: v('key_messages').length ? v('key_messages') : [v('value_proposition')[0] ?? `${name}: ${svcs[0] ?? 'clear, honest service'}`],
      channels: [{ channel: 'Website', role: 'Primary conversion point', rationale: 'All scanned findings concern the website; fixing it benefits every other channel.', priority: 'high' }, { channel: 'Local search', role: 'Be found for place + service searches', rationale: areas.length ? `Service areas known: ${areas.join(', ')}.` : 'Service areas must be confirmed.', priority: areas.length ? 'high' : 'medium' }, { channel: 'Email to existing customers', role: 'Repeat and referral business', rationale: 'Low cost; requires a customer list the owner already holds.', priority: 'medium' }],
      seoStrategy: [`Give each core service its own page${svcs[0] ? `, starting with ${svcs[0]}` : ''}.`, ...cards.filter((c) => /seo|search|local|content_gaps/.test(c.category)).slice(0, 2).map((c) => c.recommendation)],
      contentStrategy: svcs.slice(0, 3).map((s) => `Publish one useful page or article per core service: ${s}.`),
      campaignIdeas: svcs.slice(0, 2).map((s) => ({ name: `${s} enquiry campaign`, objective: `Generate enquiries for ${s}${areas[0] ? ` in ${areas[0]}` : ''}`, basis: 'Listed as a core service in the profile' })),
      calendar: cards.slice(0, 6).map((c, n) => ({ weekOffset: n, activity: c.title, deliverableType: undefined })),
      prioritizedActions: cards.slice(0, 6).map((c) => ({ cardId: c.id, rationale: `Priority ${c.priority.label}; effort ${c.estimatedEffort}; evidence ${c.evidenceClass}.` })),
      assumptions, constraints: [...v('constraints'), ...v('budget')],
    };
  },

  content_generation(i, r) {
    const p = i.profile ?? {}; const v = (k: string) => [p[k]?.value].flat().filter(Boolean) as string[];
    const spec = DELIVERABLE_SPECS[i.type as keyof typeof DELIVERABLE_SPECS]; const needs: string[] = []; const assumptions: string[] = [];
    const name = v('name')[0] ?? 'Your business'; const areas = v('service_areas'); const svc = v('products_services')[0] ?? 'our services';
    const area = areas.filter((a) => !/^ZIP \d/.test(a))[0]; const vp = v('value_proposition')[0]; const problem = v('customer_problems')[0] ?? v('customer_needs')[0];
    const ev: Any = i.evidence; const existing = typeof ev === 'object' && ev ? (ev.currentHeadline ?? ev.quote) : undefined;
    const cta = (arr(ev?.ctas)[0] as string) ?? 'Contact us';
    if (!problem) needs.push(`What problem does a customer usually have when they come to you for ${svc}?`);
    if (/headline|messag/i.test(i.brief ?? '') || spec) assumptions.push('Copy uses only facts from your profile and website; items marked [needs your input] require your answers.');
    const kw = arr(i.keywords)[0]?.keyword as string | undefined;
    const T: Record<string, string> = {
      headline: `${svc}${area ? ` in ${area}` : ''}${problem ? `: ${problem.replace(/\.$/, '')}? We can help` : ''}`,
      subheadline: `${name} helps ${v('target_customers')[0]?.toLowerCase() ?? 'customers'} with ${svc.toLowerCase()}${area ? ` across ${area}` : ''}.${vp && vp !== svc ? ` ${vp.replace(/\.?$/, '.')}` : ''}`,
      cta: /contact|call|book|quote/i.test(cta) ? cta : `Contact ${name}`,
      intro: `${name} provides ${svc.toLowerCase()}${area ? ` for customers in ${area}` : ''}.`,
      body: `${name} offers ${svc.toLowerCase()}. ${vp ?? ''} ${problem ? `If you are dealing with ${problem.toLowerCase().replace(/\.$/, '')}, get in touch to talk through your situation.` : 'Get in touch to talk through what you need.'}`.trim(),
      benefits: '', process: `[needs your input] Describe the steps a customer goes through, from first contact to finished work.`, faq: '', offer: v('pricing')[0] ?? `Enquire about ${svc.toLowerCase()}`,
      seo_title: `${svc}${area ? ` in ${area}` : ''} | ${name}`.slice(0, 60), meta_description: `${name} provides ${svc.toLowerCase()}${area ? ` in ${area}` : ''}. ${problem ? `Talk to us about ${problem.toLowerCase().replace(/\.$/, '')}.` : 'Get in touch to discuss your needs.'}`.slice(0, 158),
      story: `[needs your input] How and why ${name} started.`, values: '', services: svc, local_proof_placeholder: '[needs your input] Real local projects or customer feedback you have permission to share.',
      goal: `Attract and convert searchers looking for ${svc.toLowerCase()}${area ? ` in ${area}` : ''}.`, audience: v('target_customers').join(', ') || '[needs your input] ideal customer', search_intent: kw ? `Target keyword (from supplied data): ${kw}` : 'Proposed focus (not measured): ' + svc.toLowerCase(), key_points: '', outline: '',
      title: `${svc}${area ? ` in ${area}` : ''}: what to know before you choose`, angle: `Help ${v('target_customers')[0]?.toLowerCase() ?? 'customers'} decide on ${svc.toLowerCase()}.`, conclusion: `If you want to talk about ${svc.toLowerCase()}, ${name} is happy to help.`,
      pillar: svc, cluster_topics: '', links: '', format: 'Checklist', landing_headline: `Get the ${svc.toLowerCase()} checklist`,
      subject: `${svc}: a note from ${name}`, preview: `A short note about ${svc.toLowerCase()}.`, sections: '', emails: '', posts: '', hook: `Thinking about ${svc.toLowerCase()}?`, script: `Hook: ${svc}. Point 1: what it involves. Point 2: what to ask a provider. CTA: ${cta}.`, entries: '', questions: '', pillar_topic: svc,
    };
    const L: Record<string, string[]> = {
      benefits: [...v('competitive_advantages'), ...v('key_messages')].slice(0, 4).concat(v('competitive_advantages').length + v('key_messages').length ? [] : [`[needs your input] What do customers get from ${svc.toLowerCase()} with ${name}?`]),
      faq: (v('customer_questions').length ? v('customer_questions') : [`What does ${svc.toLowerCase()} include?`, `How do I get started with ${name}?`]).slice(0, 5).map((q) => `${q} — [needs your input] answer in your words`),
      values: v('key_messages').length ? v('key_messages') : [`[needs your input] What ${name} stands for.`], outline: ['Introduction: the problem', `What ${svc.toLowerCase()} involves`, 'What to look for in a provider', `Next step: contact ${name}`], key_points: [`Explain ${svc.toLowerCase()} plainly`, ...(problem ? [`Address: ${problem}`] : []), 'Include a clear call to action'],
      cluster_topics: [`${svc} basics`, `Choosing a provider for ${svc.toLowerCase()}`, ...(area ? [`${svc} in ${area}`] : [])], links: [`Homepage → ${svc} page (anchor: ${svc.toLowerCase()})`], sections: [`News from ${name}`, `About ${svc.toLowerCase()}`], emails: [`Day 0 — Subject: Welcome to ${name}`, `Day 3 — Subject: About ${svc.toLowerCase()}`, `Day 7 — Subject: Questions about ${svc.toLowerCase()}?`],
      posts: [`LinkedIn: ${name} — ${svc}${area ? ` in ${area}` : ''}. ${cta}.`, `Facebook: Thinking about ${svc.toLowerCase()}? ${cta}.`], entries: arr(i.keywords).length ? arr(i.keywords).slice(0, 4).map((k, n) => `Week ${n + 1}: ${k.keyword}`) : [`Week 1: ${svc} overview`, 'Week 2: Customer questions', 'Week 3: Service area spotlight', 'Week 4: Next steps'], questions: [],
    };
    const base = spec.required.map((key) => ({ key, label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), text: L[key] ? '' : (T[key] ?? `[needs your input] ${key}`), items: L[key] ?? undefined }));
    for (const b of base) { if (b.items && !b.items.length) b.items = [`[needs your input] ${b.key}`]; if (/\[needs your input\]/.test(b.text + (b.items ?? []).join(''))) needs.push(`${b.label}: details needed`); }
    void existing; void r;
    return { title: `${spec.label}${svc !== 'our services' ? `: ${svc}` : ''}`, summary: `Draft ${spec.label.toLowerCase()} for ${name}, built only from your profile and website facts.`, blocks: base, assumptions, needsCustomerInput: [...new Set(needs)] };
  },

  campaign_plan(i) {
    const p = i.profile ?? {}; const v = (k: string) => [p[k]?.value].flat().filter(Boolean) as string[]; const svc = v('products_services').find((s) => i.goal.toLowerCase().split(/\W+/).some((w: string) => w.length > 4 && s.toLowerCase().includes(w))) ?? v('products_services')[0] ?? 'our service'; const area = v('service_areas')[0];
    const name = v('name')[0] ?? 'the business';
    return {
      name: `${svc}${area ? ` — ${area}` : ''} campaign`, objective: i.goal, audience: v('target_customers').join(', ') || `Customers looking for ${svc.toLowerCase()}${area ? ` in ${area}` : ''}`,
      offer: i.offer ?? `Enquire about ${svc.toLowerCase()} with ${name}`, coreMessage: v('value_proposition')[0] ?? `${name}: ${svc.toLowerCase()}${area ? ` in ${area}` : ''}`, channels: ['Website', 'Email', 'Social'],
      tasks: [
        { key: 'confirm_offer', title: 'Confirm offer and audience', type: 'review', description: 'Owner confirms the offer, audience and any constraints.', dependsOn: [], offsetDays: 0 },
        { key: 'landing_page', title: 'Prepare landing page', type: 'landing_page', deliverableType: 'landing_page', description: `Landing page for ${svc.toLowerCase()}.`, dependsOn: ['confirm_offer'], offsetDays: 2 },
        { key: 'email_announce', title: 'Prepare announcement email sequence', type: 'email', channel: 'Email', deliverableType: 'email_sequence', description: 'Short sequence to existing contacts.', dependsOn: ['landing_page'], offsetDays: 5 },
        { key: 'social_posts', title: 'Prepare social posts', type: 'social', channel: 'Social', deliverableType: 'social_posts', description: 'Posts that link to the landing page.', dependsOn: ['landing_page'], offsetDays: 5 },
        { key: 'distribute', title: 'Publish and send', type: 'distribution', description: 'Owner publishes the approved assets on their own channels.', dependsOn: ['email_announce', 'social_posts'], offsetDays: 7 },
        { key: 'measure', title: 'Review results', type: 'measurement', description: 'Compare enquiries and traffic before and after.', dependsOn: ['distribute'], offsetDays: 21 },
      ],
      measurementPlan: { goals: ['Count enquiries attributable to the campaign (as reported by the owner)'], metrics: ['sessions', 'conversions', 'leads'], reviewOffsetsDays: [14, 28] }, risks: ['Offer and audience are not yet confirmed by the owner.', 'Results depend on data the owner supplies.'],
    };
  },

  performance_recommendations(i) {
    const ms: Any[] = arr(i.metrics); const recs: Any[] = [];
    for (const m of ms) {
      if (m.assessment === 'declined') recs.push({ title: `${m.label} declined`, rationale: `${m.label} moved from ${m.previous} to ${m.current} (${m.pctChange}%). ${m.caveats.join(' ')}`, metricRefs: [m.metric], confidence: m.confidence, action: `Review what changed around this metric (content, pages, seasonality) before acting; check completed activities in the comparison window.` });
      else if (m.assessment === 'improved') recs.push({ title: `${m.label} improved`, rationale: `${m.label} moved from ${m.previous} to ${m.current} (+${m.pctChange}%). Timing may coincide with recent work but causation is not established.`, metricRefs: [m.metric], confidence: m.confidence, action: 'Identify which pages or activities contributed and consider extending that work.' });
      else if (m.assessment === 'insufficient_data') recs.push({ title: `Not enough ${m.label.toLowerCase()} data to judge`, rationale: m.caveats.join(' '), metricRefs: [m.metric], confidence: 'low', action: 'Collect a longer period before changing strategy.' });
    }
    return { summary: recs.length ? `${recs.length} item(s) from the supplied metrics.` : 'No meaningful changes were detected in the supplied data.', recommendations: recs.slice(0, 6), limitations: [...arr(i.dataQuality), ...(arr(i.missingMetrics).length ? [`Not supplied: ${arr(i.missingMetrics).join(', ')}`] : [])] };
  },
};
