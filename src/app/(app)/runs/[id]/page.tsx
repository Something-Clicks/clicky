import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { retryRun, submitRequest } from '../../../actions';
import { MockBanner, Notice, one, when, type SP } from '@/components/ui';
import { orNotFound, requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { TASK_LABEL } from '@/agent/orchestrator/workflows';

export const dynamic = 'force-dynamic';
export default async function Run({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params; const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent } = (await getContainer());
  const r = await orNotFound(agent.orchestrator.get(ctx, id)); const active = r.status === 'queued' || r.status === 'running';
  const st = r.state as { cardIds?: string[]; deliverableIds?: string[]; strategyId?: string; campaignId?: string; reportId?: string; focusCardIds?: string[] };
  return (<>
    <h1>{TASK_LABEL[r.taskType]}</h1><p className="mut">“{r.request}” · {when(r.createdAt)}</p><Notice e={one(sp.e)} /><AutoRefresh active={active} /><MockBanner show={r.mock} />
    <div className="card"><div className="row"><strong>Status:</strong> <span className="pill">{r.status.replace('_', ' ')}</span><span className="sp" />{r.status === 'failed' && <form action={retryRun}><input type="hidden" name="id" value={r.id} /><button className="sec">Retry (does not use an allowance)</button></form>}</div>
      {r.error && <div className="banner err">{r.error.message}</div>}
      <ol>{r.steps.map((s) => (<li key={s.capability}><strong>{s.capability.replace(/_/g, ' ')}</strong> · <span className="pill">{s.status}</span> {s.summary && <span className="mut"> {s.summary}</span>}{s.error && <span style={{ color: 'var(--bad)' }}> {s.error.message}</span>}</li>))}</ol></div>
    {r.status === 'needs_input' && (<form action={submitRequest} className="card"><input type="hidden" name="back" value={`/runs/${r.id}`} /><input type="hidden" name="request" value={r.request} /><input type="hidden" name="taskType" value={r.taskType} />
      <h3>I need a bit more from you</h3><ul>{r.questions.map((q) => <li key={q}>{q}</li>)}</ul>
      <label htmlFor="notes">Your answer</label><textarea id="notes" name="notes" />
      <label htmlFor="competitorUrls">Competitor websites (if asked)</label><input id="competitorUrls" name="competitorUrls" />
      <label htmlFor="deliverableType">What to create (if asked)</label><input id="deliverableType" name="deliverableType" placeholder="e.g. blog_article, email, social_posts, faq" /><label htmlFor="url">Website (if asked)</label><input id="url" name="url" />
      <p><button>Continue</button></p></form>)}
    {r.status === 'succeeded' && (<div className="card"><h3>Results saved to your workspace</h3><ul>
      {!!st.cardIds?.length && <li><Link href="/board">{st.cardIds.length} new Action Card(s)</Link></li>}
      {st.deliverableIds?.map((d) => <li key={d}><Link href={`/deliverables/${d}`}>Editable draft →</Link></li>)}
      {st.strategyId && <li><Link href="/strategy">Marketing strategy</Link></li>}{st.campaignId && <li><Link href={`/campaigns/${st.campaignId}`}>Campaign plan</Link></li>}
      {st.reportId && <li><Link href="/performance">Performance report</Link></li>}{!!(r.state as { researchIds?: string[] }).researchIds?.length && <li><Link href="/research">Research library</Link></li>}</ul></div>)}
    {r.limitations.length > 0 && <div className="card"><h3>What this did not cover</h3><ul>{r.limitations.map((l) => <li key={l} className="small">{l}</li>)}</ul></div>}
    {r.questions.length > 0 && r.status === 'succeeded' && <div className="card"><h3>Questions that would improve the results</h3><ul>{r.questions.slice(0, 6).map((q) => <li key={q} className="small">{q}</li>)}</ul><Link href="/profile">Answer in your Business Profile</Link></div>}
    <p className="mut small">Approvals: {r.approvalRequirements.join(' ')}</p></>);
}
