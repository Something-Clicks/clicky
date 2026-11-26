/**
 * Campaign Planning without a model: fixed playbooks that turn what Something Clicks actually knows (open recommendations,
 * the owner's confirmed details, the owner's own homepage and the sites they compared) into a short list of tasks.
 * Deterministic: the same inputs always give the same campaign. A playbook is offered only when something observed
 * calls for it, every task says why (with its evidence class), and drafts are fixed templates filled only from facts the
 * owner gave or confirmed; anything unknown stays a visible [blank] for the owner to fill. Nothing is published or sent.
 */
import { compareSignals, SIGNAL_LABEL, type SiteSignals } from "@/lib/research";

export type EvidenceClass = "verified" | "inferred" | "estimated" | "unknown";
export type TaskKind = "fix_action" | "message" | "checklist" | "research";

export interface CampaignTask {
  kind: TaskKind;
  title: string;
  why: string;
  steps: string[];
  deliverable?: string;
  card_id?: string;
  evidence_class: EvidenceClass;
  basis?: string;
}

export interface Campaign {
  playbook: string;
  title: string;
  goal: string;
  summary: string;
  basis: Record<string, unknown>;
  tasks: CampaignTask[];
}

export interface CampaignCard {
  id: string;
  title: string;
  why_it_matters: string;
  recommended_action: string;
  impact: string;
  evidence_class: string;
}

export interface CampaignInput {
  businessName: string;
  serviceArea: string;
  primaryGoal: string;
  /** Services the owner confirmed (or typed). Never inferred ones. */
  confirmedServices: string[];
  cards: CampaignCard[];
  own: SiteSignals | null;
  competitors: { host: string; signals: SiteSignals }[];
}

const IMPACT: Record<string, number> = { high: 0, medium: 1, low: 2 };
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const cls = (v: string): EvidenceClass => (v === "verified" || v === "inferred" || v === "estimated" ? v : "unknown");
const BLANK_NAME = "[your first name]";

/** The most important open recommendations, as tasks the owner can approve and tick off. */
function firstImpression(i: CampaignInput): Campaign | null {
  const top = [...i.cards].sort((a, b) => (IMPACT[a.impact] ?? 3) - (IMPACT[b.impact] ?? 3)).slice(0, 4);
  if (!top.length) return null;
  return {
    playbook: "fix_first_impression",
    title: "Fix what visitors notice first",
    goal: i.primaryGoal || "Turn more website visits into customers",
    summary: `${top.length} fix${top.length === 1 ? "" : "es"} from your website check, most important first. Each one links to the evidence.`,
    basis: { cards: top.map((c) => c.id) },
    tasks: top.map((c) => ({
      kind: "fix_action" as const,
      title: clip(c.title, 150),
      why: clip(c.why_it_matters, 480),
      steps: [clip(c.recommended_action, 280), "Open the recommendation to see exactly what we found, then mark it done. Your next website check confirms whether it's fixed."],
      card_id: c.id,
      evidence_class: cls(c.evidence_class),
      basis: cls(c.evidence_class) === "verified" ? undefined : "Taken from the open recommendation on your website check.",
    })),
  };
}

/** Offered when the homepage doesn't mention reviews, or a compared site does. */
function reviews(i: CampaignInput): Campaign | null {
  const ownMissing = i.own ? !i.own.reviews : false;
  const rivals = i.competitors.filter((c) => c.signals.reviews).map((c) => c.host);
  if (!ownMissing && !rivals.length) return null;
  const observed = i.own ? `Your homepage doesn't mention reviews or testimonials${rivals.length ? `; ${rivals.join(", ")} ${rivals.length === 1 ? "does" : "do"}` : ""}. (Observed on public homepages.)` : null;
  const name = i.businessName || "us";
  const why = observed ?? "Sites you compared show reviews on the homepage. (Observed.)";
  return {
    playbook: "ask_for_reviews",
    title: "Ask happy customers for reviews",
    goal: i.primaryGoal || "Build trust with people who find you",
    summary: "A short routine for collecting reviews, with a ready message you can edit. You send it yourself.",
    basis: { competitors: rivals, ownMissing },
    tasks: [
      {
        kind: "checklist", title: "Get your review link", why,
        steps: ["Open your Google Business Profile and find the button that gives you a link for asking for reviews.", "Copy the link and keep it somewhere you can paste from.", "If you don't have a profile yet, create one first (it's free)."],
        evidence_class: observed ? "verified" : "estimated", basis: observed ? undefined : "Based on what the compared sites show; your own homepage wasn't read.",
      },
      {
        kind: "message", title: "Send your review request",
        why: "Recent customers are the easiest to ask. A short, friendly message works best.",
        steps: ["Edit the message so it sounds like you.", "Fill in the [blanks].", "Send it to customers you've just helped, by text or email."],
        deliverable: `Hi ${BLANK_NAME}, thank you for choosing ${name}. If you were happy with the work, would you mind leaving a short review? It really helps other people find us: [your review link]\n\nThank you!\n${name}`,
        evidence_class: "estimated", basis: "A standard request message; not measured for your business.",
      },
      {
        kind: "checklist", title: "Show reviews on your website",
        why: "Visitors who see other customers' words trust you faster.",
        steps: ["When you have two or three good reviews, copy their exact words (with permission).", "Add them to your homepage under a heading like “What customers say”."],
        evidence_class: "estimated", basis: "General practice; not measured for your business.",
      },
    ],
  };
}

