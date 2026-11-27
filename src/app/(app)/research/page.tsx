import { submitRequest } from '../../actions';
import { EvidencePill, Notice, one, Pill, type SP, when } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { freshness } from '@/agent/profile/service';
import { inSite } from '@/agent/store/authz';

export default async function Research({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const { db } = getContainer();
  await getContainer().agent.authz.require(ctx, 'view'); const lib = (await db.research.list(ctx.businessId, undefined, { newestFirst: true })).filter((r) => inSite(r, ctx)).slice(0, 50);
  return (<><h1>Research library</h1><p className="mut">Saved website findings, competitor research and keyword data, with source and date. Old research is flagged so it is not treated as current fact.</p><Notice e={one(sp.e)} />
    <div className="grid g2">
      <form action={submitRequest} className="card"><input type="hidden" name="back" value="/research" /><input type="hidden" name="taskType" value="competitor_research" /><input type="hidden" name="request" value="Research my competitors" /><h3>Research competitors</h3><label htmlFor="competitorUrls">Competitor websites (up to 5)</label><input id="competitorUrls" name="competitorUrls" placeholder="rival.com other.com" required /><p className="small mut">Only the sites you list are examined. Nothing is guessed.</p><button>Research</button></form>
      <form action={submitRequest} className="card"><input type="hidden" name="back" value="/research" /><input type="hidden" name="taskType" value="seo_research" /><input type="hidden" name="request" value="Analyze my keywords and content gaps" /><h3>Keyword and content-gap analysis</h3><label htmlFor="keywordFile">Keyword export (CSV, e.g. Semrush)</label><input id="keywordFile" name="keywordFile" type="file" accept=".csv,text/csv" required /><p className="small mut">Search data is shown as measured only when it comes from your export.</p><button>Analyze</button></form></div>
    {lib.map((r) => { const fr = freshness({ provenance: { source: 'research', recordedAt: r.collectedAt, evidence: r.evidence } }); return (<details className="card" key={r.id}><summary>{r.title} <EvidencePill v={r.evidence} /> {fr !== 'fresh' && <Pill cls="e-estimated">{fr === 'stale' ? 'outdated' : 'aging'}</Pill>} <span className="mut small">· {r.kind.replace('_', ' ')} · {when(r.collectedAt)}</span></summary><p className="small mut">Source: {r.source}</p><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 360, overflow: 'auto' }}>{JSON.stringify(r.data, null, 2)}</pre></details>); })}
    {!lib.length && <div className="card">Nothing saved yet.</div>}</>);
}
