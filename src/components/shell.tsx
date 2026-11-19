import Image from "next/image";
import Link from "next/link";

import { Crumb, NavLink } from "./nav-link";

export interface NavGroup {
  label: string;
  items: { href: string; label: string; exact?: boolean }[];
}

/**
 * The reference layout: white sticky sidebar (brand, grouped nav) and a main
 * column with a breadcrumb bar. Below 900px the sidebar becomes a wrapped
 * top bar, exactly as in the reference.
 */
export function Shell({
  groups,
  crumbRoot,
  crumbs,
  right,
  sideFooter,
  children,
}: {
  groups: NavGroup[];
  crumbRoot: string;
  crumbs: Record<string, string>;
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
        <Link className="brand" href="/">
          <Image src="/brand/clicky-96.png" alt="" width={38} height={38} priority />
          Something Clicks
        </Link>
        <nav aria-label="Main">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="group">{group.label}</div>
              <div className="navwrap">
                {group.items.map((item) => (
                  <NavLink key={item.href} href={item.href} exact={item.exact}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        {sideFooter ? <div className="side-foot">{sideFooter}</div> : null}
      </aside>
      <main className="main" id="main" tabIndex={-1}>
        <div className="top">
          <Crumb root={crumbRoot} names={crumbs} />
          {right}
        </div>
        {children}
      </main>
    </div>
  );
}

/** The approved Clicky artwork (transparent cut-out of the source image). */
export function Clicky({ size, className, alt = "Clicky" }: { size: number; className?: string; alt?: string }) {
  return (
    <Image
      src={size > 96 ? "/brand/clicky-384.png" : "/brand/clicky-192.png"}
      alt={alt}
      width={size}
      height={size}
      className={className}
    />
  );
}