/** One task per thing the compared sites show that yours doesn't. */
function matchCompetitors(i: CampaignInput): Campaign | null {
  const rows = compareSignals(i.own, i.competitors).filter((r) => r.gap && r.key !== "reviews");
  if (!rows.length) return null;
  return {
    playbook: "match_competitors",
    title: "Close the gaps other sites show",
    goal: i.primaryGoal || "Be at least as easy to choose as the sites you compared",
    summary: `${rows.length} thing${rows.length === 1 ? "" : "s"} the sites you compared show on their homepage that yours doesn't.`,
    basis: { gaps: rows.map((r) => r.key), competitors: i.competitors.map((c) => c.host) },
    tasks: rows.map((r) => ({
      kind: "checklist" as const,
      title: `Add ${SIGNAL_LABEL[r.key].gap}`,
      why: `${r.showing.join(", ")} ${r.showing.length === 1 ? "shows" : "show"} this on the homepage; yours doesn't. (Observed on public homepages, ${r.showing.length} of ${r.compared} compared.)`,
      steps: STEPS[r.key] ?? [],
      deliverable: r.key === "serviceArea" && i.serviceArea ? `Serving ${i.serviceArea}.` : undefined,
      evidence_class: "verified" as const,
    })),
  };
}
const STEPS: Record<string, string[]> = {
  phone: ["Put your phone number in the top corner of every page.", "Use the number customers actually call."],
  clickToCall: ["Make the phone number a tap-to-call link so people on phones can call with one tap.", "Check it on your own phone."],
  serviceArea: ["Add one clear line near the top saying where you work.", "Name the towns or counties you actually serve."],
  pricing: ["Say how pricing works, or offer a free quote, near the top.", "Only state prices you are happy to stand behind."],
  structuredData: ["Ask whoever manages your website to add your business details to the page's search markup.", "Use the same name, address and phone number everywhere."],
};

/** Offered to local businesses: Google Business Profile is not connected, so this is guidance the owner carries out. */
function googleProfile(i: CampaignInput): Campaign | null {
  if (!i.serviceArea) return null;
  const services = i.confirmedServices.slice(0, 6);
  const description = services.length
    ? `${i.businessName} serves ${i.serviceArea}. We offer ${services.join(", ")}. Call or message us to get started.`
    : undefined;
  return {
    playbook: "google_profile",
    title: "Get your Google Business Profile right",
    goal: i.primaryGoal || "Be found by people searching nearby",
    summary: "A short checklist for the profile people see on Google Maps. We can't see your profile (it isn't connected), so this is for you to check.",
    basis: { serviceArea: i.serviceArea, services: services.length },
    tasks: [
      {
        kind: "checklist", title: "Check your profile details",
        why: "Your profile isn't connected, so we can't see it. Wrong or missing details here cost local customers.",
        steps: ["Make sure your business name, phone number and website match your website exactly.", `Set your service area to ${i.serviceArea}.`, "Add your opening hours and pick the most accurate main category."],
        evidence_class: "unknown", basis: "Google Business Profile isn't connected; we haven't seen yours.",
      },
      {
        kind: "message", title: "Write your profile description",
        why: services.length ? "Built from the services you confirmed in Business details." : "Confirm your services in Business details first so this can use them.",
        steps: services.length ? ["Edit it so it sounds like you.", "Paste it into the description of your profile."] : ["Open Business details and confirm your services.", "Then refresh this campaign."],
        deliverable: description,
        evidence_class: services.length ? "verified" : "unknown", basis: services.length ? undefined : "No confirmed services yet.",
      },
    ],
  };
}

export function planCampaigns(i: CampaignInput): Campaign[] {
  return [firstImpression(i), matchCompetitors(i), reviews(i), googleProfile(i)].filter((c): c is Campaign => c !== null);
}

export interface TaskProgress { status: string; card_id: string | null }
/** Results of a campaign: what the owner finished and, for fixes, what the next website check verified. */
export function campaignResults(tasks: TaskProgress[], cards: Map<string, { verification: string | null }>) {
  const done = tasks.filter((t) => t.status === "done").length;
  const skipped = tasks.filter((t) => t.status === "skipped").length;
  const linked = tasks.filter((t) => t.card_id && cards.has(t.card_id));
  const fixed = linked.filter((t) => cards.get(t.card_id!)!.verification === "fixed").length;
  const stillFound = linked.filter((t) => cards.get(t.card_id!)!.verification === "still_found").length;
  return { total: tasks.length, done, skipped, open: tasks.length - done - skipped, fixesLinked: linked.length, verifiedFixed: fixed, stillFound, awaitingCheck: linked.length - fixed - stillFound };
}
