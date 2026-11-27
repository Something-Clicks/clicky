import Link from 'next/link';
import { markCampaignTask, prepareCampaignTask } from '../../../actions';
import { Notice, one, Pill, type SP } from '@/components/ui';
import { orNotFound, requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export default async function Campaign({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const { id } = await params; const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent } = getContainer();
  const c = await orNotFound(agent.campaignsSync(ctx, id));
  const title = (k: string) => c.tasks.find((t) => t.key === k)?.title ?? k;
  return (<><p><Link href="/campaigns">← Campaigns</Link></p><h1>{c.name}</h1><Notice e={one(sp.e)} />
    <div className="card"><p><strong>Objective:</strong> {c.objective}</p><p><strong>Audience:</strong> {c.audience}</p><p><strong>Offer:</strong> {c.offer}</p><p><strong>Core message:</strong> {c.coreMessage}</p><p className="small mut">Channels: {c.channels.join(', ')}</p></div>
    <h2>Tasks</h2>{c.tasks.map((t) => (<div className="card" key={t.key}><div className="row"><strong>{t.title}</strong><span className="sp" /><Pill cls={t.status === 'done' ? 'e-verified' : t.status === 'blocked' ? 'e-unknown' : ''}>{t.status.replace('_', ' ')}</Pill><span className="small mut">day {t.offsetDays}</span></div><p className="mut small">{t.description}</p>
      {t.dependsOn.length > 0 && <p className="small">Depends on: {t.dependsOn.map(title).join(', ')}</p>}
      <div className="row">{t.deliverableId ? <Link className="btn sec" href={`/deliverables/${t.deliverableId}`}>Open draft</Link> : t.deliverableType && t.status === 'ready' ? <form action={prepareCampaignTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="key" value={t.key} /><button>Prepare draft</button></form> : null}
        {!t.deliverableId && t.status === 'ready' && <form action={markCampaignTask}><input type="hidden" name="id" value={id} /><input type="hidden" name="key" value={t.key} /><button className="sec" name="status" value="done">Mark done</button></form>}</div></div>))}
    <div className="card"><h3>How we will measure it</h3><ul>{c.measurementPlan.goals.map((g) => <li key={g}>{g}</li>)}</ul><p className="small mut">Metrics: {c.measurementPlan.metrics.join(', ')} · reviews at day {c.measurementPlan.reviewOffsetsDays.join(', ')}</p>{c.risks.length > 0 && <><h3>Risks and notes</h3><ul>{c.risks.map((r) => <li key={r} className="small">{r}</li>)}</ul></>}</div></>);
}
