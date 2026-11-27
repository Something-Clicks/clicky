export interface FieldDef { key: string; category: 'business' | 'brand' | 'customer' | 'context'; kind: 'text' | 'list'; label: string; core?: boolean }

/** Structured Business / Brand / Customer profile schema (spec §3.1-3.3). */
export const PROFILE_FIELDS: FieldDef[] = [
  { key: 'name', category: 'business', kind: 'text', label: 'Business name', core: true },
  { key: 'website', category: 'business', kind: 'text', label: 'Website' },
  { key: 'domain', category: 'business', kind: 'text', label: 'Domain' },
  { key: 'industry', category: 'business', kind: 'text', label: 'Industry / category', core: true },
  { key: 'business_model', category: 'business', kind: 'text', label: 'Business model' },
  { key: 'products_services', category: 'business', kind: 'list', label: 'Products and services', core: true },
  { key: 'service_areas', category: 'business', kind: 'list', label: 'Service areas / geographic markets', core: true },
  { key: 'zip_codes', category: 'business', kind: 'list', label: 'ZIP codes (where you are / serve)' },
  { key: 'locations', category: 'business', kind: 'list', label: 'Locations' },
  { key: 'target_customers', category: 'business', kind: 'list', label: 'Target customers', core: true },
  { key: 'customer_problems', category: 'business', kind: 'list', label: 'Customer problems' },
  { key: 'customer_motivations', category: 'business', kind: 'list', label: 'Customer motivations' },
  { key: 'pricing', category: 'business', kind: 'text', label: 'Pricing information' },
  { key: 'competitive_advantages', category: 'business', kind: 'list', label: 'Competitive advantages' },
  { key: 'positioning', category: 'business', kind: 'text', label: 'Brand positioning' },
  { key: 'business_goals', category: 'business', kind: 'list', label: 'Business goals' },
  { key: 'marketing_objectives', category: 'business', kind: 'list', label: 'Marketing objectives', core: true },

  { key: 'brand_voice', category: 'brand', kind: 'text', label: 'Brand voice' },
  { key: 'tone', category: 'brand', kind: 'text', label: 'Tone' },
  { key: 'messaging_style', category: 'brand', kind: 'text', label: 'Messaging style' },
  { key: 'brand_personality', category: 'brand', kind: 'text', label: 'Brand personality' },
  { key: 'value_proposition', category: 'brand', kind: 'text', label: 'Value proposition', core: true },
  { key: 'key_messages', category: 'brand', kind: 'list', label: 'Key messages' },
  { key: 'preferred_terms', category: 'brand', kind: 'list', label: 'Preferred terminology' },
  { key: 'avoid_terms', category: 'brand', kind: 'list', label: 'Words and phrases to avoid' },
  { key: 'visual_identity', category: 'brand', kind: 'text', label: 'Visual identity' },
  { key: 'brand_guidelines', category: 'brand', kind: 'text', label: 'Existing brand guidelines' },

  { key: 'icps', category: 'customer', kind: 'list', label: 'Ideal customer profiles' },
  { key: 'segments', category: 'customer', kind: 'list', label: 'Customer segments' },
  { key: 'customer_needs', category: 'customer', kind: 'list', label: 'Customer needs' },
  { key: 'purchase_motivations', category: 'customer', kind: 'list', label: 'Purchase motivations' },
  { key: 'objections', category: 'customer', kind: 'list', label: 'Common objections' },
  { key: 'buying_behavior', category: 'customer', kind: 'text', label: 'Buying behavior' },
  { key: 'customer_questions', category: 'customer', kind: 'list', label: 'Customer questions' },
  { key: 'decision_factors', category: 'customer', kind: 'list', label: 'Purchase decision factors' },

  { key: 'constraints', category: 'context', kind: 'list', label: 'Known constraints' },
  { key: 'budget', category: 'context', kind: 'text', label: 'Budget and resources' },
  { key: 'previous_decisions', category: 'context', kind: 'list', label: 'Previous decisions' },
];
export const FIELD_BY_KEY = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));
export const PROFILE_KEYS = PROFILE_FIELDS.map((f) => f.key) as [string, ...string[]];
