import Link from 'next/link';
import { decideCard, prepareDeliverable } from '../../../actions';
import { EvidencePill, Notice, one, PriorityPill, type SP, when } from '@/components/ui';
import { orNotFound, requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export default async function CardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params; const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent } = getContainer();
  const row = await orNotFound(agent.cards.get(ctx, id)); const c = row.card; const deps = await Promise.all(c.dependencies.map((d) => agent.cards.get(ctx, d).catch(() => undefined)));
  return (<><p><Link href="/board">← Action Board</Link></p><h1>{c.title}</h1><Notice e={one(sp.e)} m={one(sp.m)} />
    <div className="row"><PriorityPill label={c.priority.label} /><EvidencePill v={c.evidenceClass} /><span className="pill">confidence {c.confidence}</span><span className="pill">effort {c.estimatedEffort}</span><span className="pill">{c.status.replace('_', ' ')}</span><span className="pill">{c.category.replace(/_/g, ' ')}</span></div>
    <div className="card"><h3>What we found</h3><p>{c.finding}</p>
      <h3>Evidence</h3>{c.evidence.map((e, i) => (<div className="quote" key={i}>{e.kind === 'quote' ? `“${e.text}”` : e.text}<div className="small">{e.kind} · {e.source}</div></div>))}
      <h3>Why it matters</h3><p>{c.importance}</p><h3>Recommendation</h3><p>{c.recommendation}</p></div>
    {deps.some(Boolean) && <div className="card"><h3>Do these first</h3><ul>{deps.filter(Boolean).map((d) => <li key={d!.id}><Link href={`/board/${d!.id}`}>{d!.card.title}</Link></li>)}</ul></div>}
    <div className="card"><h3>Prepared work</h3>
      {c.deliverableId ? <p><Link className="btn" href={`/deliverables/${c.deliverableId}`}>Review and edit the draft</Link></p>
        : c.deliverableType ? <form action={prepareDeliverable}><input type="hidden" name="id" value={id} /><p className="mut">The agent can write a draft ({c.deliverableType.replace(/_/g, ' ')}) from your profile and website facts. It counts as one use when saved.</p><button>Prepare the draft</button></form>
        : <p className="mut">This is a recommendation; there is nothing for the agent to write.</p>}
      <p className="small mut">Approval {c.approval.required ? 'required' : 'not required'}{c.approval.approvedAt ? ` · approved ${when(c.approval.approvedAt)}` : ''}. {c.execution.reason}</p></div>
    {!c.deliverableId && !['dismissed', 'rejected'].includes(c.status) && (<form action={decideCard} className="row"><input type="hidden" name="id" value={id} />{!c.approval.required && <button name="action" value="accept">Accept this recommendation</button>}<button className="sec" name="action" value="dismiss">Dismiss</button><button className="sec" name="action" value="reject">Reject</button></form>)}
    {['dismissed', 'rejected'].includes(c.status) && <form action={decideCard}><input type="hidden" name="id" value={id} /><button className="sec" name="action" value="reopen">Reopen</button></form>}
    <details><summary>History</summary><ul className="clean small">{row.decisions.map((d, i) => <li key={i}>{when(d.at)} · {d.action} · {d.by}{d.note ? ` · ${d.note}` : ''}</li>)}</ul></details></>);
}
