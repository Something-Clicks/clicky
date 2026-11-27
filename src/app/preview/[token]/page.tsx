import Link from 'next/link';
import AutoRefresh from '@/components/AutoRefresh';
import { EvidencePill, MockBanner, PriorityPill } from '@/components/ui';
import { buildCard } from '@/agent/capabilities/cards';
import { getServerContainer } from '@/server/container';

export const dynamic = 'force-dynamic';
export default async function Preview({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params; const { previews } = (await getServerContainer());
  const p = await previews.byToken(token).catch(() => undefined);
  if (!p) return <main className="wrap"><h1>Preview not found</h1><p><Link href="/">Start a new analysis</Link></p></main>;
  const working = p.status === 'queued' || p.status === 'running'; const r = p.result;
  const top = (r?.findings ?? []).slice(0, 3).map((f, i) => buildCard(f, i + 1, []));
  return (
    <main className="wrap">
      <div className="row" style={{ padding: '14px 0' }}><Link href="/"><strong>Something Clicks</strong></Link></div>
      <h1>Your first result</h1><p className="mut">{p.url} · ZIP {p.zip}</p>
      <AutoRefresh active={working} />
      {p.status === 'failed' && <div className="banner err">{p.error}</div>}
      {r && (<>
        <MockBanner show={r.mock} />
        <div className="card"><h3>What we understood</h3>
          <p>{r.business.name ? <strong>{r.business.name}</strong> : 'Business name not found'}{r.business.industry ? ` · ${r.business.industry} (inferred)` : ''}</p>
          {r.business.services.length > 0 && <p className="small"><strong>Services found on your site:</strong> {r.business.services.join(', ')}</p>}
          <p className="mut small">Read {r.pagesRead} page(s). {r.limitations.slice(0, 2).join(' ')}</p></div>
        <h2>Most important things we found</h2>
        {top.length === 0 && <div className="card">We did not find evidence-backed problems in the pages we could read.</div>}
        {top.map((c) => (<div className="card" key={c.dedupeKey}>
          <div className="row"><strong>{c.title}</strong><span className="sp" /><PriorityPill label={c.priority.label} /><EvidencePill v={c.evidenceClass} /></div>
          <p>{c.finding}</p>
          {c.evidence.slice(0, 2).map((e, i) => <div className="quote" key={i}>{e.kind === 'quote' ? `“${e.text}”` : e.text} <span className="small">({e.source})</span></div>)}
          <p><strong>Why it matters:</strong> {c.importance}</p><p><strong>What to do:</strong> {c.recommendation}</p></div>))}
        <div className="card"><h3>Save this and get the prepared work</h3><p className="mut">Create a free account to keep your analysis, see every finding as an Action Card, and get editable drafts you can approve. You have two more free uses after this one.</p>
          <Link className="btn" href={`/signup?preview=${token}`}>Create free account</Link> <Link className="btn sec" href={`/login?preview=${token}`}>I have an account</Link></div>
      </>)}
    </main>
  );
}
