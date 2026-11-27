import { openPortal } from '../../actions';
import PlanCards from '@/components/PlanCards';
import { Notice, one, type SP } from '@/components/ui';
import { requireWorkspace } from '@/server/auth';
import { FREE_USES } from '@/server/billing/plans';
import { getContainer } from '@/server/container';

export default async function Billing({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams; const { ctx } = await requireWorkspace(); const u = await getContainer().entitlements.status(ctx); const st = one(sp.status);
  const subscribed = !!u.subscriptionStatus && !['free', 'report'].includes(u.plan);
  return (<><h1>Plan and billing</h1><Notice e={one(sp.e)} />{st === 'success' && <div className="banner ok">Thanks! Your payment is being confirmed. This page updates when Stripe confirms it.</div>}{st === 'cancelled' && <div className="banner">Checkout cancelled. Nothing was charged.</div>}
    <div className="card"><h2 style={{ marginTop: 0 }}>Your plan: {u.planName}</h2>
      {subscribed ? <p>{u.draftsUsed} of {u.draftsLimit} drafts used this period; resets {u.periodEnd?.slice(0, 10)}. Up to {u.maxSites} website{u.maxSites === 1 ? '' : 's'} and {u.maxLocations} location{u.maxLocations === 1 ? '' : 's'}.</p>
        : <p>{u.freeUsed} of {FREE_USES} free uses used · {u.freeRemaining} left{u.reportCredits ? ` · ${u.reportCredits} Marketing Report credit` : ''}.</p>}
      <p className="small mut">A use counts only when a completed result is saved. Errors, blocked attempts and retries never count. Your saved work stays available whatever plan you are on.</p>
      {u.subscriptionStatus && <form action={openPortal}><button className="sec">Manage billing and cancellation</button></form>}</div>
    <PlanCards mode="billing" current={u.plan === 'free' && !u.freeRemaining && !u.reportCredits ? undefined : u.plan} subscribed={subscribed} />
    <p className="small mut">Prices, billing term, taxes and cancellation terms are shown at checkout.</p></>);
}
