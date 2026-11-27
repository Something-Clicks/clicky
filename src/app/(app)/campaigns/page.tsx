import Link from 'next/link';
import { submitRequest } from '../../actions';
import { Notice, one, Pill, type SP, when } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export default async function Campaigns({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent: ag } = await getContainer(); const cs = await Promise.all((await ag.campaigns.list(ctx)).map((c) => ag.campaignsSync(ctx, c.id)));
  return (<><h1>Campaigns</h1><Notice e={one(sp.e)} />
    <form action={submitRequest} className="card"><input type="hidden" name="back" value="/campaigns" /><input type="hidden" name="taskType" value="campaign" /><h3>Plan a campaign</h3>
      <label htmlFor="goal">What should it achieve? Which service?</label><input id="goal" name="goal" required placeholder="e.g. Get more drain cleaning enquiries before winter" /><input type="hidden" name="request" value="Prepare a promotional campaign" />
      <label htmlFor="offer">Offer (only if you really have one; the agent will not invent one)</label><input id="offer" name="offer" /><p><button>Plan campaign</button></p></form>
    {cs.map((c) => <div className="card" key={c.id}><div className="row"><Link href={`/campaigns/${c.id}`}><strong>{c.name}</strong></Link><span className="sp" /><Pill>{c.status}</Pill></div><p className="mut small">{c.objective} · {c.tasks.filter((t) => t.status === 'done').length}/{c.tasks.length} tasks done · {when(c.createdAt)}</p></div>)}</>);
}
