import 'server-only';
const b = (v: string | undefined, d = false) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));
export const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  /** In-memory data + dev cookie auth, for local development and automated tests only. Refused in production. */
  devMode: b(process.env.DEV_MODE),
  llmProvider: process.env.LLM_PROVIDER, // 'mock' (non-production only) | unset => LLM_BASE_URL/LLM_MODEL
  /** Business plan: anonymous preview stays OFF in production until the privacy policy is published. */
  anonymousPreview: b(process.env.ANONYMOUS_PREVIEW_ENABLED, !isProd),
  previewPerIpPerDay: Number(process.env.PREVIEW_PER_IP_PER_DAY ?? 3),
  previewDailyCap: Number(process.env.PREVIEW_DAILY_CAP ?? 200),
  stripeSecret: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  stripePrices: {
    marketingReport: process.env.STRIPE_PRICE_MARKETING_REPORT,
    assistantMonthly: process.env.STRIPE_PRICE_MARKETING_ASSISTANT_MONTHLY, assistantAnnual: process.env.STRIPE_PRICE_MARKETING_ASSISTANT_ANNUAL,
    studioMonthly: process.env.STRIPE_PRICE_MARKETING_STUDIO_MONTHLY, studioAnnual: process.env.STRIPE_PRICE_MARKETING_STUDIO_ANNUAL,
    suiteMonthly: process.env.STRIPE_PRICE_MARKETING_SUITE_MONTHLY, suiteAnnual: process.env.STRIPE_PRICE_MARKETING_SUITE_ANNUAL,
  },
  resendKey: process.env.RESEND_API_KEY, emailFrom: process.env.EMAIL_FROM,
  cronSecret: process.env.CRON_SECRET,
  hashSalt: process.env.IP_HASH_SALT ?? 'dev-salt',
};
export const supabaseConfigured = !!(env.supabaseUrl && env.supabaseAnonKey);
if (isProd && env.devMode) throw new Error('DEV_MODE must never be enabled in production');

/** Outside production, refuse to talk to any Supabase project that is not explicitly allow-listed (guards against pointing a dev build at production). */
export const supabaseRef = (url = env.supabaseUrl): string | undefined => url?.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co/i)?.[1]?.toLowerCase();
if (!isProd && env.supabaseUrl) {
  const allowed = (process.env.ALLOWED_SUPABASE_REFS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ref = supabaseRef();
  if (!ref || !allowed.includes(ref)) throw new Error(`Refusing to start: Supabase project "${ref ?? env.supabaseUrl}" is not listed in ALLOWED_SUPABASE_REFS. Outside production only explicitly allowed development projects may be used.`);
}
