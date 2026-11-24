import Image from "next/image";
import Link from "next/link";

import { ConsentBanner } from "./consent";
import { NavLink, TabLink } from "./nav-link";

export interface NavGroup {
  label: string;
  items: { href: string; label: string; exact?: boolean }[];
}
export interface Tab {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
}

/**
 * Signed-in layout. Phones: a slim top bar and a four-tab bar at the bottom.
 * Desktop (≥1024px): a sidebar with every section. The workspace is masked in
 * session recordings (data-clarity-mask).
 */
export function Shell({
  groups,
  tabs,
  right,
  sideFooter,
  children,
}: {
  groups: NavGroup[];
  tabs: Tab[];
  right: React.ReactNode;
  sideFooter?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Link className="brand" href="/app">
          <Image src="/brand/clicky-flat-96.png" alt="" width={32} height={32} priority />
          Something Clicks
        </Link>
        <nav aria-label="Sections">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="group">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.href} href={item.href} exact={item.exact}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {sideFooter ? <div className="side-foot">{sideFooter}</div> : null}
      </aside>
      <div>
        <div className="top">
          <Link className="brand" href="/app">
            <Image src="/brand/clicky-flat-96.png" alt="" width={32} height={32} />
            <span className="sr-only">Something Clicks home</span>
          </Link>
          <span />
          {right}
        </div>
        <main className="main" id="main" tabIndex={-1} data-clarity-mask="true">
          {children}
        </main>
      </div>
      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <TabLink key={t.href} href={t.href} exact={t.exact} icon={t.icon}>
            {t.label}
          </TabLink>
        ))}
      </nav>
      <ConsentBanner />
    </div>
  );
}

/** The approved Clicky artwork: flat for small marks, 3D for larger moments. */
export function Clicky({ size, className, alt = "Clicky" }: { size: number; className?: string; alt?: string }) {
  return size > 96 ? (
    <Image src="/brand/clicky-3d.png" alt={alt} width={720} height={502} className={className} style={{ width: size, height: "auto" }} />
  ) : (
    <Image src="/brand/clicky-flat-192.png" alt={alt} width={size} height={size} className={className} />
  );
}
