import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { addFact, reviewFact } from "@/app/actions/business";
import { FEATURES } from "@/config/features";
import { FACT_FIELDS, FACT_LABEL, type FactCategory, type StoredFact } from "@/lib/business-profile";
import { requireOrganization } from "@/lib/auth";
import { understand } from "@/lib/server/agent/modules/business-intelligence";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Business details" };

const CATEGORY_TITLE: Record<FactCategory, string> = { business: "Your business", brand: "How you talk about it", customer: "Your customers" };

/** An evidence link that is safe to show: http(s) only, and never able to break the page. */
function safeLink(url: string | null): { href: string; path: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? { href: u.href, path: u.pathname } : null;
  } catch {
    return null;
  }
}

/** Details where the website is describing itself: we can show that it says so, never that it is true. */
const SELF_DESCRIBED: readonly string[] = ["trust_signal", "competitive_advantage", "pricing", "value_proposition", "key_message"];

function claimSource(c: { source: string; status: string; observed_at: string | null }): string {
  const who = c.source === "profile" ? "from your business profile" : c.source === "homepage_scan" ? "shown on your homepage when we last read it" : c.source === "owner" ? "you told us" : c.source === "website" ? "found on your website" : c.source === "model" ? "our reading of your website" : "from research";
  return `${who}${c.status === "confirmed" ? ", confirmed" : ""}${c.observed_at ? ` (${new Date(c.observed_at).toISOString().slice(0, 10)})` : ""}`;
}

function sourceLine(f: StoredFact): string {
  if (f.source === "owner") return "You added this";
  if (f.status === "confirmed") return "You confirmed this";
  if (f.source === "website" && SELF_DESCRIBED.includes(f.field)) return "A claim on your website. We haven't checked that it's true";
  return f.evidence_class === "verified" ? "Found on your website" : "Suggested from your website";
}

/**
 * Business details: what the Marketing Agent knows about the business (Business Intelligence),
 * for the owner to confirm, correct or reject. Behind FEATURES.businessProfile (off in Production).
 */
