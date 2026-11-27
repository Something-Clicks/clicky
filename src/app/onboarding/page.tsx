import { redirect } from 'next/navigation';
import { createWorkspace } from '../actions';
import { Notice, one, type SP } from '@/components/ui';
import { getWorkspace, requireUser } from '@/server/auth';
export const dynamic = 'force-dynamic';
export default async function Onboarding({ searchParams }: { searchParams: SP }) {
  await requireUser(); if (await getWorkspace()) redirect('/dashboard'); const sp = await searchParams;
  return (<main className="wrap" style={{ maxWidth: 520 }}><h1>Set up your workspace</h1><p className="mut">Tell us about your business. We will read your website and prepare your first Action Board.</p><Notice e={one(sp.e)} />
    <form action={createWorkspace} className="card">
      <label htmlFor="name">Business name</label><input id="name" name="name" required />
      <label htmlFor="website">Website</label><input id="website" name="website" required placeholder="yourbusiness.com" inputMode="url" />
      <label htmlFor="zip">ZIP code</label><input id="zip" name="zip" pattern="\d{5}" maxLength={5} inputMode="numeric" />
      <p><button>Analyze my website</button></p></form></main>);
}
