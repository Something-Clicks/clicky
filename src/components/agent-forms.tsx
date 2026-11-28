"use client";

import { useActionState } from "react";

import { compareWebsites, findCompetitors, prepareCampaigns, writeCampaignDrafts } from "@/app/actions/campaigns";
import { FormMessage, SubmitButton } from "@/components/form";
import type { DiscoverState } from "@/lib/research";
import type { FormState } from "@/lib/validation";

/** Names up to 5 websites to compare with. Reads only their public homepages. */
export function CompareForm() {
  const [state, action] = useActionState(compareWebsites, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action} className="stack">
      <FormMessage state={state} />
      <label className="field" htmlFor="compare-sites">
        <span>Websites to compare with (up to 5, one per line)</span>
        <textarea id="compare-sites" name="sites" className="input" rows={4} maxLength={800} placeholder={"example-plumbing.com\nanother-business.com"} required />
      </label>
      <p className="small muted">We read each site&apos;s public homepage, the same way we read yours. We don&apos;t search for competitors or guess who they are.</p>
      <div><SubmitButton pending="Reading the websites… this can take a minute">Compare</SubmitButton></div>
    </form>
  );
}

/**
 * Finds similar local businesses from open sources and shows where each one came from. Nothing is saved or read until the owner
 * ticks some and presses Compare; then only their public homepages are read.
 */
export function DiscoverForm() {
  const [found, find] = useActionState(findCompetitors, {} as DiscoverState);
  const [compared, compare] = useActionState(compareWebsites, {} as FormState);
  const r = found.result;
  return (
    <div className="stack">
      <form action={find} className="stack">
        {found.error ? <p className="notice" role="alert">{found.error}</p> : null}
        <p className="small muted">We look for businesses like yours near you in public map listings and web search. We use only a place and what you do. We never send your business name or details.</p>
        <div><SubmitButton pending="Looking… this can take about half a minute">Find similar businesses</SubmitButton></div>
      </form>
      {r ? (
        <div className="stack">
          {r.sourceStatus.filter((s) => s.note).map((s) => <p key={s.source} className="small muted">{s.source === "openstreetmap" ? "Map listings" : "Web search"}: {s.note}</p>)}
          {r.candidates.length === 0 ? <p>We didn&apos;t find anyone to suggest this time. You can still type the websites you know.</p> : (
            <form action={compare} className="stack" data-clarity-mask="true">
              <FormMessage state={compared} />
              <ul className="stack" style={{ listStyle: "none", paddingLeft: 0 }}>
                {r.candidates.map((c) => (
                  <li key={c.host} className="card">
                    <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <input type="checkbox" name="sites" value={c.host} style={{ marginTop: 4 }} />
                      <span>
                        <b>{c.name ?? c.host}</b> <span className="small muted">{c.host}</span>
                        <span className="small muted" style={{ display: "block" }}>Why it&apos;s here: {c.basis}</span>
                        <span className="small" style={{ display: "block" }}>
                          {c.sources.slice(0, 3).map((x, i) => <span key={i}>{i ? " · " : "See: "}<a className="link" href={x.url} target="_blank" rel="noopener noreferrer nofollow">{x.kind === "openstreetmap" ? "map listing" : "search result"}</a></span>)}
                        </span>
                        <input type="hidden" name={`origin:${c.host}`} value={c.basis} />
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div><SubmitButton pending="Reading the websites… this can take a minute">Compare the ones I ticked</SubmitButton></div>
            </form>
          )}
          <ul className="small muted" style={{ paddingLeft: 18 }}>{r.limits.map((l) => <li key={l}>{l}</li>)}</ul>
          {r.attribution.map((a) => <p key={a} className="small muted">{a}</p>)}
        </div>
      ) : null}
    </div>
  );
}

export function CampaignForm({ again }: { again: boolean }) {
  const [state, action] = useActionState(prepareCampaigns, {} as FormState);
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <div><SubmitButton pending="Preparing…">{again ? "Refresh the campaigns" : "Prepare my campaigns"}</SubmitButton></div>
    </form>
  );
}

/** Asks for a written draft of each page, email and post in a campaign. */
export function WriteDraftsForm({ campaign, again }: { campaign: string; again: boolean }) {
  const [state, action] = useActionState(writeCampaignDrafts, {} as FormState);
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <input type="hidden" name="campaign" value={campaign} />
      <div><SubmitButton pending="Writing… this can take a few minutes">{again ? "Write them again" : "Write the drafts for me"}</SubmitButton></div>
      <p className="small muted">Written from your confirmed business details. Check every word; nothing is sent or published.</p>
    </form>
  );
}
