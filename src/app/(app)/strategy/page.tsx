import Link from 'next/link';
import { approveStrategy, submitRequest } from '../../actions';
import { EvidencePill, MockBanner, Notice, one, Pill, type SP, when } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export default async function Strategy({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent } = (await getContainer()); const s = await agent.strategies.latest(ctx); const d = s?.data;
  return (<><h1>Marketing strategy</h1><Notice e={one(sp.e)} m={one(sp.m)} />
    <form action={submitRequest} className="card"><input type="hidden" name="back" value="/strategy" /><input type="hidden" name="taskType" value="marketing_plan" /><input type="hidden" name="request" value="Develop a marketing plan" /><div className="row"><span>{s ? 'Create an updated strategy from your latest findings.' : 'The agent will read your site, research and findings, then draft a plan specific to your business.'}</span><span className="sp" /><button>{s ? 'Update strategy' : 'Develop a marketing plan'}</button></div></form>
    {s && d && (<><MockBanner show={s.mock} /><div className="row"><Pill>{s.status}</Pill><span className="mut small">Drafted {when(s.createdAt)}</span><span className="sp" />{s.status === 'draft' && <form action={approveStrategy}><input type="hidden" name="id" value={s.id} /><button>Approve strategy</button></form>}</div>
      <div className="card"><h3>Objectives</h3><ul>{d.objectives.map((o, i) => <li key={i}>{o.objective}<div className="small mut">Basis: {o.basis}</div></li>)}</ul><h3>Positioning</h3><ul>{d.positioning.map((x, i) => <li key={i}>{x}</li>)}</ul><h3>Audiences</h3><ul>{d.audiences.map((a, i) => <li key={i}><strong>{a.name}</strong> <EvidencePill v={a.evidenceClass} /> {a.description}</li>)}</ul><h3>Messaging</h3><ul>{d.messaging.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      <div className="card"><h3>Channels</h3><table><tbody>{d.channels.map((c, i) => <tr key={i}><td><strong>{c.channel}</strong><div className="small mut">{c.priority} priority</div></td><td>{c.role}<div className="small mut">{c.rationale}</div></td></tr>)}</tbody></table><h3>SEO</h3><ul>{d.seoStrategy.map((x, i) => <li key={i}>{x}</li>)}</ul><h3>Content</h3><ul>{d.contentStrategy.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      <div className="card"><h3>Prioritized actions</h3><ol>{d.prioritizedActions.map((a, i) => <li key={i}><Link href={`/board/${a.cardId}`}>Open card</Link> · {a.rationale}</li>)}</ol><h3>Calendar</h3><table><tbody>{d.calendar.map((c, i) => <tr key={i}><td>Week {c.weekOffset + 1}</td><td>{c.activity}</td></tr>)}</tbody></table></div>
      {d.assumptions.length > 0 && <div className="card"><h3>Assumptions to confirm</h3><ul>{d.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}</>)}</>);
}
