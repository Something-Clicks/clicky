import Link from 'next/link';
import { EvidencePill, PriorityPill, one, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import type { CardStatus } from '@/agent/domain/models';

const GROUPS: [string, CardStatus[]][] = [['To review', ['new', 'drafting', 'ready_for_review']], ['Approved', ['approved', 'authorized', 'executing']], ['Done', ['executed', 'verified']], ['Set aside', ['rejected', 'dismissed', 'failed']]];
export default async function Board({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const cat = one(sp.category);
  const all = await (await getContainer()).agent.cards.board(ctx, { category: cat }); const cats = [...new Set((await (await getContainer()).agent.cards.board(ctx)).map((c) => c.card.category))];
  return (<><h1>Action Board</h1><p className="mut">Findings ranked by what is most likely to make a difference, easiest and best-evidenced first.</p>
    <div className="row"><Link className={`pill ${!cat ? 'e-verified' : ''}`} href="/board">All</Link>{cats.map((c) => <Link key={c} className={`pill ${cat === c ? 'e-verified' : ''}`} href={`/board?category=${c}`}>{c.replace(/_/g, ' ')}</Link>)}</div>
    {!all.length && <div className="card">No cards yet. <Link href="/ask">Ask the agent to review your website.</Link></div>}
    {GROUPS.map(([label, sts]) => { const cs = all.filter((c) => sts.includes(c.card.status)); return cs.length ? (<section key={label}><h2>{label} ({cs.length})</h2>{cs.map((c) => (
      <div className="card" key={c.id}><div className="row"><Link href={`/board/${c.id}`}><strong>#{c.card.priority.rank} {c.card.title}</strong></Link><span className="sp" /><PriorityPill label={c.card.priority.label} /><EvidencePill v={c.card.evidenceClass} /><span className="pill">{c.card.status.replace('_', ' ')}</span></div>
        <p className="mut">{c.card.finding}</p><p className="small mut">{c.card.category.replace(/_/g, ' ')} · confidence {c.card.confidence} · effort {c.card.estimatedEffort}{c.card.deliverableType ? ' · draft available' : ''}</p></div>))}</section>) : null; })}</>);
}
