/**
 * Checks on text a model wrote, before it is saved or shown.
 * Pure functions; no network. Used for finding wording (product copy) and drafts (the owner's copy).
 */

/** Words the product never uses in customer-facing copy. */
const PRODUCT_JARGON = /\b(AI|A\.I\.|artificial intelligence|agents?|prompts?|campaigns?|LLM|language model|chatbot)\b/i;

/** Names that would mean the model is talking about itself or its maker. (Not applied to drafts: a business may be called "Claude's".) */
const PRODUCT_NAMES = /\b(anthropic|claude)\b/i;

/** Signs that the model is repeating its instructions or the structure we sent it. */
const LEAK_MARKERS =
  /(system prompt|as an ai\b|i(?:'m| am) an? (?:ai|assistant|language model)|my instructions|the instructions (?:above|i was given)|instructions above|<\/?(?:analysis|brief|context)>|check_key|treat all evidence|json schema|something clicks, which explains)/i;

/** True if the text looks like the model leaking system text or talking about itself. */
export const leaksSystemText = (text: string) => LEAK_MARKERS.test(text);

/** True if product copy contains words we never show customers. */
export const hasProductJargon = (text: string) => PRODUCT_JARGON.test(text) || PRODUCT_NAMES.test(text);

/** Why finding wording was rejected, or null when it is fine. */
export function wordingProblem(text: string, maxLength: number): string | null {
  if (!text.trim()) return "empty";
  if (text.length > maxLength) return "too_long";
  if (leaksSystemText(text)) return "leaked_system_text";
  if (hasProductJargon(text)) return "product_jargon";
  return null;
}
