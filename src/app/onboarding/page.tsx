import { redirect } from 'next/navigation';
import { createWorkspace, findMyWebsite } from '../actions';
import { Notice, one, type SP } from '@/components/ui';
import { getWorkspace, requireUser } from '@/server/auth';
import { getContainer } from '@/server/container';
export const dynamic = 'force-dynamic';
export default async function Onboarding({ searchParams }: { searchParams: SP }) {
  await requireUser(); if (await getWorkspace()) redirect('/dashboard'); const sp = await searchParams;
  const name = one(sp.name) ?? ''; const place = one(sp.place) ?? ''; const find = one(sp.find) === '1' && name;
  const found = find ? await (await getContainer()).agent.discovery.findWebsite({ name, place: place || undefined }) : undefined;
  return (<main className="wrap" style={{ maxWidth: 520 }}><h1>Set up your workspace</h1><p className="mut">Tell us about your business. We will read your website and prepare your first Action Board.</p><Notice e={one(sp.e)} />
    {found && (<section className="card" aria-label="Websites we found"><h2>Is one of these your website?</h2>
      {found.candidates.length ? (<ul>{found.candidates.map((c) => (<li key={c.website}><form action={createWorkspace}><input type="hidden" name="name" value={name} /><input type="hidden" name="place" value={place} /><input type="hidden" name="website" value={c.website} />
        <strong>{c.name}</strong> <span className="mut">{c.website}{c.address ? ` · ${c.address}` : ''} · found via {c.via}</span> <button>Use this website</button></form></li>))}</ul>)
        : <p className="mut">We could not find a website for “{name}”{found.errors.length ? ` (${found.errors.join('; ')})` : ''}. Enter it below, or leave it blank and add it later.</p>}
    </section>)}
    <form action={createWorkspace} className="card">
      <label htmlFor="name">Business name</label><input id="name" name="name" required defaultValue={name} />
      <label htmlFor="website">Website <span className="mut">(leave blank and use “Find my website”)</span></label><input id="website" name="website" placeholder="yourbusiness.com" inputMode="url" />
      <label htmlFor="place">City and state</label><input id="place" name="place" placeholder="Denver, CO" defaultValue={place} />
      <label htmlFor="zip">ZIP code</label><input id="zip" name="zip" pattern="\d{5}" maxLength={5} inputMode="numeric" />
      <p className="row"><button>Analyze my website</button> <button className="sec" formAction={findMyWebsite} formNoValidate>Find my website</button></p></form></main>);
}
