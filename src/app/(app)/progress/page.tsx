import Link from 'next/link';
import Locked from '@/components/Locked';
import { Pill, PriorityPill, when } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export default async function Progress() {
  const { ctx } = await requireWorkspace(); const { agent } = getContainer();
  if (!(await agent.gate.has(ctx, 'progress_tracking'))) return <Locked feature="progress_tracking" title="Progress" />;
  const p = await agent.progress.summary(ctx);
  return (<><h1>Progress</h1><p className="mut">What has improved since your first review and what is next. When a later review no longer finds an issue, it is marked resolved automatically.</p>
    <div className="grid g2"><div className="card"><h2 style={{ marginTop: 0 }}>{p.percentDone}% done</h2><div role="progressbar" aria-valuenow={p.percentDone} aria-valuemin={0} aria-valuemax={100} aria-label="Share of findings done" style={{ background: 'var(--line)', borderRadius: 99, height: 10 }}><div style={{ width: `${p.percentDone}%`, background: 'var(--ok)', height: 10, borderRadius: 99 }} /></div>
      <p>{p.done} of {p.total} finding(s) done · {p.open} open · {p.resolved} resolved by review · {p.approvedDrafts} draft(s) approved</p>{p.daysSinceReview !== undefined && <p className="small mut">Last website review {p.daysSinceReview} day(s) ago ({when(p.lastReviewAt)}).</p>}</div>
      <div className="card"><h2 style={{ marginTop: 0 }}>Next up</h2><ul className="clean">{p.next.map((n) => <li key={n.id}><Link href={`/board/${n.id}`}>{n.title}</Link> <PriorityPill label={n.priority} /> <Pill>{n.status.replace('_', ' ')}</Pill></li>)}{!p.next.length && <li className="mut">Nothing open. Run a new review from the Sites page or ask the agent.</li>}</ul></div></div>
    <section className="card"><h2 style={{ marginTop: 0 }}>Review history</h2>{p.reviews.length ? <table><thead><tr><th>When</th><th>Findings</th><th>New</th><th>Resolved</th></tr></thead><tbody>{p.reviews.map((r) => <tr key={r.id}><td><Link href={`/runs/${r.id}`}>{when(r.at)}</Link>{r.scheduled ? ' (scheduled)' : ''}</td><td>{r.findings}</td><td>{r.newCards}</td><td>{r.resolved}</td></tr>)}</tbody></table> : <p className="mut">No reviews yet.</p>}</section>
    {p.resolvedItems.length > 0 && <section className="card"><h2 style={{ marginTop: 0 }}>Fixed since earlier reviews</h2><ul>{p.resolvedItems.map((r) => <li key={r.id}><Link href={`/board/${r.id}`}>{r.title}</Link></li>)}</ul></section>}
    {p.completedActivities.length > 0 && <section className="card"><h2 style={{ marginTop: 0 }}>Work you completed</h2><ul>{p.completedActivities.map((a, i) => <li key={i}>{a.type.replace(/_/g, ' ')} · {when(a.at)}{a.url ? <> · <a href={a.url} rel="noopener noreferrer">{a.url}</a></> : null}</li>)}</ul><p className="small mut">Recorded by you; the platform cannot verify publication.</p></section>}</>);
}
