import Link from 'next/link';
import { logOut, switchSite } from '../actions';
import { requireWorkspace } from '@/server/auth';
import { getContainer } from '@/server/container';

export const dynamic = 'force-dynamic';
const LINKS = [['/dashboard', 'Dashboard'], ['/board', 'Action Board'], ['/ask', 'Ask the agent'], ['/deliverables', 'Drafts'], ['/progress', 'Progress'], ['/insights', 'Insights'], ['/profile', 'Business Profile'], ['/research', 'Research'], ['/strategy', 'Strategy'], ['/campaigns', 'Campaigns'], ['/performance', 'Performance'], ['/sites', 'Sites'], ['/brand', 'Brand'], ['/billing', 'Plan']] as const;
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, business, site } = await requireWorkspace(); const { entitlements, agent } = getContainer(); const u = await entitlements.status(ctx); const usable = await agent.sites.usable(ctx);
  return (<>
    <a href="#main" className="skip">Skip to content</a>
    <nav className="nav" aria-label="Main"><div className="wrap"><span className="brand">Something Clicks</span>{LINKS.map(([h, l]) => <Link key={h} href={h}>{l}</Link>)}<span className="sp" />
      {usable.length > 1 && <form action={switchSite} className="site-switch"><input type="hidden" name="back" value="/dashboard" /><label htmlFor="siteId" className="small" style={{ margin: 0 }}>Website</label><select id="siteId" name="siteId" defaultValue={site.id}>{usable.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="sec" style={{ padding: '4px 10px' }}>Switch</button></form>}
      <span className="mut small">{business.name}{usable.length > 1 ? ` · ${site.name}` : ''} · {u.planName}{u.draftsLimit ? ` · ${u.draftsRemaining}/${u.draftsLimit} drafts left` : ` · ${u.freeRemaining} free use${u.freeRemaining === 1 ? '' : 's'} left`}</span>
      <form action={logOut}><button className="sec" style={{ padding: '4px 10px' }}>Sign out</button></form></div></nav>
    <main id="main" className="wrap" style={{ paddingTop: 16, paddingBottom: 48 }}>{children}</main></>);
}
