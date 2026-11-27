import Link from 'next/link';
import { startPreview } from './actions';
import { Notice, one, type SP } from '@/components/ui';
import { env } from '@/server/env';
import { getSessionUser } from '@/server/auth';
import PlanCards from '@/components/PlanCards';

export default async function Home({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const user = await getSessionUser();
  return (
    <main className="wrap">
      <div className="row" style={{ padding: '14px 0' }}><strong>Something Clicks</strong><span className="sp" /><Link href="/pricing">Pricing</Link>{user ? <Link href="/dashboard">Open workspace</Link> : <><Link href="/login">Sign in</Link><Link className="btn" href="/signup">Create account</Link></>}</div>
      <section className="hero">
        <h1>See what is holding your marketing back, with the evidence.</h1>
        <p className="mut">Enter your website and ZIP code. Something Clicks reads your actual site, shows what matters most to fix first, and prepares the work for you to review and approve. It never publishes, sends or spends anything without your approval.</p>
        <Notice e={one(sp.e)} />
        <form action={startPreview} className="card">
          <label htmlFor="url">Your website</label><input id="url" name="url" placeholder="yourbusiness.com" required autoComplete="url" inputMode="url" />
          <label htmlFor="zip">ZIP code</label><input id="zip" name="zip" placeholder="84101" required pattern="\d{5}" inputMode="numeric" autoComplete="postal-code" maxLength={5} />
          <p className="mut small">We read only public pages of the site you enter. {env.anonymousPreview ? 'No account needed for your first result.' : 'The free preview opens soon; you can create an account now.'}</p>
          <button disabled={!env.anonymousPreview}>Analyze my website</button>
        </form>
      </section>
      <section className="grid g2">
        <div className="card"><h3>Evidence, not guesses</h3><p className="mut">Every finding shows where it was seen and is labelled verified, inferred, estimated or unknown. We say plainly what we could not check.</p></div>
        <div className="card"><h3>Work you can use</h3><p className="mut">Headlines, page copy, SEO titles, emails and campaigns written from your real business facts. You edit and approve; unsupported claims are flagged.</p></div>
      </section>
      <section aria-labelledby="plans-h"><h2 id="plans-h">One marketing agent. Four ways to use it.</h2><p className="mut">Start free. Upgrade when you want more.</p><PlanCards mode="marketing" /></section>
    </main>
  );
}
