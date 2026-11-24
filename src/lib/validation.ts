import { z } from "zod";

/** Main goals offered in onboarding (labels from the UI reference). */
export const GOALS = [
  { value: "get_found", label: "Get found by more customers" },
  { value: "more_calls", label: "Get more calls from my website" },
  { value: "easier_marketing", label: "Make my marketing easier to manage" },
] as const;
export type GoalValue = (typeof GOALS)[number]["value"];
const goalValues = GOALS.map((g) => g.value) as [GoalValue, ...GoalValue[]];

const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${label}.`)
    .max(max, `Keep your ${label} under ${max} characters.`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/**
 * Normalizes a website address: adds https:// when the scheme is missing and
 * accepts only public-looking http(s) URLs without credentials.
 * (Fetching the site safely is a later phase; this only validates the address.)
 */
export function normalizeWebsite(input: string): string | null {
  const value = input.trim();
  if (value === "") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error("invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid");
  if (url.username || url.password) throw new Error("invalid");
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) throw new Error("invalid");
  const out = url.toString();
  if (out.length > 300) throw new Error("invalid");
  return out;
}

const website = z.string().transform((value, ctx) => {
  try {
    return normalizeWebsite(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter a website address like https://example.com." });
    return z.NEVER;
  }
});

const newPassword = z.string().min(8, "Use at least 8 characters.").max(72, "Use 72 characters or fewer.");

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(1, "Enter your password.").max(72),
});

export const signUpSchema = z.object({
  fullName: trimmed(120, "name"),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: newPassword,
});

const zip = z
  .string()
  .trim()
  .regex(/^[0-9]{5}$/, "Enter a 5-digit ZIP code.");

export const businessSchema = z.object({
  businessName: trimmed(160, "business name"),
  website,
  serviceArea: optionalText(160, "service area"),
  primaryGoal: z.enum(goalValues).nullable(),
  zipCode: zip.nullable().optional(),
});

/** Homepage: website + ZIP. */
export const startSchema = z.object({
  website: website.refine((v) => v !== null, "Enter your website, like example.com."),
  zipCode: zip,
});

/** Lower-case host without "www." — what a preview is cached and limited by. */
export const domainOf = (url: string) => new URL(url).hostname.toLowerCase().replace(/^www\./, "");

export const settingsBusinessSchema = businessSchema.pick({ businessName: true, website: true });

export const passwordSchema = z
  .object({ password: newPassword, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "The passwords don't match.", path: ["confirm"] });

export const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
});

export const profileSchema = z.object({ fullName: trimmed(120, "name") });

/** Form fields → plain object, for safeParse. Missing fields become "". */
export function formFields(form: FormData, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, String(form.get(n) ?? "")]));
}

/** First error message for each field. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export interface FormState {
  ok?: boolean;
  /** Same-site path the browser should open with a full page load (see signIn). */
  redirectTo?: string;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
}
