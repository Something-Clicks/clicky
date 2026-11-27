import Link from 'next/link';
import { Pill, when } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { DELIVERABLE_SPECS } from '@/agent/capabilities/deliverable-specs';

export default async function Drafts() {
  const { ctx } = await requireWorkspace(); const { agent } = (await getContainer()); const ds = await agent.deliverables.list(ctx);
  return (<><h1>Drafts</h1><p className="mut">Everything the agent prepared. Edit freely; nothing is used until you approve it.</p>
    {!ds.length && <div className="card">No drafts yet. Open an <Link href="/board">Action Card</Link> and prepare one, or <Link href="/ask">ask the agent</Link>.</div>}
    {ds.map((d) => { const v = agent.deliverables.current(d); return (<div className="card" key={d.id}><div className="row"><Link href={`/deliverables/${d.id}`}><strong>{v.title}</strong></Link><span className="sp" /><Pill>{DELIVERABLE_SPECS[d.type].label}</Pill><Pill>{d.status}</Pill></div><p className="mut small">Version {v.n} · {when(v.createdAt)} · {v.flags.filter((f) => !f.acknowledgedBy).length} flag(s)</p></div>); })}</>);
}