export default async function BusinessPage() {
  if (!FEATURES.businessProfile) notFound();
  const ws = await requireOrganization();
  const isOwner = ws.organization.role === "owner";
  const supabase = await createClient();
  const { data } = await supabase
    .from("business_facts")
    .select("id, category, field, value, source, evidence_class, basis, evidence, status, observed_at, confirmed_at")
    .eq("organization_id", ws.organization.id)
    .in("status", ["proposed", "confirmed"])
    .order("created_at", { ascending: true });
  const facts = (data ?? []) as unknown as StoredFact[];
  const profile = {
    businessName: ws.business?.businessName ?? "",
    website: ws.business?.website ?? "",
    serviceArea: ws.business?.serviceArea ?? null,
    primaryGoal: ws.business?.primaryGoal ?? null,
  };
  // What the business's own homepage showed on its latest read, so a phone number that changed on the site shows up as a disagreement.
  const { data: selfScan } = await supabase.from("competitor_scans").select("signals, scanned_at").eq("organization_id", ws.organization.id).eq("is_self", true).eq("status", "done").maybeSingle();
  const selfPhone = (selfScan?.signals as { phone?: unknown } | null)?.phone;
  const u = understand(profile, facts, new Date(), typeof selfPhone === "string" && selfPhone ? { phone: selfPhone, observed_at: (selfScan?.scanned_at as string | undefined) ?? null } : null);
  const staleIds = new Set(u.stale.map((s) => `${s.field}|${s.value}`));
  const current = facts.filter((f) => f.value !== null && !staleIds.has(`${f.field}|${f.value}`));
  const toCheck = current.filter((f) => f.status === "proposed");

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">What we know</div>
        <h1 className="h1">Business details</h1>
        <p className="sub">
          What we know about {profile.businessName || "your business"}. We use this to make every suggestion fit your business.
          {toCheck.length ? ` ${toCheck.length} to check.` : ""}
        </p>
      </div>

      {u.conflicts.length ? (
        <section className="card" aria-labelledby="conflicts" style={{ borderColor: "var(--warn, #b7791f)" }}>
          <h2 id="conflicts" style={{ marginTop: 0 }}>These details disagree</h2>
          <p className="small muted">We won&apos;t use them in any suggestion or draft until you tell us which is right.</p>
          <div className="stack">
            {u.conflicts.map((c) => (
              <div key={c.field} style={{ borderTop: "1px solid var(--line, #e6e1d6)", paddingTop: 12 }}>
                <b>{c.question}</b>
                {c.claims.map((cl, i) => (
                  <div key={`${cl.value}-${i}`} style={{ marginTop: 8 }}>
                    <div><b>{cl.value}</b> <span className="small muted">{claimSource(cl)}</span></div>
                    {isOwner && cl.factId ? (
                      <div className="row" style={{ marginTop: 4 }}>
                        <form action={reviewFact}><input type="hidden" name="id" value={cl.factId} /><input type="hidden" name="decision" value="confirm" /><button className="btn" type="submit">That&apos;s right</button></form>
                        <form action={reviewFact}><input type="hidden" name="id" value={cl.factId} /><input type="hidden" name="decision" value="reject" /><button className="btn outline" type="submit">Not right</button></form>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(Object.keys(FACT_FIELDS) as FactCategory[]).map((cat) => {
        const items = current.filter((f) => f.category === cat);
        const owner = cat === "business"
          ? u.known.filter((k) => k.source === "owner" && !facts.some((f) => f.field === k.field && f.value === k.value))
          : [];
        if (!items.length && !owner.length) return null;
        return (
          <section className="card" key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} style={{ marginTop: 0 }}>{CATEGORY_TITLE[cat]}</h2>
            <div className="stack">
              {owner.map((k) => (
                <div key={k.field}>
                  <div className="small muted">{k.label}</div>
                  <b>{k.value}</b>
                  <div className="small muted">From your business profile</div>
                </div>
              ))}
              {items.map((f) => {
                const ev = (f.evidence as { url: string | null; excerpt: string | null }[])[0];
                return (
                  <div key={f.id} style={{ borderTop: "1px solid var(--line, #e6e1d6)", paddingTop: 12 }}>
                    <div className="row between">
                      <div className="small muted">{FACT_LABEL[f.field]}</div>
                      {f.status === "proposed" ? <span className="pill yellow">Please check</span> : <span className="pill green">Confirmed</span>}
                    </div>
                    <b>{f.value}</b>
                    <div className="small muted">{sourceLine(f)}</div>
                    {ev?.excerpt ? (
                      <div className="evidence">
                        “{ev.excerpt}”
                        {safeLink(ev.url) ? (
                          <>
                            {" "}· <a className="link" href={safeLink(ev.url)!.href} target="_blank" rel="noopener noreferrer nofollow">{safeLink(ev.url)!.path}</a>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {f.basis && f.status === "proposed" ? <div className="small muted">Why we think so: {f.basis}</div> : null}
                    {isOwner && f.status === "proposed" ? (
                      <div className="row" style={{ marginTop: 8 }}>
                        <form action={reviewFact}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="decision" value="confirm" />
                          <button className="btn" type="submit">That&apos;s right</button>
                        </form>
                        <form action={reviewFact} className="row">
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="decision" value="confirm" />
                          <label className="sr-only" htmlFor={`fix-${f.id}`}>Correct {FACT_LABEL[f.field].toLowerCase()}</label>
                          <input className="input" id={`fix-${f.id}`} name="value" defaultValue={f.value ?? ""} maxLength={500} />
                          <button className="btn light" type="submit">Save my wording</button>
                        </form>
                        <form action={reviewFact}>
                          <input type="hidden" name="id" value={f.id} />
                          <input type="hidden" name="decision" value="reject" />
                          <button className="btn outline" type="submit">Not right</button>
                        </form>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {u.stale.length ? (
        <section className="card quiet">
          <h3 style={{ marginTop: 0 }}>Seen a while ago</h3>
          <p className="small muted">We haven&apos;t seen these on your website recently, so we don&apos;t rely on them.</p>
          <ul className="small">{u.stale.map((s) => <li key={`${s.field}${s.value}`}>{FACT_LABEL[s.field]}: {s.value}</li>)}</ul>
        </section>
      ) : null}

      {u.missing.length ? (
        <section className="card quiet" aria-labelledby="missing">
          <h3 id="missing" style={{ marginTop: 0 }}>We don&apos;t know yet</h3>
          <p className="small muted">{u.missing.map((f) => FACT_LABEL[f]).join(", ")}.</p>
          {isOwner ? (
            <form action={addFact} className="stack">
              <label className="field">
                <span>Detail</span>
                <select className="input" name="field" defaultValue={`business.${u.missing[0]}`}>
                  {(Object.keys(FACT_FIELDS) as FactCategory[]).flatMap((c) =>
                    FACT_FIELDS[c].map((fld) => <option key={`${c}.${fld}`} value={`${c}.${fld}`}>{FACT_LABEL[fld]}</option>),
                  )}
                </select>
              </label>
              <label className="field">
                <span>What should we know?</span>
                <input className="input" name="value" maxLength={500} required />
              </label>
              <div>
                <button className="btn" type="submit">Add</button>
              </div>
            </form>
          ) : (
            <p className="small muted">Only the account owner can add or confirm business details.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
