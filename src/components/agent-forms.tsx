"use client";

import { useActionState } from "react";

import { compareWebsites, prepareCampaigns, writeCampaignDrafts } from "@/app/actions/campaigns";
import { FormMessage, SubmitButton } from "@/components/form";
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
