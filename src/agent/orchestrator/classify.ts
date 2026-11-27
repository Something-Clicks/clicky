import type { DeliverableType, TaskType } from '../domain/enums';

const RULES: [TaskType, RegExp][] = [
  ['performance_review', /\b(performance|results|analytics|traffic|how (is|are|did) (my|our|the)|evaluate (our|my|the)|latest marketing results|search console|report on)\b/i],
  ['campaign', /\b(campaign|promotion|promotional|promote|launch (a|an|our|my)|special offer|seasonal)\b/i],
  ['marketing_plan', /\b(marketing plan|marketing strategy|strategy|roadmap|plan for (my|our|the)|go-to-market)\b/i],
  ['competitor_research', /\b(competitors?|competition|rivals?|compare (me|us) (to|with))\b/i],
  ['seo_research', /\b(keywords?|seo|search (visibility|ranking|rankings)|local seo|content gaps?|rank(ing)? (higher|better))\b/i],
  ['homepage_copy', /\b(headline|homepage|home page|tagline|hero (text|section)|landing headline)\b/i],
  ['content_request', /\b(write|draft|create|prepare|blog|article|email|newsletter|social|post|faq|about page|service page|landing page|meta description|title tag|video script|lead magnet|content calendar|brief)\b/i],
  ['website_audit', /\b(audit|analy[sz]e|review (my|our) (website|site)|what'?s wrong|improve (my|our) (website|site)|website|site)\b/i],
  ['business_profile', /\b(business profile|about my business|update (my|our) (profile|info)|tell you about)\b/i],
];
export function classifyByRules(text: string): TaskType | undefined {
  return RULES.find(([, re]) => re.test(text))?.[0];
}

const DELIVERABLE_RULES: [DeliverableType, RegExp][] = [
  ['email_sequence', /\b(email sequence|nurture|drip|welcome series)\b/i], ['newsletter', /\bnewsletter\b/i], ['email', /\b(email|follow-?up)\b/i],
  ['blog_article', /\b(blog (post|article)|article|write a blog)\b/i], ['blog_outline', /\b(blog outline|outline)\b/i], ['content_brief', /\bbrief\b/i],
  ['social_posts', /\b(social|instagram|facebook|linkedin|tweets?|posts?)\b/i], ['video_script', /\b(video|reel|tiktok|short-form)\b/i],
  ['faq', /\bfaqs?\b/i], ['about_page', /\babout (page|us)\b/i], ['local_landing_page', /\b(local|city|location) (landing )?page\b/i], ['landing_page', /\blanding page\b/i],
  ['service_page', /\b(service|services) page\b/i], ['seo_meta', /\b(meta description|title tag|seo title)\b/i], ['headline_set', /\b(headline|tagline|hero)\b/i],
  ['lead_magnet', /\b(lead magnet|guide|checklist|ebook)\b/i], ['content_calendar', /\b(content|social) calendar\b/i], ['editorial_calendar', /\beditorial calendar\b/i],
  ['topic_cluster', /\btopic cluster\b/i], ['page_copy', /\b(page copy|rewrite (my|the) page|website copy)\b/i],
];
export function inferDeliverableType(text: string): DeliverableType | undefined {
  return DELIVERABLE_RULES.find(([, re]) => re.test(text))?.[0];
}
