import { effortOf } from "./rules-strategy";

/**
 * Effort and dependencies for Action Cards (specification §9 "recognize dependencies", §13.1 "Estimated effort",
 * "Dependencies"). Fixed rules over the checks that fired, not a model: a card depends on another only when doing them in
 * the other order would waste work or measure the wrong thing.
 *
 *   site.no_https          → before speed measurement and mobile work (a redirect to HTTPS changes both)
 *   mobile.viewport_missing → before speed work (mobile speed is measured on a page that is not set up for phones)
 *   meta.title_*           → before the description (the description complements the title; write it second)
 *   content.h1_missing     → before thin-homepage content (the headline sets what the rest of the page explains)
 *   local.service_area_missing → before thin-homepage content (the content should name the area)
 *
 * Only dependencies on cards in the same set are kept. Ids are whatever the caller uses to name cards (card ids, or check
 * keys when the database resolves them, as annotate_action_cards does).
 */
const RULES: { card: RegExp; after: RegExp[] }[] = [
  { card: /^pagespeed\./, after: [/^site\.no_https$/, /^mobile\.viewport_missing$/] },
  { card: /^mobile\.viewport_missing$/, after: [/^site\.no_https$/] },
  { card: /^meta\.description_/, after: [/^meta\.title_/] },
  { card: /^content\.thin_homepage$/, after: [/^content\.h1_missing$/, /^local\.service_area_missing$/] },
];

export interface DependencyCard {
  id: string;
  check_key: string | null;
}

export interface CardAnnotation {
  id: string;
  effort: "small" | "medium" | "large";
  depends_on: string[];
}

export function annotateCards(cards: DependencyCard[]): CardAnnotation[] {
  return cards.map((c) => {
    const rule = c.check_key ? RULES.find((r) => r.card.test(c.check_key!)) : undefined;
    const deps = rule
      ? cards.filter((o) => o.id !== c.id && o.check_key && rule.after.some((a) => a.test(o.check_key!))).map((o) => o.id)
      : [];
    return { id: c.id, effort: effortOf(c.check_key), depends_on: [...new Set(deps)].slice(0, 5) };
  });
}

/**
 * Orders cards so that no card comes before one it depends on, keeping the incoming order otherwise (stable).
 * Cycles cannot arise from RULES, but if a caller passes one the remaining cards keep their order.
 */
export function orderByDependencies<T extends { id: string }>(items: T[], dependsOn: (item: T) => string[]): T[] {
  const ids = new Set(items.map((i) => i.id));
  const placed = new Set<string>();
  const out: T[] = [];
  let remaining = [...items];
  while (remaining.length) {
    const next = remaining.find((i) => dependsOn(i).every((d) => !ids.has(d) || placed.has(d))) ?? remaining[0]!;
    out.push(next);
    placed.add(next.id);
    remaining = remaining.filter((i) => i !== next);
  }
  return out;
}
