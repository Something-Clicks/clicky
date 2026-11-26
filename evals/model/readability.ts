/** Flesch-Kincaid reading grade (an automatic check for plain language). Placeholders in [brackets] are ignored. */
const syllables = (word: string) => {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
};

export function readingGrade(text: string): number | null {
  const clean = text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").filter((w) => /[a-z]/i.test(w));
  const sentences = clean.split(/[.!?]+(?:\s|$)/).filter((s) => /[a-z]/i.test(s)).length || 1;
  if (words.length < 5) return null;
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}
