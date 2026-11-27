import { runBrandCheck, saveBrand } from '../../actions';
import Locked from '@/components/Locked';
import { EvidencePill, Notice, one, Pill, PriorityPill, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { PROFILE_FIELDS } from '@/agent/profile/fields';

const BRAND = PROFILE_FIELDS.filter((f) => f.category === 'brand');
export default async function Brand({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const { agent } = (await getContainer());
  if (!(await agent.gate.has(ctx, 'brand_management'))) return <Locked feature="brand_management" title="Brand" />;
  const rep = await agent.brand.report(ctx); const sites = await agent.sites.list(ctx); const shared = Object.fromEntries(rep.shared.map((f) => [f.key, f.value]));
  return (<><h1>Brand across your websites</h1><Notice e={one(sp.e)} m={one(sp.m)} /><p className="mut">One set of brand guidance for every website, with optional overrides per website. The agent uses it for every draft and checks each website against it.</p>
    <form action={saveBrand} className="card"><input type="hidden" name="scope" value="shared" /><h2 style={{ marginTop: 0 }}>Shared brand guidance</h2>
      {BRAND.map((d) => <div key={d.key}><label htmlFor={`sh_${d.key}`}>{d.label}</label>{d.kind === 'list' || d.key === 'brand_guidelines' ? <textarea id={`sh_${d.key}`} name={`f_${d.key}`} rows={2} defaultValue={[shared[d.key] ?? ''].flat().join('\n')} /> : <input id={`sh_${d.key}`} name={`f_${d.key}`} defaultValue={String(shared[d.key] ?? '')} />}</div>)}<p><button>Save shared brand</button></p></form>
    {sites.filter((s) => !s.isPrimary).map((s) => { const ov = Object.fromEntries((rep.overrides.find((o) => o.siteId === s.id)?.fields ?? []).map((f) => [f.key, f.value])); return (<details className="card" key={s.id}><summary>Overrides for {s.name}</summary><form action={saveBrand}><input type="hidden" name="scope" value={s.id} /><p className="small mut">Leave blank to follow the shared guidance.</p>{BRAND.filter((d) => ['brand_voice', 'tone', 'value_proposition', 'key_messages', 'preferred_terms', 'avoid_terms'].includes(d.key)).map((d) => <div key={d.key}><label htmlFor={`o_${s.id}_${d.key}`}>{d.label}</label>{d.kind === 'list' ? <textarea id={`o_${s.id}_${d.key}`} name={`f_${d.key}`} rows={2} defaultValue={[ov[d.key] ?? ''].flat().join('\n')} /> : <input id={`o_${s.id}_${d.key}`} name={`f_${d.key}`} defaultValue={String(ov[d.key] ?? '')} />}</div>)}<p><button>Save overrides</button></p></form></details>); })}
    <div className="row"><h2>Consistency check</h2><span className="sp" /><form action={runBrandCheck}><button>Run brand check and add Action Cards</button></form></div>
    {rep.limitations.length > 0 && <div className="banner warn"><ul>{rep.limitations.map((l) => <li key={l}>{l}</li>)}</ul></div>}
    {rep.sites.map((s) => (<section className="card" key={s.siteId}><div className="row"><h3 style={{ margin: 0 }}>{s.name}</h3>{s.scanned ? (s.findings.length ? <Pill cls="e-estimated">{s.findings.length} issue(s)</Pill> : <Pill cls="e-verified">consistent</Pill>) : <Pill>not reviewed</Pill>}</div>
      <ul className="clean">{s.findings.map((f) => <li key={f.key}><strong>{f.title}</strong> <PriorityPill label={f.impact} /> <EvidencePill v={f.evidenceClass} /><div className="small">{f.observed}</div>{f.evidence.slice(0, 1).map((e, i) => <div className="quote" key={i}>{e.kind === 'quote' ? `“${e.text}”` : e.text}</div>)}<div className="small mut">{f.recommendation}</div></li>)}</ul></section>))}</>);
}
