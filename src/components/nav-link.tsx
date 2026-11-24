"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const isActive = (pathname: string, href: string, exact?: boolean) =>
  exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link href={href} className={active ? "nav active" : "nav"} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

export function TabLink({ href, exact, icon, children }: { href: string; exact?: boolean; icon: string; children: React.ReactNode }) {
  const active = isActive(usePathname(), href, exact);
  return (
    <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      <span className="ico" aria-hidden="true">
        {icon}
      </span>
      {children}
    </Link>
  );
}
