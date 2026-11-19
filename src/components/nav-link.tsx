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

/** "Root / <b>Page</b>": the longest matching path prefix names the page. */
export function Crumb({ root, names }: { root: string; names: Record<string, string> }) {
  const pathname = usePathname();
  const match = Object.keys(names)
    .filter((path) => isActive(pathname, path, path === "/" || path === "/app" || path === "/admin"))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <div className="crumb">
      {root} / <b>{match ? names[match] : ""}</b>
    </div>
  );
}
