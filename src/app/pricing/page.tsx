import Link from 'next/link';
import PlanCards from '@/components/PlanCards';
import { getSessionUser } from '@/server/auth';

export const metadata = { title: 'Plans and pricing · Something Clicks' };
export default async function Pricing() {
  const user = await getSessionUser();
  return (<main className="wrap"><div className="row" style={{ padding: '14px 0' }}><Link href="/"><strong>Something Clicks</strong></Link><span className="sp" />{user ? <Link href="/dashboard">Open workspace</Link> : <><Link href="/login">Sign in</Link><Link className="btn" href="/signup">Create account</Link></>}</div>
    <h1>Plans and pricing</h1>
    <p className="mut">All four plans use the same marketing agent. Each plan unlocks more of what it can do. Start with your free preview, upgrade when you want more. Prices, billing term, taxes and cancellation terms are shown at checkout.</p>
    <PlanCards mode="marketing" />
    <div className="card"><h2 style={{ marginTop: 0 }}>Good to know</h2><ul><li>The agent prepares drafts and recommendations. Nothing is published, sent or spent without your approval, and direct publishing to your website or social accounts is not connected yet. You approve a draft, then copy, download or record it.</li><li>You start with 3 free uses. A use counts only when a finished result is saved; errors and retries never count.</li><li>Your saved work stays available if you change or cancel your plan.</li></ul></div></main>);
}
