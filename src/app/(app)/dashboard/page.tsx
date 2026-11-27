import Link from 'next/link';
import { submitRequest } from '../../actions';
import { EvidencePill, Notice, one, PriorityPill, when, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { TASK_LABEL } from '@/agent/orchestrator/workflows';

const PRESETS = [['Improve my homepage headline', 'homepage_copy'], ['Research my competitors', 'competitor_research'], ['Develop a marketing plan', 'marketing_plan'], ['Review my website', 'website_audit']] as const;
export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx, business } = await requireWorkspace(); const { agent, entitlements } = getContainer();
  const [board, runs, usage, comp] = await Promise.all([agent.cards.board(ctx, { status: ['new', 'ready_for_review', 'drafting', 'approved'] }), agent.orchestrator.list(ctx, 5), entitlements.status(ctx), agent.profiles.completeness(ctx.businessId)]);
  return (<>
    <h1>{business.name}</h1><Notice e={one(sp.e)} m={one(sp.m)} />
    {(comp.conflicts.length > 0 || comp.missingCore.length > 0) && <div className="banner warn">Your Business Profile has {comp.missingCore.length} unknown core field(s){comp.conflicts.length ? ` and ${comp.conflicts.length} conflict(s)` : ''}. Better information means better recommendations. <Link href="/profile">Review profile</Link></div>}
    <div className="grid g2">
      <div className="card"><h3>What should I work on?</h3>
        <ul className="clean">{board.slice(0, 3).map((c) => (<li key={c.id}><Link href={`/board/${c.id}`}>{c.card.title}</Link> <PriorityPill label={c.card.priority.label} /> <EvidencePill v={c.card.evidenceClass} /></li>))}{!board.length && <li className="mut">No open cards yet. Ask the agent below.</li>}</ul>
        <p><Link href="/board">Open the Action Board →</Link></p></div>
      <div className="card"><h3>Your plan</h3>
        {usage.draftsLimit ? <p>{usage.planName}: {usage.draftsRemaining} of {usage.draftsLimit} drafts left this period.</p> : <p>{usage.planName}: {usage.freeRemaining} of 3 free uses left{usage.reportCredits ? ` · ${usage.reportCredits} Marketing Report credit` : ''}.</p>}
        <p className="mut small">A use counts only when a completed result is saved. Errors and retries are free.</p><Link href="/billing">Plans and billing</Link></div></div>
    <h2>Ask the Marketing Agent</h2>
    <form action={submitRequest} className="card"><input type="hidden" name="back" value="/dashboard" />
      <label htmlFor="request">What do you need?</label><input id="request" name="request" placeholder="e.g. Develop a marketing plan" required />
      <div className="row" style={{ marginTop: 10 }}>{PRESETS.map(([t]) => <span className="pill" key={t}>{t}</span>)}</div>
      <p><button>Send to the agent</button></p></form>
    <h2>Recent work</h2>
    <div className="card"><ul className="clean">{runs.map((r) => (<li key={r.id}><Link href={`/runs/${r.id}`}>{TASK_LABEL[r.taskType]}</Link> <span className="pill">{r.status.replace('_', ' ')}</span> <span className="mut small">{when(r.createdAt)} · “{r.request.slice(0, 60)}”</span></li>))}{!runs.length && <li className="mut">Nothing yet.</li>}</ul></div>
  </>);
}
