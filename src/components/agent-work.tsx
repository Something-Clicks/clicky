"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { ask, importResearch, recordMetric, reviewResults, type AskState } from "@/app/actions/agent";
import { FormMessage, SubmitButton } from "@/components/form";
import type { FormState } from "@/lib/validation";

/** One box for anything the business owner wants help with. Unclear requests get a choice, never a guess. */
export function AskForm({ examples }: { examples: string[] }) {
  const [state, action] = useActionState(ask, {} as AskState);
  const router = useRouter();
  useEffect(() => {
    if (state.redirectTo?.startsWith("/app")) router.push(state.redirectTo);
  }, [state.redirectTo, router]);
  return (
    <div className="stack">
      <form data-clarity-mask="true" action={action} className="stack">
        <FormMessage state={state} />
        <label className="field" htmlFor="ask-request">
          <span>What would you like help with?</span>
          <textarea id="ask-request" name="request" className="input" rows={3} maxLength={1000} defaultValue={state.request} placeholder={examples[0]} />
        </label>
        <div><SubmitButton pending="Working on it… this can take a minute">Ask</SubmitButton></div>
      </form>
      {state.options?.length ? (
        <div className="stack" role="group" aria-label="Choose what you meant">
          <p>{state.message}</p>
          {state.options.map((o) => (
            <form key={o.kind} action={action}>
              <input type="hidden" name="request" value={state.request ?? ""} />
              <input type="hidden" name="kind" value={o.kind} />
              <button className="btn outline" type="submit" style={{ width: "100%" }}>{o.label}</button>
            </form>
          ))}
        </div>
      ) : null}
      <div className="small muted">
        <p style={{ marginBottom: 4 }}>For example:</p>
        <ul style={{ marginTop: 0 }}>{examples.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    </div>
  );
}

export function ReviewResultsForm({ again }: { again: boolean }) {
  const [state, action] = useActionState(reviewResults, {} as FormState);
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <div><SubmitButton pending="Reviewing…">{again ? "Review again" : "Review my results"}</SubmitButton></div>
    </form>
  );
}

export function MetricForm({ metrics, today }: { metrics: { value: string; label: string }[]; today: string }) {
  const [state, action] = useActionState(recordMetric, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action} className="stack">
      <FormMessage state={state} />
      <label className="field" htmlFor="m-metric"><span>What</span>
        <select id="m-metric" name="metric" className="input">{metrics.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </label>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <label className="field" htmlFor="m-start" style={{ flex: "1 1 140px" }}><span>From</span><input id="m-start" name="period_start" type="date" className="input" max={today} required /></label>
        <label className="field" htmlFor="m-end" style={{ flex: "1 1 140px" }}><span>To</span><input id="m-end" name="period_end" type="date" className="input" max={today} required /></label>
      </div>
      <label className="field" htmlFor="m-value"><span>Number</span><input id="m-value" name="value" className="input" inputMode="decimal" required placeholder="e.g. 42" /></label>
      <label className="field" htmlFor="m-source"><span>Where it comes from</span>
        <select id="m-source" name="source" className="input">
          <option value="owner_entered">My own records</option>
          <option value="search_console_export">Google Search Console</option>
          <option value="analytics_export">My website analytics</option>
        </select>
      </label>
      <div><SubmitButton pending="Saving…">Save</SubmitButton></div>
    </form>
  );
}

export function ResearchImportForm({ today }: { today: string }) {
  const [state, action] = useActionState(importResearch, {} as FormState);
  return (
    <form data-clarity-mask="true" action={action} className="stack">
      <FormMessage state={state} />
      <label className="field" htmlFor="r-source"><span>Where the keywords come from</span>
        <select id="r-source" name="source" className="input">
          <option value="semrush_export">Semrush export (CSV)</option>
          <option value="search_console_export">Google Search Console export (Queries CSV)</option>
          <option value="owner">My own list (one per line)</option>
        </select>
      </label>
      <label className="field" htmlFor="r-date"><span>Date of the export</span><input id="r-date" name="measured_on" type="date" className="input" max={today} defaultValue={today} required /></label>
      <label className="field" htmlFor="r-file"><span>File</span><input id="r-file" name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="input" /></label>
      <label className="field" htmlFor="r-text"><span>Or paste it here</span><textarea id="r-text" name="text" className="input" rows={5} maxLength={300000} /></label>
      <p className="small muted">We keep each keyword with where it came from and its date. Semrush&apos;s volumes and difficulty are its own estimates, and we label them that way.</p>
      <div><SubmitButton pending="Importing…">Import</SubmitButton></div>
    </form>
  );
}
