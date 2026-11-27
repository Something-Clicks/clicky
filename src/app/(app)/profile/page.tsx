import { confirmField, saveProfile } from '../../actions';
import { Notice, one, Pill, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';
import { PROFILE_FIELDS } from '@/agent/profile/fields';
import { freshness, isAssumption } from '@/agent/profile/service';

const CATS = [['business', 'Business'], ['brand', 'Brand'], ['customer', 'Customers'], ['context', 'Constraints and context']] as const;
export default async function Profile({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const p = await getContainer().agent.profiles.get(ctx);
  return (<><h1>Business Profile</h1><p className="mut">This is what the agent knows about your business. Confirmed facts are never overwritten by guesses. Anything the agent inferred is labelled as an assumption until you confirm it.</p><Notice e={one(sp.e)} m={one(sp.m)} />
    <form action={saveProfile}>{CATS.map(([cat, title]) => (<section key={cat}><h2>{title}</h2><div className="card">{PROFILE_FIELDS.filter((f) => f.category === cat).map((d) => { const f = p.fields[d.key]; const fr = f ? freshness(f) : undefined;
      return (<div key={d.key}><label htmlFor={`f_${d.key}`}>{d.label} {f && (f.confirmed ? <Pill cls="e-verified">confirmed</Pill> : isAssumption(f) ? <Pill cls="e-inferred">AI assumption</Pill> : <Pill cls="e-inferred">from {f.provenance.source.replace('_', ' ')}</Pill>)} {fr && fr !== 'fresh' && <Pill cls="e-estimated">{fr === 'stale' ? 'outdated' : 'aging'}</Pill>}</label>
        {d.kind === 'list' || d.key === 'brand_guidelines' ? <textarea id={`f_${d.key}`} name={`f_${d.key}`} defaultValue={f ? [f.value].flat().join('\n') : ''} rows={3} placeholder={d.kind === 'list' ? 'One per line' : ''} /> : <input id={`f_${d.key}`} name={`f_${d.key}`} defaultValue={f ? String(f.value) : ''} />}
        {f?.conflicts.length ? <div className="banner warn small">Conflicting information: {f.conflicts.map((c) => `“${[c.value].flat().join('; ')}” (${c.provenance.source.replace('_', ' ')})`).join(' · ')}. Edit the field to choose.</div> : null}</div>); })}</div></section>))}
      <p><button>Save and confirm my changes</button></p></form>
    <h2>Quick confirm</h2><div className="card"><p className="small mut">Confirm facts the agent found if they are right.</p><ul className="clean">{Object.entries(p.fields).filter(([, f]) => !f.confirmed).map(([k, f]) => (<li key={k}><form action={confirmField} className="row"><input type="hidden" name="key" value={k} /><span><strong>{PROFILE_FIELDS.find((x) => x.key === k)?.label}:</strong> {[f.value].flat().join('; ')}</span><span className="sp" /><button className="sec" style={{ padding: '2px 10px' }}>Confirm</button></form></li>))}</ul></div></>);
}
